import { ElementNode, NodeProps } from '@solid-multiplatform/platform';
import { Show } from 'solid-js';
import { Config } from '../core/config.js';

interface Props {
  transition?: {
    duration?: number;
    easing?: string;
  };
  when?: boolean;
}

const DEFAULT_PROPS = {
  duration: 250,
  easing: 'ease-in-out',
};

export const ALPHA_NONE = { alpha: 0 };
export const ALPHA_FULL = { alpha: 1 };

export function fadeIn(el: ElementNode): void {
  if (!el?.lng?.animate) return;
  if (!Config.animationsEnabled) return;
  el.alpha = 0;
  el.animate(ALPHA_FULL).start();
}
export function fadeOut(el: ElementNode): Promise<void> {
  if (!el?.lng?.animate) return Promise.resolve();
  if (!Config.animationsEnabled) return Promise.resolve();
  return el.animate(ALPHA_NONE).start().waitUntilStopped();
}

/** Motion settings the overlay entrances and exits take. */
export interface OverlayMotion {
  /** Milliseconds. Defaults to 250. */
  duration?: number;
  /** An easing name, or a function from progress to eased progress. */
  easing?: string | ((progress: number) => number);
  /**
   * Milliseconds before the fade-in track of an entrance begins. A panel
   * sliding in from off screen keeps alpha exactly 0 for this long: while it
   * travels it is "not there yet", which is how the layout audit and the
   * pointer both read alpha 0, so an audit run mid-entrance skips the
   * half-arrived panel instead of reporting the resting layout as cut off.
   * The fade still finishes with the rest of the motion.
   */
  fadeDelay?: number;
}

/** The values an entrance starts from, or an exit runs to. */
export interface OverlayMotionValues {
  alpha?: number;
  scale?: number;
  x?: number;
  y?: number;
  /** The node's own paint, not its children's: a barrier dimming. */
  color?: number;
}

const MOTION_KEYS = ['alpha', 'scale', 'x', 'y', 'color'] as const;
type MotionKey = (typeof MOTION_KEYS)[number];

/**
 * The iOS sheet curve from the repo's motion notes (`swiftui-motion.md`):
 * cubic-bezier(0.32, 0.72, 0, 1). A function rather than the bezier string,
 * so every backend runs the same curve: named easings and `cubic-bezier()`
 * strings are resolved per backend, a function is evaluated as given.
 */
export const sheetEasing = cubicBezier(0.32, 0.72, 0, 1);

/**
 * Where an overlay's fade-in starts when the panel does not move: low enough
 * to read as appearing, never 0 — the layout audit and the pointer hit test
 * both read alpha 0 as "not there", and a panel that only scales keeps its
 * resting geometry, so it must stay auditable and tappable while it enters.
 * A panel that slides in (a sheet, a drawer) starts from 0 instead: mid-slide
 * its box is genuinely off screen, and an audit run mid-entrance must skip it
 * rather than report the resting layout as cut off.
 */
export const OVERLAY_FADE_IN = 0.25;

/** A cubic-bezier easing, solved the way the renderer's own solver works. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton's method on x(s) = t, falling back to the seed when the slope
    // vanishes; eight passes land within a rounding step for these curves.
    let s = t;
    for (let pass = 0; pass < 8; pass++) {
      const x =
        3 * s * (1 - s) ** 2 * x1 + 3 * s * s * (1 - s) * x2 + s ** 3 - t;
      if (Math.abs(x) < 1e-5) break;
      const slope =
        3 * (1 - s) ** 2 * x1 +
        6 * s * (1 - s) * (x2 - x1) +
        3 * s * s * (1 - x2);
      if (Math.abs(slope) < 1e-5) break;
      s -= x / slope;
    }
    return 3 * s * (1 - s) ** 2 * y1 + 3 * s * s * (1 - s) * y2 + s ** 3;
  };
}

/**
 * An overlay's entrance. `from` names the values the entrance starts at; the
 * node's own position is already the static layout, and the animation lands
 * exactly back on it. Called from the panel's `onCreate`.
 *
 * `Config.animationsEnabled` off — which reduced motion also switches off —
 * skips straight to the resting state. The start values are written with any
 * `transition` prop held off, so a settle transition cannot turn the start
 * write itself into a fight.
 */
export function overlayEnter(
  el: ElementNode,
  from: OverlayMotionValues,
  motion: OverlayMotion = {},
): void {
  if (!el?.rendered || !Config.animationsEnabled) return;
  const rest: Partial<Record<MotionKey, number>> = {};
  let animated = false;
  for (const key of MOTION_KEYS) {
    const value = from[key];
    if (value === undefined) continue;
    rest[key] = el[key] as number;
    animated = true;
  }
  if (!animated) return;
  const transition = el.transition;
  el.transition = undefined;
  for (const key of MOTION_KEYS) {
    const value = from[key];
    if (value !== undefined) el[key] = value;
  }
  el.transition = transition;
  const duration = motion.duration ?? 250;
  const easing = motion.easing ?? 'ease-in-out';
  const delay = motion.fadeDelay;
  if (delay === undefined || rest.alpha === undefined) {
    el.animate(rest, { duration, easing }).start();
    return;
  }
  // The fade runs as its own track, starting late and landing with the rest.
  const { alpha, ...withoutAlpha } = rest;
  if (Object.keys(withoutAlpha).length > 0)
    el.animate(withoutAlpha, { duration, easing }).start();
  el.animate(
    { alpha: alpha! },
    { duration: duration - delay, delay, easing },
  ).start();
}

/**
 * An overlay's exit: run from the node's `onDestroy` (or handed to the
 * surface's `Modal`), it animates to `to` and resolves when the run stops, so
 * `destroy()` keeps the node attached until the exit has landed. Reduced
 * motion resolves immediately: the close is instant.
 */
export function overlayExit(
  el: ElementNode,
  to: OverlayMotionValues,
  motion: OverlayMotion = {},
): Promise<void> {
  if (!el?.rendered || !Config.animationsEnabled) return Promise.resolve();
  return el
    .animate(
      { ...to },
      {
        duration: motion.duration ?? 250,
        easing: motion.easing ?? 'ease-in-out',
      },
    )
    .start()
    .waitUntilStopped();
}

export function FadeInOut(props: Props & NodeProps) {
  const config = Object.assign({}, DEFAULT_PROPS, props.transition);
  function onCreate(elm: ElementNode) {
    overlayEnter(elm, ALPHA_NONE, config);
  }

  function onDestroy(elm: ElementNode) {
    return overlayExit(elm, ALPHA_NONE, config);
  }

  return (
    <Show when={props.when} keyed>
      <view {...props} onDestroy={onDestroy} onCreate={onCreate} />
    </Show>
  );
}
