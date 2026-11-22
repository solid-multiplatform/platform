import { createSignal, type Accessor } from 'solid-js';
import type { Point } from './input.js';
import { viewport } from './viewport.js';
/** One logical offset for layout, focus reveal and virtualization. No idle frame timer. */
export function scrollAxis(initial = 0) {
  const [offset, setOffset] = createSignal(Math.max(0, initial));
  let max = Infinity,
    handle = 0,
    animation = 0;
  const clamp = (n: number) => Math.max(0, Math.min(max, n));
  function stop() {
    animation++;
    if (handle) cancelAnimationFrame(handle);
    handle = 0;
  }
  function to(value: number, duration = 0) {
    stop();
    const target = clamp(value),
      start = offset();
    if (target === start) return;
    if (duration <= 0 || viewport().reducedMotion) {
      setOffset(target);
      return;
    }
    const token = animation,
      epoch = performance.now();
    const step = (now: number) => {
      if (token !== animation) return;
      const t = Math.max(0, Math.min(1, (now - epoch) / duration));
      setOffset(clamp(start + (target - start) * (1 - (1 - t) ** 3)));
      handle = t < 1 ? requestAnimationFrame(step) : 0;
    };
    handle = requestAnimationFrame(step);
  }
  return {
    offset,
    to,
    stop,
    layout(content: number, visible: number) {
      max = Math.max(0, content - visible);
      if (offset() > max) to(max);
    },
    by(delta: number) {
      to(offset() + delta);
    },
    /** Scroll one page: the visible size along the axis, or `visible`. */
    page(visible: number, direction: 1 | -1 = 1) {
      to(offset() + direction * Math.max(0, visible));
    },
    reveal(start: number, end: number, visible: number, duration = 0) {
      if (start < offset()) to(start, duration);
      else if (end > offset() + visible) to(end - visible, duration);
    },
    visibleRange(
      itemSize: number,
      visible: number,
      count: number,
      overscan = 1,
    ) {
      if (!(itemSize > 0)) throw new RangeError('Positive item size required');
      return {
        start: Math.min(
          count,
          Math.max(0, Math.floor(offset() / itemSize) - overscan),
        ),
        end: Math.min(
          count,
          Math.ceil((offset() + visible) / itemSize) + overscan,
        ),
      };
    },
  };
}

export interface DragScrollOptions {
  /** Coordinate that moves the content. Defaults to the vertical axis. */
  axis?: 'x' | 'y';
  /**
   * `1` follows a finger/pointer drag (content moves with the pointer), `-1`
   * inverts it. Defaults to `1`.
   */
  direction?: 1 | -1;
}

/**
 * Adapt a pointer drag to a scroll axis. Pass the result to a node's
 * `onPointerDrag`; a drag that starts on the node or anything inside it then
 * scrolls, on every host with a pointer:
 *
 * ```tsx
 * const scroll = scrollAxis();
 * <view onPointerDrag={dragToScroll(scroll)} ... />
 * ```
 */
export function dragToScroll(
  scroll: { by(delta: number): void },
  options: DragScrollOptions = {},
): (
  phase: 'start' | 'move' | 'end' | 'cancel',
  point: Point,
  origin: Point,
) => void {
  const axis = options.axis ?? 'y';
  const direction = options.direction ?? 1;
  let last = 0;
  return (phase, point) => {
    const value = axis === 'x' ? point.x : point.y;
    if (phase === 'start') {
      last = value;
      return;
    }
    if (phase === 'end' || phase === 'cancel') return;
    const delta = last - value;
    last = value;
    if (delta) scroll.by(delta * direction);
  };
}

/**
 * A wheel event's deltas in scene units. `deltaMode` 0 is pixels, 1 is lines
 * (16 units each, the CSS/W3C suggested line height) and 2 is pages (the
 * visible size the host passes). Hosts that already report layout pixels can
 * pass the event as it is. Native wheel momentum is carried by the platform's
 * events: this only converts units, it never adds an animation of its own.
 */
