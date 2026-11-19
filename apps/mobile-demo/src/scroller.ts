/**
 * A small touch scroller for the app: drag with a rubber edge, release with
 * momentum, optional snapping to a slot, and a cubic settle. It owns one
 * offset signal; it schedules `requestAnimationFrame` only while a drag has
 * just ended or a fling is running, so an idle scene has no frame loop.
 */
import { createSignal, type Accessor } from 'solid-js';

export type DragPhase = 'start' | 'move' | 'end' | 'cancel';
export interface Point {
  x: number;
  y: number;
}

export interface ScrollerOptions {
  axis: 'x' | 'y';
  /** When set, a release snaps the projected offset to a multiple of it. */
  snap?: number | (() => number);
  /** Called when a fling or settle ends at rest. */
  onSettle?: () => void;
}

export interface Scroller {
  offset: Accessor<number>;
  max: Accessor<number>;
  settled: Accessor<boolean>;
  layout(content: number, visible: number, keep?: 'bottom' | 'top'): void;
  to(value: number, duration?: number): void;
  stop(): void;
  drag(phase: DragPhase, point: Point, origin: Point): void;
  /** Drag along a chosen axis, for a handler that decides the axis first. */
  dragAxis(phase: DragPhase, value: number): void;
}

const FRICTION_PROJECTION = 170;

export function createScroller(options: ScrollerOptions): Scroller {
  const [offset, setOffset] = createSignal(0);
  const [max, setMax] = createSignal(0);
  const [settled, setSettled] = createSignal(true);
  let frame = 0;
  let dragging = false;
  let startOffset = 0;
  let startPointer = 0;
  let samples: { p: number; t: number }[] = [];

  const clamp = (value: number) => Math.max(0, Math.min(max(), value));

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function settleDone() {
    frame = 0;
    setSettled(true);
    options.onSettle?.();
  }

  function animateTo(value: number, duration = 360) {
    stop();
    const from = offset();
    const target = clamp(value);
    if (Math.abs(target - from) < 0.5) {
      setOffset(target);
      settleDone();
      return;
    }
    setSettled(false);
    if (duration <= 0) {
      setOffset(target);
      settleDone();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setOffset(from + (target - from) * eased);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        setOffset(target);
        settleDone();
      }
    };
    frame = requestAnimationFrame(step);
  }

  function push(pointer: number, time: number) {
    samples.push({ p: pointer, t: time });
    while (samples.length > 2 && time - samples[0]!.t > 110) samples.shift();
  }

  function velocity() {
    if (samples.length < 2) return 0;
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return -(last.p - first.p) / dt;
  }

  function release() {
    const v = velocity();
    const projected = offset() + v * FRICTION_PROJECTION;
    let target: number;
    let duration: number;
    const snap =
      typeof options.snap === 'function' ? options.snap() : options.snap;
    if (snap && snap > 0) {
      const slot = snap;
      target = clamp(Math.round(projected / slot) * slot);
      duration = Math.min(620, 220 + Math.abs(v) * 140);
    } else {
      target = clamp(projected);
      duration = Math.min(780, 180 + Math.abs(v) * 170);
    }
    if (Math.abs(v) < 0.02 && Math.abs(target - offset()) < 2) {
      setOffset(clamp(offset()));
      settleDone();
      return;
    }
    animateTo(target, duration);
  }

  function move(value: number) {
    const raw = startOffset - (value - startPointer);
    if (raw < 0) setOffset(raw * 0.32);
    else if (raw > max()) setOffset(max() + (raw - max()) * 0.32);
    else setOffset(raw);
  }

  return {
    offset,
    max,
    settled,
    layout(content, visible, keep) {
      const previousMax = max();
      const next = Math.max(0, content - visible);
      setMax(next);
      if (keep === 'bottom' && offset() >= previousMax - 2) {
        setOffset(next);
      } else if (keep === 'top') {
        setOffset(0);
      } else if (offset() > next) {
        setOffset(next);
      }
    },
    to(value, duration) {
      animateTo(value, duration);
    },
    stop,
    drag(phase, point, _origin) {
      const value = options.axis === 'x' ? point.x : point.y;
      this.dragAxis(phase, value);
    },
    dragAxis(phase, value) {
      if (phase === 'start') {
        stop();
        dragging = true;
        startOffset = offset();
        startPointer = value;
        samples = [];
        push(value, performance.now());
        return;
      }
      if (phase === 'move') {
        if (!dragging) return;
        push(value, performance.now());
        move(value);
        return;
      }
      if (!dragging) return;
      dragging = false;
      push(value, performance.now());
      if (phase === 'cancel') {
        animateTo(clamp(offset()), 220);
        return;
      }
      release();
    },
  };
}
