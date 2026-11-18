import { createSignal } from 'solid-js';
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