export function normalizeWheelDelta(
  event: {
    deltaX: number;
    deltaY: number;
    deltaMode?: number;
  },
  pageSize = 800,
): { x: number; y: number } {
  if (event.deltaMode === 1) {
    return { x: event.deltaX * 16, y: event.deltaY * 16 };
  }
  if (event.deltaMode === 2) {
    return { x: event.deltaX * pageSize, y: event.deltaY * pageSize };
  }
  return { x: event.deltaX, y: event.deltaY };
}

export interface WheelScrollOptions {
  /** Wheel delta that moves the content. Defaults to vertical. */
  axis?: 'x' | 'y';
  /** Multiplier applied to the delta. Defaults to 1. */
  direction?: 1 | -1;
}

/**
 * Map a wheel event to a scroll axis. Pass the result to a node's
 * `onPointerScroll`. The event shape is structural so native hosts and tests
 * can call it without a DOM WheelEvent.
 */
export function wheelToScroll(
  scroll: { by(delta: number): void },
  options: WheelScrollOptions = {},
): (event: { deltaX: number; deltaY: number }) => void {
  const axis = options.axis ?? 'y';
  const direction = options.direction ?? 1;
  return (event) => {
    const delta = axis === 'x' ? event.deltaX : event.deltaY;
    if (delta) scroll.by(delta * direction);
  };
}

/**
 * `UIScrollViewDecelerationRateNormal`: velocity keeps this fraction per
 * millisecond. The same constant is the mobile demo's researched reference
 * (`archive/mobile-demo/src/scroller.ts`); see `docs/app-api.md#scrolling`.
 */
export const TOUCH_DECELERATION_RATE = 0.998;

/** UIScrollView's rubber-band coefficient, `__UIScrollViewRubberBandCoefficient`. */
export const RUBBER_BAND_COEFFICIENT = 0.55;

/** Movement, in scene units, before a nested gesture locks to one axis. */
export const AXIS_LOCK_SLOP = 10;

const LN_RATE = Math.log(TOUCH_DECELERATION_RATE);
/**
 * The bounce spring's fixed stiffness, 0.99 per millisecond, from UIKit's
 * `_getBouncingDecelerationOffset`; independent of the deceleration rate.
 */
const BOUNCE_RATE = 0.99;
const LN_BOUNCE = Math.log(BOUNCE_RATE);
/** Below this release velocity, in units/ms, iOS does not decelerate at all. */
const FLING_MIN_VELOCITY = 0.25;
/** UIKit's projection integrates the decay only down to 0.01 units/ms. */
const VELOCITY_FLOOR = 0.01;
/** UIPanGestureRecognizer's two-sample blend while dragging. */
const SAMPLE_BLEND_CURRENT = 0.2;
/** The guarded low-pass UIKit applies to the release velocity. */
const RELEASE_BLEND_LATEST = 0.25;
/** A settle is finished within half a scene unit of its target. */
const SETTLE_EPSILON = 0.5;
/** A frame longer than this (a background tab) is not allowed to jump. */
const MAX_FRAME_MS = 64;
/**
 * A slot settle that starts at rest approaches its target at 0.98 per
 * millisecond: about 265 ms from 100 units, distance-adaptive like a
 * deceleration.
 */
const SLOT_SETTLE_RATE = 0.98;

/**
 * The standard rubber-band function from the UIScrollView guides:
 * `f(x, d, c) = (x * d * c) / (d + c * x)`, where `x` is the distance past
 * the edge, `d` the viewport's length on the axis and `c` the coefficient.
 * It approaches but never reaches `d` — the content cannot be dragged away
 * forever.
 */
export function rubberBandDistance(
  distance: number,
  dimension: number,
  coefficient = RUBBER_BAND_COEFFICIENT,
): number {
  if (distance === 0) return 0;
  const d = Math.max(1, dimension);
  return (distance * d * coefficient) / (d + coefficient * Math.abs(distance));
}

/**
 * UIKit's projection: how far a fling with `velocity` (scene units per
 * millisecond) travels under the exponential decay, integrated down to the
 * 0.01 units/ms floor — `(|v| - 0.01) / |ln(rate)|`.
 */
export function flingDistance(
  velocity: number,
  rate = TOUCH_DECELERATION_RATE,
): number {
  const speed = Math.abs(velocity) - VELOCITY_FLOOR;
  if (speed <= 0) return 0;
  return (Math.sign(velocity) * speed) / -Math.log(rate);
}

