import { createSignal } from 'solid-js';
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
