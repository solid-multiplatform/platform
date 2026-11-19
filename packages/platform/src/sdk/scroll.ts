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
 * Apple's `UIScrollView.DecelerationRate.normal`: velocity keeps this fraction
 * per millisecond. The local UIKit reference does not print the number, so
 * this uses 0.998 per millisecond until the mobile demo's rewritten engine is
 * the reference; see `docs/app-api.md#scrolling`.
 */
export const TOUCH_DECELERATION_RATE = 0.998;

/** UIScrollView's rubber-band coefficient, `UIScrollViewRubberBandFactor`. */
export const RUBBER_BAND_COEFFICIENT = 0.55;

/** Movement, in scene units, before a nested gesture locks to one axis. */
export const AXIS_LOCK_SLOP = 10;

/** Velocity, in scene units per millisecond, at which a fling stops. */
const MIN_FLING_VELOCITY = 0.02;
/** Only the last 100 ms of pointer samples decide the release velocity. */
const VELOCITY_WINDOW_MS = 100;
/** A frame longer than this (a background tab) is not allowed to jump. */
const MAX_FRAME_MS = 64;
const SNAP_SETTLE_MS = 220;
const SNAP_SETTLE_PER_VELOCITY = 140;
const SNAP_SETTLE_MAX_MS = 620;
const RUBBER_BAND_RETURN_MS = 220;
const SETTLED_DISTANCE = 0.5;

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
 * How far a fling with `velocity` (scene units per millisecond) travels with
 * a per-millisecond deceleration rate: `v / (1 - rate)`.
 */
export function flingDistance(
  velocity: number,
  rate = TOUCH_DECELERATION_RATE,
): number {
  return velocity / (1 - rate);
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
  /** Release velocity from the last 100 ms, in units per millisecond. */
  velocity(): number;
}

interface Sample {
  p: number;
  t: number;
}

/**
 * The framework's touch scroller. One module, no dependency beyond
 * `requestAnimationFrame`; see {@link ScrollEngine}.
 */