/**
 * The axis a nested gesture locks to once it has moved `slop` units: `'x'` or
 * `'y'` for the dominant direction, `undefined` below the slop. Ties go to
 * the horizontal axis. Used with {@link lockDragAxis}.
 */
export function chooseDragAxis(
  dx: number,
  dy: number,
  slop = AXIS_LOCK_SLOP,
): 'x' | 'y' | undefined {
  if (dx * dx + dy * dy < slop * slop) return undefined;
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/**
 * Pick a scroller for a drag from axis values ordered innermost first. Returns
 * the index of the innermost scroller on the gesture's dominant axis, or `-1`
 * when the gesture has not left the slop or no nested scroller has that axis
 * (the gesture is then swallowed rather than moving a perpendicular view).
 */
export function lockDragAxis(
  axes: readonly ('x' | 'y')[],
  dx: number,
  dy: number,
  slop = AXIS_LOCK_SLOP,
): number {
  const axis = chooseDragAxis(dx, dy, slop);
  if (axis === undefined) return -1;
  for (let i = 0; i < axes.length; i++) {
    if (axes[i] === axis) return i;
  }
  return -1;
}

export interface ScrollEngineOptions {
  axis: 'x' | 'y';
  /**
   * Velocity fraction kept per millisecond after release. Defaults to
   * {@link TOUCH_DECELERATION_RATE} (0.998).
   */
  decelerationRate?: number;
  /** Rubber-band coefficient. Defaults to {@link RUBBER_BAND_COEFFICIENT}. */
  rubberBand?: number;
  /**
   * Snap slots in scene units, or a getter when the slot follows the items
   * (a `Row` snaps to item width + gap). `0` or `undefined` scrolls
   * continuously.
   */
  snap?: number | (() => number);
  /** Called after every offset change the engine makes. */
  onOffset?: (offset: number) => void;
  /** Called once when a drag, fling, snap or rubber-band return rests. */
  onSettle?: () => void;
  /** Time source; tests pass a fake clock. Defaults to `performance.now`. */
  now?: () => number;
  /** Frame scheduler; tests pass a fake one. Defaults to `requestAnimationFrame`. */
  raf?: (callback: () => void) => number;
  /** Cancels a frame from `raf`. */
  cancelRaf?: (handle: number) => void;
}

/**
 * A pointer-driven scroll model: content follows a drag, stretches with a
 * rubber band past either edge, flings with exponential deceleration and
 * optionally snaps to a slot. It exposes one offset signal and schedules
 * `requestAnimationFrame` only while it is moving — a resting engine has no
 * frame, timer or listener.
 *
 * ```ts
 * const engine = createScrollEngine({ axis: 'x', snap: 220 });
 * engine.layout(contentWidth, viewportWidth);
 * engine.dragAxis('start', point.x);
 * engine.dragAxis('move', point.x);
 * engine.dragAxis('end', point.x);
 * ```
 */
export interface ScrollEngine {
  /** Scroll offset: 0 at the start, `max` at the end. */
  readonly offset: Accessor<number>;
  /** Largest offset for the current content and viewport. */
  readonly max: Accessor<number>;
  /** True when no drag, fling, snap or return is running. */
  readonly settled: Accessor<boolean>;
  /** True while a finger owns the scroller: another press must not stop it. */
  readonly dragging: Accessor<boolean>;
  /**
   * Update the content and viewport lengths, plus the inset of the content
   * from the viewport's leading edge. Clamps an offset past the new maximum.
   */
  layout(content: number, visible: number, inset?: number): void;
  /** Move to a clamped offset; `duration` 0 (the default) applies at once. */
  to(value: number, duration?: number): void;
  /** Reveal `[start, end]` within the viewport, only as far as needed. */
  reveal(start: number, end: number, visible: number, duration?: number): void;
  /** Stop every frame and leave the offset where it is. */
  stop(): void;
  /** Set the offset without animating, for a writer outside the engine. */
  sync(value: number): void;
  /** Follow a pointer: `start`, `move`, `end` or `cancel`. */
  drag(phase: 'start' | 'move' | 'end' | 'cancel', point: Point): void;
  /** Follow one axis of a pointer, after an axis lock decided it. */
  dragAxis(phase: 'start' | 'move' | 'end' | 'cancel', value: number): void;
  /** The recognizer's guarded low-pass velocity, in units per millisecond. */
  velocity(): number;
}

type Mode = 'idle' | 'dragging' | 'decel' | 'bounce' | 'glide';

/**
 * The framework's touch scroller. One module and no new dependency; the
 * physics follow the researched reference in `archive/mobile-demo/src/scroller.ts`.
 */
export function createScrollEngine(options: ScrollEngineOptions): ScrollEngine {
  const axis = options.axis;
  const now =
    options.now ??
    (() =>
      typeof performance === 'undefined' ? Date.now() : performance.now());
  const cancelRaf =
    options.cancelRaf ??
    (typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (handle: number) => clearTimeout(handle));
  const raf =
    options.raf ??
    (typeof requestAnimationFrame === 'function'
      ? (callback: () => void) => requestAnimationFrame(callback)
      : (callback: () => void) =>
          setTimeout(callback, 16) as unknown as number);

  const [offset, setOffset] = createSignal(0);
  const [max, setMax] = createSignal(0);
  const [settled, setSettled] = createSignal(true);

  let visible = 1;
  let frame = 0;
  let mode: Mode = 'idle';
  let lastTime = 0;

  // Drag state: the anchor pair and the recognizer's velocity-sample chain.
  let startOffset = 0;
  let startPointer = 0;
  let lastSample = { p: 0, t: 0 };
  let sampleVelocity = 0;
  let blendPrevious = 0;
  let blendCurrent = 0;
  let moveCount = 0;

  // Flight state: the active velocity, the exponential curve, its snap
  // target in decel/glide, and the edge a bounce settles on.
  let velocity = 0;
  let flightRate = TOUCH_DECELERATION_RATE;
  let flightTarget: number | null = null;
  let bounceEdge = 0;
  let glideTarget = 0;
  let glideRate = SLOT_SETTLE_RATE;

  const clamp = (value: number) => Math.max(0, Math.min(max(), value));

  function apply(value: number) {
    if (value !== offset()) {
      setOffset(value);
      options.onOffset?.(value);
    }
  }

  function stopFrames() {
    if (frame !== 0) {
      cancelRaf(frame);
      frame = 0;
    }
  }

  function settleDone() {
    stopFrames();
    mode = 'idle';
    velocity = 0;
    flightTarget = null;
    setSettled(true);
    options.onSettle?.();
  }

  function startFrames() {
    lastTime = now();
    if (frame === 0) frame = raf(step);
  }

  function step() {
    const time = now();
    const dt = Math.max(0, Math.min(MAX_FRAME_MS, time - lastTime));
    lastTime = time;
    if (dt > 0) {
      if (mode === 'decel') decelStep(dt);
      else if (mode === 'bounce') bounceStep(dt);
      else if (mode === 'glide') glideStep(dt);
    }
    // A finishing mode called `settleDone` itself; a drag that started
    // mid-frame owns the scroller now. Either way, no next frame.
    if (mode !== 'idle' && mode !== 'dragging') frame = raf(step);
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
      apply(edge);
      bounceEdge = edge;
      mode = 'bounce';
      return;
    }
    if (!inside && (next < 0 ? velocity < 0 : next > maxV && velocity > 0)) {
      // Out of bounds and moving further out: the bounce owns this.
      bounceEdge = next < 0 ? 0 : maxV;
      mode = 'bounce';
      return;
    }
    apply(next);
    velocity *= decay;
    if (Math.abs(velocity) < VELOCITY_FLOOR) {
      if (offset() < 0 || offset() > maxV) {
        bounceEdge = offset() < 0 ? 0 : maxV;
        mode = 'bounce';
      } else if (flightTarget !== null) {
        // A snap flight lands exactly on its slot. The last fraction of a
        // unit crawls at the floor velocity, so hand the remainder to a
        // short glide rather than a one-frame teleport to the target.
        const target = flightTarget;
        flightTarget = null;
        glideTo(target, SLOT_SETTLE_RATE);
      } else {
        apply(clamp(Math.round(offset())));
        settleDone();
      }
    }
  }

  /** The bounce: the overshoot contracts at 0.99/ms with the carried velocity. */
  function bounceStep(dt: number) {
    const springK = Math.exp(dt * LN_BOUNCE);
    const decay = Math.exp(dt * LN_RATE);
    const edge = bounceEdge;
    const over = offset() - edge;
    const next =
      edge +
      over * springK +
      (velocity * TOUCH_DECELERATION_RATE * springK * (1 - decay)) /
        (1 - TOUCH_DECELERATION_RATE);
    velocity *= decay * springK;
    // A bounce carrying the content back across its edge hands off to a
    // free deceleration, as a fling released from an overscroll does.
    if (
      (edge === 0 && next > SETTLE_EPSILON && next < max()) ||
      (edge === max() && next < max() - SETTLE_EPSILON && next > 0)
    ) {
      apply(next);
      mode = 'decel';
      flightRate = TOUCH_DECELERATION_RATE;
      return;
    }
    apply(next);
    if (Math.abs(next - edge) < SETTLE_EPSILON && Math.abs(velocity) < 0.05) {
      apply(edge);
      settleDone();
    }
  }

  /** An exponential approach to a target: `to()` and a slot settle. */
  function glideStep(dt: number) {
    const decay = Math.exp(dt * Math.log(glideRate));
    const current = offset();
    const next = glideTarget + (current - glideTarget) * decay;
    apply(next);
    if (Math.abs(next - glideTarget) < SETTLE_EPSILON) {
      apply(glideTarget);
      settleDone();
    }
  }

  function glideTo(target: number, rate: number) {
    glideTarget = clamp(target);
    glideRate = rate;
    if (Math.abs(offset() - glideTarget) < SETTLE_EPSILON) {
      apply(glideTarget);
      settleDone();
      return;
    }
    setSettled(false);
    mode = 'glide';
    startFrames();
  }

  /** The rubber-band offset for a raw dragged position. */
  function rubber(raw: number): number {
    const maxV = max();
    if (raw < 0) {
      const x = -raw;
      const d = visible;
      return -d * (1 - 1 / ((x * RUBBER_BAND_COEFFICIENT) / d + 1));
    }
    if (raw > maxV) {
      const x = raw - maxV;
      const d = visible;
      return maxV + d * (1 - 1 / ((x * RUBBER_BAND_COEFFICIENT) / d + 1));
    }
    return raw;
  }

  function pushSample(p: number, t: number) {
    const dt = t - lastSample.t;
    if (dt > 0) {
      // The sample velocity is in offset space: a finger moving +p scrolls
      // the content the other way.
      const sample = (lastSample.p - p) / dt;
      blendPrevious = blendCurrent;
      blendCurrent =
        moveCount === 0
          ? sample
          : SAMPLE_BLEND_CURRENT * sample +
            (1 - SAMPLE_BLEND_CURRENT) * sampleVelocity;
      sampleVelocity = sample;
      moveCount++;
    }
    lastSample = { p, t };
  }

  /** The guarded low-pass over the recognizer blends, as UIKit releases it. */
  function releaseVelocity(): number {
    if (moveCount === 0) return 0;
    if (moveCount === 1) return blendCurrent;
    return (
      (1 - RELEASE_BLEND_LATEST) * blendPrevious +
      RELEASE_BLEND_LATEST * blendCurrent
    );
  }

  function snapSize(): number {
    const snap = options.snap;
    const value = typeof snap === 'function' ? snap() : snap;
    return value !== undefined && value > 0 ? value : 0;
  }

  /** The snap slot nearest `value`, with the content's end as a slot too. */
  function nearestSnap(value: number, slot: number): number {
    const maxV = max();
    const rounded = Math.max(
      0,
      Math.min(maxV, Math.round(value / slot) * slot),
    );
    let best = rounded;
    let bestDistance = Math.abs(value - best);
    const distance = Math.abs(value - maxV);
    if (distance < bestDistance) {
      best = maxV;
      bestDistance = distance;
    }
    return best;
  }

  function release() {
    const v = releaseVelocity();
    const maxV = max();
    const out = offset() < 0 || offset() > maxV;
    const inward = (offset() < 0 && v > 0) || (offset() > maxV && v < 0);
    const slot = snapSize();

    if (viewport().reducedMotion) {
      // Motion is optional: no fling, no settle. A snap still lands on a
      // slot, instantly; continuous scrolling stops where the finger did.
      if (out) apply(clamp(offset()));
      else if (slot > 0) apply(clamp(nearestSnap(offset(), slot)));
      else apply(clamp(Math.round(offset())));
      settleDone();
      return;
    }

    // Released past an edge: the bounce owns it, before any snap.
    if (out && !(Math.abs(v) >= FLING_MIN_VELOCITY && inward)) {
      flightTarget = null;
      bounceEdge = offset() < 0 ? 0 : maxV;
      velocity = inward ? 0 : v;
      setSettled(false);
      mode = 'bounce';
      startFrames();
      return;
    }

    if (slot > 0) {
      const landing = offset() + flingDistance(v);
      const target = nearestSnap(landing, slot);
      const distance = target - offset();
      if (
        Math.abs(v) >= FLING_MIN_VELOCITY &&
        Math.sign(distance) === Math.sign(v) &&
        Math.abs(distance) > 1
      ) {
        // A fling: decay at the rate that lands exactly on the slot, the
        // same exponential curve UIKit's paging uses to reach its page.
        flightRate = Math.abs(distance) / (Math.abs(distance) + Math.abs(v));
        flightTarget = target;
        velocity = v;
        setSettled(false);
        mode = 'decel';
        startFrames();
        return;
      }
      // Released slow or at rest: settle into the nearest slot.
      glideTo(target, SLOT_SETTLE_RATE);
      return;
    }

    if (Math.abs(v) >= FLING_MIN_VELOCITY) {
      flightTarget = null;
      flightRate = TOUCH_DECELERATION_RATE;
      velocity = v;
      setSettled(false);
      mode = 'decel';
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
    apply(Math.round(offset()));
    settleDone();
  }

  function to(value: number, duration = 0) {
    if (duration <= 0 || viewport().reducedMotion) {
      stopFrames();
      mode = 'idle';
      velocity = 0;
      apply(clamp(value));
      settleDone();
      return;
    }
    // An exponential approach that covers 99.9% of the distance in
    // `duration` ms: an iOS-shaped ease for programmatic scrolls.
    glideTo(value, Math.exp(Math.log(0.001) / duration));
  }

  function reveal(
    start: number,
    end: number,
    viewportSize: number,
    duration = 0,
  ) {
    if (start < offset()) to(start, duration);
    else if (end > offset() + viewportSize) to(end - viewportSize, duration);
  }

  function stop() {
    stopFrames();
    mode = 'idle';
    velocity = 0;
    setSettled(true);
  }

  function dragAxis(phase: 'start' | 'move' | 'end' | 'cancel', value: number) {
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
      apply(rubber(startOffset - (value - startPointer)));
      return;
    }
    if (mode !== 'dragging') return;
    mode = 'idle';
    pushSample(value, now());
    apply(rubber(startOffset - (value - startPointer)));
    if (phase === 'cancel') {
      // The platform took the gesture away: iOS animates back in bounds.
      const maxV = max();
      bounceEdge = offset() < 0 ? 0 : maxV;
      velocity = 0;
      if (offset() < -SETTLE_EPSILON || offset() > maxV + SETTLE_EPSILON) {
        setSettled(false);
        mode = 'bounce';
        startFrames();
      } else {
        apply(clamp(offset()));
        settleDone();
      }
      return;
    }
    release();
  }

  function drag(phase: 'start' | 'move' | 'end' | 'cancel', point: Point) {
    dragAxis(phase, axis === 'x' ? point.x : point.y);
  }

  return {
    offset,
    max,
    settled,
    dragging: () => mode === 'dragging',
    layout(content, visibleSize, inset = 0) {
      visible = Math.max(1, visibleSize);
      const next = Math.max(0, Math.max(0, content) + inset - visible);
      setMax(next);
      if (mode === 'idle' && offset() > next) apply(next);
    },
    to,
    reveal,
    stop,
    sync(value) {
      stopFrames();
      mode = 'idle';
      velocity = 0;
      apply(clamp(value));
      setSettled(true);
    },
    drag,
    dragAxis,
    velocity() {
      return mode === 'dragging' ? releaseVelocity() : velocity;
    },
  };
}
