import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { useViewport } from '@solid-multiplatform/platform/app';

export interface Pulse {
  /** 0..1 through the current phase. */
  progress: Accessor<number>;
  /** The phase's index, for a different look per step. */
  phase: Accessor<number>;
}

/**
 * SwiftUI's `phaseAnimator` for one property: steps through phases in order,
 * animating between them, and loops from the last back to the first. Unlike
 * SwiftUI's (which runs until removed) the sequence is bounded: it runs
 * `cycles` times and then schedules nothing, so an idle screen is idle.
 * Reduce Motion holds the first phase and schedules nothing at all.
 */
export function createPulse(options: {
  phases: number;
  duration?: number;
  paused?: () => boolean;
  /** How many times the sequence runs; the default settles after 3. */
  cycles?: number;
}): Pulse {
  const [progress, setProgress] = createSignal(0);
  const [phase, setPhase] = createSignal(0);
  onMount(() => {
    if (useViewport().reducedMotion) return;
    const duration = options.duration ?? 900;
    const phases = Math.max(1, options.phases);
    const cycles = Math.max(1, options.cycles ?? 3);
    let frame = 0;
    let start = performance.now();
    let index = 0;
    let remaining = phases * cycles;
    const step = (now: number) => {
      if (options.paused?.() === true) {
        start = now;
        frame = requestAnimationFrame(step);
        return;
      }
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      setPhase(index);
      setProgress(p);
      if (p >= 1) {
        index = (index + 1) % phases;
        start = now;
        // A sequence is an entrance, not a timer: it settles and stops.
        if (--remaining <= 0) {
          frame = 0;
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return { progress, phase };
}
