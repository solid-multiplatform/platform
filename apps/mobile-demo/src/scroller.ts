/**
 * A touch scroller with the physics of UIScrollView on iOS, using the real
 * constants, not a guess. The model and every number come from public
 * reverse engineering of UIKit's scroll views — the instruction-level
 * disassembly of UIKitCore (iOS 26.2) published by the Telegram iOS team
 * (validated against recorded device trajectories), the SDK header values,
 * and Apple's WWDC 2018 "Designing Fluid Interfaces" session 803. Sources
 * and the constants are recorded in the README's "Scrolling" section.
 *
 * The model, in one screen:
 *
 * - Drag follows the finger exactly inside the content, and through Apple's
 *   rubber-band formula past an edge: `(1 - 1/(x*c/d + 1)) * d` with
 *   `c = 0.55` and `d` the visible dimension, so content can never be
 *   dragged more than one viewport past an edge.
 * - Release velocity is derived the way UIPanGestureRecognizer does it:
 *   per-event finite differences, blended `0.2*current + 0.8*previous`
 *   while dragging, then at release a `0.75*previous + 0.25*latest`
 *   low-pass. A drag that stops before release therefore flings nowhere.
 * - A release below 0.25 px/ms does not decelerate at all, as on iOS.
 * - A fling decays exponentially per millisecond, `v(t) = v0 * 0.998^t`,
 *   integrated per frame as `dx = v * rate * (1 - rate^dt) / (1 - rate)`.
 * - A fling that reaches an edge hands the frame remainder to the bounce
 *   spring, a fixed 0.99/ms contraction of the overshoot that carries the
 *   velocity term and settles within 0.5 px of the bound.
 * - A rail with a `snap` glides the same exponential decay into the snap
 *   slot nearest the projected landing point, `projected = v0/|ln(0.998)|`
 *   with a 0.01 px/ms velocity floor — the target UIKit's
 *   `scrollViewWillEndDragging` reports.
 *
 * The clock and the frame callback are injectable so the physics tests run
 * on a virtual timeline. `requestAnimationFrame` runs only while the
 * scroller is moving; at rest there are no frames and no timers.
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
  /** Timestamp source for drag samples; `performance.now()` by default. */
  now?: () => number;
  /** Frame source for flings; `requestAnimationFrame` by default. */
  schedule?: (step: (now: number) => void) => number;
  /** Cancel a frame from `schedule`. */
  unschedule?: (frame: number) => void;
  /** Release-velocity is per millisecond, exactly as on iOS. */
  debug?: () => boolean;
}

export interface Scroller {
  offset: Accessor<number>;
  max: Accessor<number>;
  settled: Accessor<boolean>;
  layout(content: number, visible: number, keep?: 'bottom' | 'top'): void;
  to(value: number, duration?: number): void;
  /**
   * Moves the content by `delta` without changing the motion's state. A list
   * that corrects a measured item's height uses it to keep its anchor fixed.
   * The caller updates `max` with `layout` first.
   */
  shift(delta: number): void;
  stop(): void;
  drag(phase: DragPhase, point: Point, origin: Point): void;
  /** Drag along a chosen axis, for a handler that decides the axis first. */
  dragAxis(phase: DragPhase, value: number): void;
}

// ---- The researched constants (sources in README.md, "Scrolling"). ----

/** `UIScrollViewDecelerationRateNormal`: 0.998 per millisecond. */
const DECELERATION_RATE = 0.998;
const LN_RATE = Math.log(DECELERATION_RATE);
/**
 * The bounce spring's fixed stiffness, 0.99 per millisecond
 * (`ln(0.99) = -0.01005…`, a literal in the UIKit binary). Independent of
 * the deceleration rate.
 */
