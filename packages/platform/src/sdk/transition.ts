import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  type Accessor,
} from 'solid-js';
import { viewport } from './viewport.js';

export type TransitionType = 'fade' | 'slide-up' | 'slide-down' | 'scale';

export interface TransitionOptions {
  /** Controls whether the content is shown. */
  when: boolean | (() => boolean);
  type?: TransitionType;
  /** Milliseconds. Defaults to 220. */
  duration?: number;
  /** Slide distance in logical units. Defaults to 24. */
  distance?: number;
  onExited?(): void;
}

export interface TransitionValues {
  /** True while entering, visible, or exiting. Render the subtree on this. */
  mounted: Accessor<boolean>;
  /** Current animation progress, 0..1. */
  progress: Accessor<number>;
  alpha: Accessor<number>;
  /** Vertical offset for slide transitions. */
  y: Accessor<number>;
  /** Scale for the scale transition. */
  scale: Accessor<number>;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const valueOf = (value: boolean | (() => boolean)): boolean =>
  typeof value === 'function' ? (value as () => boolean)() : value;

/**
 * Enter/exit transition values for a scene subtree. The app applies `alpha`,
 * `y` and `scale` to its own view, so layout stays under app control and no
 * extra wrapper is introduced. Only animates while the transition is active;
 * the idle scene schedules no frames. Reduced-motion hosts snap instantly.
 *
 * ```tsx
 * const t = useTransition({ when: open, type: 'slide-up' });
 * <Show when={t.mounted()}>
 *   <view alpha={t.alpha()} y={t.y()} ... />
 * </Show>
 * ```
 */
export function useTransition(options: TransitionOptions): TransitionValues {
  const type = () => options.type ?? 'fade';
  const duration = () => options.duration ?? 220;
  const distance = () => options.distance ?? 24;
  const [mounted, setMounted] = createSignal(valueOf(options.when));
  const [progress, setProgress] = createSignal(mounted() ? 1 : 0);
  let frame = 0;

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const animate = (to: 0 | 1, done?: () => void) => {
    stop();
    const from = progress();
    if (
      duration() <= 0 ||
      viewport().reducedMotion ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      setProgress(to);
      done?.();
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - started) / duration()));
      setProgress(from + (to - from) * easeOutCubic(t));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
        done?.();
      }
    };
    frame = requestAnimationFrame(tick);
  };

  createEffect(
    on(
      () => valueOf(options.when),
      (visible) => {
        if (visible) {
          setMounted(true);
          animate(1);
        } else {
          animate(0, () => {
            setMounted(false);
            options.onExited?.();
          });
        }
      },
      { defer: true },
    ),
  );

  onCleanup(stop);

  return {
    mounted,
    progress,
    alpha: progress,
    y: () => {
      if (type() !== 'slide-up' && type() !== 'slide-down') return 0;
      const direction = type() === 'slide-up' ? 1 : -1;
      return (1 - progress()) * distance() * direction;
    },
    scale: () => (type() === 'scale' ? 0.96 + 0.04 * progress() : 1),
  };
}