export function createScrollEngine(options: ScrollEngineOptions): ScrollEngine {
  const axis = options.axis;
  const rate = options.decelerationRate ?? TOUCH_DECELERATION_RATE;
  const coefficient = options.rubberBand ?? RUBBER_BAND_COEFFICIENT;
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

  let visible = 0;
  let frame = 0;
  let dragging = false;
  let startOffset = 0;
  let startPointer = 0;
  let lastVelocity = 0;
  let samples: Sample[] = [];

  const clamp = (value: number) => Math.max(0, Math.min(max(), value));

  function apply(value: number) {
    if (value !== offset()) {
      setOffset(value);
      options.onOffset?.(value);
    }
  }

  function cancelFrame() {
    if (frame !== 0) {
      cancelRaf(frame);
      frame = 0;
    }
  }

  function settleDone() {
    frame = 0;
    setSettled(true);
    options.onSettle?.();
  }

  function stop() {
    cancelFrame();
    dragging = false;
    setSettled(true);
  }

  function rubber(value: number): number {
    if (value < 0) {
      return -rubberBandDistance(-value, visible || max() || 1, coefficient);
    }
    if (value > max()) {
      return (
        max() +
        rubberBandDistance(value - max(), visible || max() || 1, coefficient)
      );
    }
    return value;
  }

  function push(pointer: number, time: number) {
    samples.push({ p: pointer, t: time });
    while (samples.length > 2 && time - samples[0]!.t > 110) samples.shift();
  }

  function sampleVelocity(): number {
    const count = samples.length;
    if (count < 2) return 0;
    const last = samples[count - 1]!;
    let first = samples[0]!;
    for (let i = 0; i < count; i++) {
      if (last.t - samples[i]!.t <= VELOCITY_WINDOW_MS) {
        first = samples[i]!;
        break;
      }
    }
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return -(last.p - first.p) / dt;
  }

  function snapSize(): number {
    const snap = options.snap;
    const value = typeof snap === 'function' ? snap() : snap;
    return value !== undefined && value > 0 ? value : 0;
  }

  /**
   * Cubic settle used for a snap slot and for a rubber-band return. A
   * quantised target cannot be approached with the free fling's exponential
   * curve without a long tail; the demo's reference scroller uses the same
   * short ease.
   */
  function animateTo(value: number, duration: number) {
    cancelFrame();
    const from = offset();
    const target = clamp(value);
    if (duration <= 0 || viewport().reducedMotion) {
      apply(target);
      settleDone();
      return;
    }
    if (Math.abs(target - from) < SETTLED_DISTANCE) {
      apply(target);
      settleDone();
      return;
    }
    setSettled(false);
    const started = now();
    const step = () => {
      const t = Math.min(1, (now() - started) / duration);
      apply(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) {
        frame = raf(step);
      } else {
        apply(target);
        settleDone();
      }
    };
    frame = raf(step);
  }

  function fling(velocity: number) {
    lastVelocity = velocity;
    if (Math.abs(velocity) < MIN_FLING_VELOCITY) {
      apply(clamp(offset()));
      settleDone();
      return;
    }
    setSettled(false);
    const k = -Math.log(rate);
    let v = velocity;
    let last = now();
    const step = () => {
      const time = now();
      const dt = Math.min(MAX_FRAME_MS, time - last);
      last = time;
      if (dt <= 0) {
        frame = raf(step);
        return;
      }
      const decay = Math.exp(-k * dt);
      const next = offset() + (v * (1 - decay)) / k;
      v *= decay;
      if (next <= 0) {
        apply(0);
        settleDone();
        return;
      }
      if (next >= max()) {
        apply(max());
        settleDone();
        return;
      }
      apply(next);
      if (Math.abs(v) < MIN_FLING_VELOCITY) {
        apply(clamp(next));
        settleDone();
        return;
      }
      frame = raf(step);
    };
    frame = raf(step);
  }

  function release() {
    const velocity = sampleVelocity();
    lastVelocity = velocity;
    if (viewport().reducedMotion) {
      // Motion is optional: no fling and no settle. A snap still lands on a
      // slot, instantly; continuous scrolling stops where the finger left it.
      const slot = snapSize();
      if (offset() < 0 || offset() > max()) {
        apply(clamp(offset()));
      } else if (slot > 0) {
        const natural = offset() + flingDistance(velocity, rate);
        apply(clamp(Math.round(natural / slot) * slot));
      }
      settleDone();
      return;
    }
    if (offset() < 0 || offset() > max()) {
      animateTo(clamp(offset()), RUBBER_BAND_RETURN_MS);
      return;
    }
    const slot = snapSize();
    if (slot > 0) {
      const natural = offset() + flingDistance(velocity, rate);
      const target = clamp(Math.round(natural / slot) * slot);
      if (
        Math.abs(velocity) < MIN_FLING_VELOCITY &&
        Math.abs(target - offset()) < SETTLED_DISTANCE
      ) {
        apply(target);
        settleDone();
        return;
      }
      animateTo(
        target,
        Math.min(
          SNAP_SETTLE_MAX_MS,
          SNAP_SETTLE_MS + Math.abs(velocity) * SNAP_SETTLE_PER_VELOCITY,
        ),
      );
      return;
    }
    fling(velocity);
  }

  function to(value: number, duration = 0) {
    cancelFrame();
    const target = clamp(value);
    if (duration <= 0 || viewport().reducedMotion) {
      apply(target);
      settleDone();
      return;
    }
    animateTo(target, duration);
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

  function dragAxis(phase: 'start' | 'move' | 'end' | 'cancel', value: number) {
    if (phase === 'start') {
      cancelFrame();
      dragging = true;
      setSettled(false);
      startOffset = offset();
      startPointer = value;
      samples = [];
      push(value, now());
      return;
    }
    if (phase === 'move') {
      if (!dragging) return;
      push(value, now());
      apply(rubber(startOffset - (value - startPointer)));
      return;
    }
    if (!dragging) return;
    push(value, now());
    dragging = false;
    if (phase === 'cancel') animateTo(clamp(offset()), RUBBER_BAND_RETURN_MS);
    else release();
  }

  function drag(phase: 'start' | 'move' | 'end' | 'cancel', point: Point) {
    dragAxis(phase, axis === 'x' ? point.x : point.y);
  }

  return {
    offset,
    max,
    settled,
    layout(content, visibleSize, inset = 0) {
      visible = Math.max(0, visibleSize);
      setMax(Math.max(0, Math.max(0, content) + inset - visible));
      if (!dragging && frame === 0 && offset() > max()) apply(max());
    },
    to,
    reveal,
    stop,
    sync(value) {
      cancelFrame();
      apply(clamp(value));
      setSettled(true);
    },
    drag,
    dragAxis,
    velocity() {
      return dragging ? sampleVelocity() : lastVelocity;
    },
  };
}