const BOUNCE_RATE = 0.99;
const LN_BOUNCE = Math.log(BOUNCE_RATE);
/** `__UIScrollViewRubberBandCoefficient` default: 0.55. */
const RUBBER_BAND_C = 0.55;
/** Below this release velocity, in px/ms, iOS does not decelerate at all. */
const FLING_MIN_VELOCITY = 0.25;
/** UIKit's projection integrates the decay only down to 0.01 px/ms. */
const VELOCITY_FLOOR = 0.01;
/** UIPanGestureRecognizer's two-sample blend while dragging. */
const SAMPLE_BLEND_CURRENT = 0.2;
/** The guarded low-pass UIKit applies to the release velocity. */
const RELEASE_BLEND_LATEST = 0.25;
/** A settle is finished within half a pixel of its target. */
const SETTLE_EPSILON = 0.5;
/** The largest frame interval integrated in one step; a stall must not jump. */
const MAX_FRAME_MS = 64;
/**
 * A slot settle that starts at rest (paging released without a fling)
 * approaches its target at 0.98 per millisecond: about 265 ms from 100 px,
 * distance-adaptive like a deceleration.
 */
const SLOT_SETTLE_RATE = 0.98;

/** The Android release build drops `console.*`; logcat keeps these lines. */
function debugLog(line: string): void {
  const log = (
    globalThis as {
      android?: { util?: { Log?: { d?: (tag: string, msg: string) => void } } };
    }
  ).android?.util?.Log;
  if (typeof log?.d === 'function') log.d('ScrollDemo', line);
  else console.log(line);
}

type Mode = 'idle' | 'dragging' | 'decel' | 'bounce' | 'glide';

