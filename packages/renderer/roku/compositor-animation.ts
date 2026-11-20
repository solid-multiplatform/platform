import { Events } from './events.js';
import type { AnimationSettings } from './animation.js';

let nextMotionSerial = 0;

export type MotionKey = 'x' | 'y' | 'alpha';
export type MotionAction = 'start' | 'pause' | 'resume' | 'stop';
export type MotionFeedback = { serial: number; state: string; value: number };
export interface MotionSink {
  prepare?(): void;
  send(action: MotionAction, serial: number, target: number, duration: number, easing: string, reply: (feedback: MotionFeedback) => void): void;
  dispose(): void;
}
const nativeEasings: Record<string, string> = {
  linear: 'linear', ease: 'inOutQuad', 'ease-in': 'inQuad', 'ease-out': 'outQuad', 'ease-in-out': 'inOutQuad',
  easeIn: 'inQuad', easeOut: 'outQuad', easeInOut: 'inOutQuad', quadIn: 'inQuad', quadOut: 'outQuad',
  quadInOut: 'inOutQuad', cubicIn: 'inCubic', cubicOut: 'outCubic', cubicInOut: 'inOutCubic',
};
/**
 * The named curves a cubic-bezier can be matched against: the same set the
 * host names above, as the progress functions Roku computes.
 */
const namedCurves: Record<string, (t: number) => number> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
  inSine: (t) => 1 - Math.cos((Math.PI * t) / 2),
  outSine: (t) => Math.sin((Math.PI * t) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,
};

/** The y a cubic-bezier with these control points gives at `x = u`. */
function bezierProgress(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (u: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t;
  return (u) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (xAt(mid) < u) lo = mid;
      else hi = mid;
    }
    return yAt((lo + hi) / 2);
  };
}

/** The samples a match is measured on: 21 points, ends included. */
const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20);
/** A named curve within this RMS of the bezier is the same curve in practice. */
const MATCH_TOLERANCE = 0.08;

/**
 * The named SceneGraph easing closest to a `cubic-bezier` string, or undefined
 * when none is close enough. Roku's `Animation` node only takes a named curve;
 * the framework's default list transitions are beziers, which used to fall
 * back to the JavaScript clock even though the render thread could run them.
 * The match is within 8% RMS over the curve, not an identity: a bezier closer
 * to no named curve stays on the JavaScript clock, where it is exact.
 */
export function nearestNativeEasing(easing: string): string | undefined {
  const match = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(
    easing.trim(),
  );
  if (match === null) return undefined;
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (![x1, y1, x2, y2].every((value) => Number.isFinite(value)))
    return undefined;
  const curve = bezierProgress(x1, y1, x2, y2);
  let best: string | undefined;
  let bestError = Infinity;
  for (const [name, progress] of Object.entries(namedCurves)) {
    let sum = 0;
    for (const u of SAMPLES) {
      const delta = curve(u) - progress(u);
      sum += delta * delta;
    }
    const error = Math.sqrt(sum / SAMPLES.length);
    if (error < bestError) {
      best = name;
      bestError = error;
    }
  }
  return bestError <= MATCH_TOLERANCE ? best : undefined;
}

export function compositorEasing(settings: AnimationSettings): string | undefined {
  if (settings.delay || settings.loop || settings.repeat || settings.repeatDelay || settings.stopMethod || settings.remove) return;
  const easing = settings.easing ?? settings.timingFunction ?? 'linear';
  if (typeof easing !== 'string') return undefined;
  const named = nativeEasings[easing];
  if (named !== undefined) return named;
  // A bezier with a scene easing name near it runs on the render thread too.
  return easing.startsWith('cubic-bezier(')
    ? nearestNativeEasing(easing)
    : undefined;
}

export class CompositorAnimation extends Events {
  readonly nativeClock = true;
  value: number;
  target: number;
  private initial: number;
  private serial = 0;
  private state: 'scheduled' | 'running' | 'paused' | 'stopped' = 'scheduled';
  private removed = false;

  constructor(value: number, target: number, private duration: number, private easing: string,
    private publish: (value: number) => void, private sink: MotionSink) {
    super();this.value = value;this.initial = value;this.target = target;
  }
  get running() { return this.state === 'running'; }
  get done() { return this.state === 'stopped' || this.removed; }
  start(): this {
    if (this.removed || this.state === 'stopped') return this;
    if (this.state === 'paused') return this.resume();
    if (this.state === 'running') return this;
    return this.begin(this.target, this.duration);
  }
  private begin(target: number, duration: number): this {
    this.target = target;this.state = 'running';this.sink.prepare?.();
    if (duration <= 0) {
      // An immediate run is over before the render thread can report it; write
      // the value now so callers observe it synchronously, and let the sink
      // apply the same value on the render thread.
      this.value = target;this.publish(target);
      this.send('start', 0);this.emit('start');
      this.state = 'stopped';this.emit('finish');
      return this;
    }
    // The JS node keeps the value it started from while the render thread
    // animates; the component reports the final value when it stops. Publishing
    // the target here would make layout and hit-testing jump to the end.
    this.send('start', duration);this.emit('start');
    return this;
  }
  private send(action: MotionAction, duration = this.duration) {
    const serial = ++nextMotionSerial;this.serial = serial;
    this.sink.send(action, serial, this.target, duration, this.easing, feedback => {
      if (this.removed || feedback.serial !== this.serial || serial !== this.serial) return;
      if (feedback.state === 'paused' || feedback.state === 'stopped') {
        this.value = feedback.value;this.publish(feedback.value);
      }
      if (feedback.state === 'stopped' && this.state !== 'stopped') {
        this.state = 'stopped';this.emit('finish');
      }
    });
  }
  pause(): this { if (this.running) { this.state = 'paused';this.send('pause'); } return this; }
  resume(): this { if (!this.removed && this.state === 'paused') { this.state = 'running';this.send('resume'); } return this; }
  stop(): this {
    if (this.done) return this;
    this.state = 'stopped';this.send('stop');this.emit('stop');return this;
  }
  restore(): this { if (!this.removed) this.begin(this.initial, 0);return this; }
  reverse(): this { if (!this.removed) this.begin(this.initial, this.duration);return this; }
  retarget(target: number): this { if (!this.removed) this.begin(target, this.duration);return this; }
  tick(_delta: number): boolean { return !this.done; }
  remove() { if (this.removed) return;this.removed = true;this.state = 'stopped';this.serial++;this.sink.dispose();this.emit('stop'); }
}