export function createScroller(options: ScrollerOptions): Scroller {
  const [offset, setOffset] = createSignal(0);
  const [max, setMax] = createSignal(0);
  const [settled, setSettled] = createSignal(true);
  const now = options.now ?? (() => performance.now());
  const schedule =
    options.schedule ??
    ((step: (now: number) => void) => requestAnimationFrame(step));
  const unschedule =
    options.unschedule ??
    ((frame: number) => {
      if (frame) cancelAnimationFrame(frame);
    });

  let frame = 0;
  let mode: Mode = 'idle';
  let lastTime = 0;
  let visible = 1;

  // Drag state: the anchor pair, and the velocity-sample chain.
  let startOffset = 0;
  let startPointer = 0;
  let lastSample = { p: 0, t: 0 };
  /** The previous move's per-sample velocity, px/ms in offset space. */
  let sampleVelocity = 0;
  /** The recognizer blend after the previous and the latest move. */
  let blendPrevious = 0;
  let blendCurrent = 0;
  let moveCount = 0;

  // Flight state: where the current motion is heading and how fast.
  let velocity = 0;
  /** The exponential rate of the active deceleration. */
  let flightRate = DECELERATION_RATE;
  /** The slot a snap flight must land on, exactly. */
  let flightTarget: number | null = null;
  /** The edge a bounce is settling toward, and the glide's target. */
  let bounceEdge = 0;
  let glideTarget = 0;
  let glideRate = SLOT_SETTLE_RATE;
  let releaseTime = 0;
  let releaseOffset = 0;

  const debug = options.debug ?? (() => false);
  const log = (line: string) => {
    if (debug()) debugLog(line);
  };

  const clamp = (value: number) => Math.max(0, Math.min(max(), value));

  function stopFrames() {
    if (frame) unschedule(frame);
    frame = 0;
  }

  function settleDone() {
    stopFrames();
    mode = 'idle';
    velocity = 0;
    setSettled(true);
    if (releaseTime > 0) {
      log(
        `settle offset=${offset().toFixed(1)} max=${max().toFixed(1)} ` +
          `travel=${(offset() - releaseOffset).toFixed(1)} ` +
          `t=${(now() - releaseTime).toFixed(0)}ms`,
      );
      releaseTime = 0;
    }
    options.onSettle?.();
  }

  function startFrames() {
    lastTime = now();
    if (!frame) frame = schedule(step);
  }

  // ---- Flight modes. Each advances the motion by `dt` milliseconds. ----

  function stepFrame(nowMs: number) {
    const dt = Math.max(0, Math.min(MAX_FRAME_MS, nowMs - lastTime));
    lastTime = nowMs;
    if (dt <= 0) return;
    if (mode === 'decel') decelStep(dt);
    else if (mode === 'bounce') bounceStep(dt);
    else if (mode === 'glide') glideStep(dt);
  }

  function step(nowMs: number) {
    stepFrame(nowMs);
    // A finishing mode called `settleDone` itself; a drag that started
    // mid-frame owns the scroller now. Either way, no next frame.
    if (mode !== 'idle' && mode !== 'dragging') frame = schedule(step);
    else frame = 0;
  }

  /** `dx = v * rate * (1 - rate^dt) / (1 - rate)`, then `v *= rate^dt`. */
  function decelStep(dt: number) {
    const rate = flightRate;
    const decay = Math.exp(dt * Math.log(rate));
    const delta = (velocity * rate * (1 - decay)) / (1 - rate);
    const next = offset() + delta;
    const maxV = max();
    const inside = offset() >= 0 && offset() <= maxV;
    if (inside && (next < 0 || next > maxV)) {
      // A fling reaching an edge integrates to the edge, then hands the
      // frame remainder to the bounce spring.
      const edge = next < 0 ? 0 : maxV;
      const spent =
        Math.abs(delta) > 0 ? Math.abs((edge - offset()) / delta) : 1;
      velocity *= Math.exp(Math.min(1, Math.max(0, spent)) * dt * LN_RATE);
      setOffset(edge);
      bounceEdge = edge;
      mode = 'bounce';
      log(`edge hit=${edge.toFixed(1)} v=${velocity.toFixed(3)}`);
      return;
    }
    if (!inside && (next < 0 ? velocity < 0 : next > maxV && velocity > 0)) {
      // Out of bounds and moving further out: the bounce owns this.
      bounceEdge = next < 0 ? 0 : maxV;
      mode = 'bounce';
      return;
    }
    setOffset(next);
    velocity *= decay;
    if (Math.abs(velocity) < VELOCITY_FLOOR) {
      if (offset() < 0 || offset() > maxV) {
        bounceEdge = offset() < 0 ? 0 : maxV;
        mode = 'bounce';
      } else if (flightTarget !== null) {
        // A snap flight lands exactly on its slot.
        setOffset(clamp(flightTarget));
        flightTarget = null;
        settleDone();
      } else {
        setOffset(clamp(Math.round(offset())));
        settleDone();
      }
    }
  }

  /**
   * The bounce: the overshoot contracts at 0.99/ms while the carried
   * velocity decays by both factors, as decoded from
   * `_getBouncingDecelerationOffset`.
   */
  function bounceStep(dt: number) {
    const springK = Math.exp(dt * LN_BOUNCE);
    const decay = Math.exp(dt * LN_RATE);
    const edge = bounceEdge;
    const over = offset() - edge;
    const next =
      edge +
      over * springK +
      (velocity * DECELERATION_RATE * springK * (1 - decay)) /
        (1 - DECELERATION_RATE);
    velocity *= decay * springK;
    // A bounce carrying the content back across its edge hands off to a
    // free deceleration, as a fling released from an overscroll does.
    if (
      (edge === 0 && next > SETTLE_EPSILON && next < max()) ||
      (edge === max() && next < max() - SETTLE_EPSILON && next > 0)
    ) {
      setOffset(next);
      mode = 'decel';
      flightRate = DECELERATION_RATE;
      return;
    }
    setOffset(next);
    if (Math.abs(next - edge) < SETTLE_EPSILON && Math.abs(velocity) < 0.05) {
      setOffset(edge);
      settleDone();
    }
  }

  /** An exponential approach to a target: `to()` and a slot settle. */
  function glideStep(dt: number) {
    const decay = Math.exp(dt * Math.log(glideRate));
    const current = offset();
    const next = glideTarget + (current - glideTarget) * decay;
    setOffset(next);
    if (Math.abs(next - glideTarget) < SETTLE_EPSILON) {
      setOffset(glideTarget);
      settleDone();
    }
  }

  function glideTo(target: number, rate: number) {
    glideTarget = clamp(target);
    glideRate = rate;
    if (Math.abs(offset() - glideTarget) < SETTLE_EPSILON) {
      setOffset(glideTarget);
      settleDone();
      return;
    }
    setSettled(false);
    mode = 'glide';
    startFrames();
  }

  // ---- Drag. ----

  /** The rubber-band offset for a raw dragged position. */
  function rubber(raw: number): number {
    const maxV = max();
    if (raw < 0) {
      const x = -raw;
      const d = visible;
      return -d * (1 - 1 / ((x * RUBBER_BAND_C) / d + 1));
    }
    if (raw > maxV) {
      const x = raw - maxV;
      const d = visible;
      return maxV + d * (1 - 1 / ((x * RUBBER_BAND_C) / d + 1));
    }
    return raw;
  }

  function pushSample(p: number, t: number) {
    const dt = t - lastSample.t;
    if (dt > 0) {
      // The sample velocity is in offset space: a finger moving +p scrolls
      // the content the other way.
      const s = (lastSample.p - p) / dt;
      blendPrevious = blendCurrent;
      blendCurrent =
        moveCount === 0
          ? s
          : SAMPLE_BLEND_CURRENT * s +
            (1 - SAMPLE_BLEND_CURRENT) * sampleVelocity;
      sampleVelocity = s;
      moveCount++;
    }
    lastSample = { p, t };
  }

  /** The release velocity: the guarded low-pass over the recognizer blends. */
  function releaseVelocity(): number {
    if (moveCount === 0) return 0;
    if (moveCount === 1) return blendCurrent;
    return (
      (1 - RELEASE_BLEND_LATEST) * blendPrevious +
      RELEASE_BLEND_LATEST * blendCurrent
    );
  }

  /**
   * UIKit's projection: the distance a release velocity travels under the
   * exponential decay, integrated down to the 0.01 px/ms floor.
   */
  function project(v: number): number {
    const speed = Math.abs(v) - VELOCITY_FLOOR;
    if (speed <= 0) return 0;
    return (Math.sign(v) * speed) / -LN_RATE;
  }

  /** The snap slot nearest `value`, with the content's end as a slot too. */
  function nearestSnap(value: number, slot: number): number {
    const maxV = max();
    const candidates: number[] = [
      Math.max(0, Math.min(maxV, Math.round(value / slot) * slot)),
      maxV,
    ];
    let best = candidates[0]!;
    let bestDistance = Math.abs(value - best);
    for (const candidate of candidates) {
      const distance = Math.abs(value - candidate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  function release() {
    const v = releaseVelocity();
    const snap =
      typeof options.snap === 'function' ? options.snap() : options.snap;
    const maxV = max();
    const out = offset() < 0 || offset() > maxV;
    const inward = (offset() < 0 && v > 0) || (offset() > maxV && v < 0);
    releaseTime = now();
    releaseOffset = offset();
    log(
      `release offset=${offset().toFixed(1)} v=${v.toFixed(3)}px/ms ` +
        `project=${project(v).toFixed(0)} snap=${snap ? 'on' : 'off'}`,
    );

    // Released past an edge — before any snap: the bounce owns it, and the
    // edge it settles on is itself a snap slot (0 or the content end).
    if (out && !(Math.abs(v) >= FLING_MIN_VELOCITY && inward)) {
      flightTarget = null;
      bounceEdge = offset() < 0 ? 0 : maxV;
      velocity = inward ? 0 : v;
      setSettled(false);
      mode = 'bounce';
      log(`bounce edge=${bounceEdge.toFixed(1)}`);
      startFrames();
      return;
    }

    if (snap && snap > 0) {
      const landing = offset() + project(v);
      const target = nearestSnap(landing, snap);
      const distance = target - offset();
      if (
        Math.abs(v) >= FLING_MIN_VELOCITY &&
        Math.sign(distance) === Math.sign(v) &&
        Math.abs(distance) > 1
      ) {
        // A fling: decay at the rate that lands exactly on the slot, the
        // same exponential curve UIKit's paging uses to reach its page.
        // The rate is above the normal one when the slot nearest the
        // landing point lies beyond it: paging glides a touch longer.
        flightRate = Math.abs(distance) / (Math.abs(distance) + Math.abs(v));
        flightTarget = target;
        velocity = v;
        setSettled(false);
        mode = 'decel';
        log(
          `fling snap target=${target.toFixed(1)} rate=${flightRate.toFixed(5)}`,
        );
        startFrames();
        return;
      }
      // Released slow or at rest: settle into the nearest slot.
      log(`slot settle target=${target.toFixed(1)}`);
      glideTo(target, SLOT_SETTLE_RATE);
      return;
    }

    if (Math.abs(v) >= FLING_MIN_VELOCITY) {
      flightTarget = null;
      flightRate = DECELERATION_RATE;
      velocity = v;
      setSettled(false);
      mode = 'decel';
      log(
        `fling v=${v.toFixed(3)} travel≈${((Math.abs(v) * DECELERATION_RATE) / (1 - DECELERATION_RATE)).toFixed(0)}`,
      );
      startFrames();
      return;
    }
    // A drag that stops before release has no fling; it stays where the
    // finger left it (in bounds) or springs back (out of bounds).
    if (out) {
      bounceEdge = offset() < 0 ? 0 : maxV;
      velocity = 0;
      setSettled(false);
      mode = 'bounce';
      startFrames();
      return;
    }
    setOffset(Math.round(offset()));
    settleDone();
  }

  return {
    offset,
    max,
    settled,
    layout(content, viewport, keep) {
      visible = Math.max(1, viewport);
      const previousMax = max();
      const next = Math.max(0, content - viewport);
      setMax(next);
      if (keep === 'bottom' && offset() >= previousMax - 2) {
        setOffset(next);
      } else if (keep === 'top') {
        setOffset(0);
      } else if (offset() > next) {
        setOffset(next);
      }
    },
    to(value, duration = 360) {
      if (duration <= 0) {
        stopFrames();
        mode = 'idle';
        setOffset(clamp(value));
        settleDone();
        return;
      }
      // An exponential approach that covers 99.9% of the distance in
      // `duration` ms: an iOS-shaped ease for programmatic scrolls.
      glideTo(value, Math.exp(Math.log(0.001) / duration));
    },
    shift(delta) {
      if (!Number.isFinite(delta) || delta === 0) return;
      const current = offset();
      const next = clamp(current + delta);
      const applied = next - current;
      if (applied === 0) return;
      setOffset(next);
      // Keep every anchor the active motion owns aligned with the shifted
      // content; the physics themselves are unchanged.
      startOffset += applied;
      if (flightTarget !== null) flightTarget += applied;
      glideTarget += applied;
      bounceEdge += applied;
      releaseOffset += applied;
    },
    stop: stopFrames,
    drag(phase, point, _origin) {
      const value = options.axis === 'x' ? point.x : point.y;
      this.dragAxis(phase, value);
    },
    dragAxis(phase, value) {
      if (phase === 'start') {
        stopFrames();
        mode = 'dragging';
        flightTarget = null;
        setSettled(false);
        startOffset = offset();
        startPointer = value;
        lastSample = { p: value, t: now() };
        sampleVelocity = 0;
        blendPrevious = 0;
        blendCurrent = 0;
        moveCount = 0;
        return;
      }
      if (phase === 'move') {
        if (mode !== 'dragging') return;
        pushSample(value, now());
        setOffset(rubber(startOffset - (value - startPointer)));
        return;
      }
      if (mode !== 'dragging') return;
      mode = 'idle';
      pushSample(value, now());
      setOffset(rubber(startOffset - (value - startPointer)));
      if (phase === 'cancel') {
        // The platform took the gesture away: iOS animates back in bounds.
        const maxV = max();
        bounceEdge = offset() < 0 ? 0 : maxV;
        velocity = 0;
        releaseTime = 0;
        if (offset() < -SETTLE_EPSILON || offset() > maxV + SETTLE_EPSILON) {
          setSettled(false);
          mode = 'bounce';
          startFrames();
        } else {
          setOffset(clamp(offset()));
          settleDone();
        }
        return;
      }
      release();
    },
  };
}
