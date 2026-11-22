import { useContext, type Accessor } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { AppScope } from '../app/context.js';
import { viewport, type Insets } from './viewport.js';

/**
 * The one layout maths an app needs: where the safe content goes, and how a
 * fixed-size surface (a dialog, a calendar, a menu) fits inside it.
 *
 * Everything here is reactive when read inside a component and pure when
 * given a viewport, so the same helpers drive a live scene and a build-time
 * audit. Sizes are logical units (points on a phone, design units where the
 * app supplies a design size).
 */

/** A rectangle in scene units. */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentBoxOptions {
  /** The widest the content column may grow. Defaults to no limit. */
  maxWidth?: number;
  /**
   * The minimum gap between the safe area and the content. A wide window
   * keeps this gutter and centres the capped column; a narrow one shrinks it
   * rather than pushing the content off the edge. Defaults to 16.
   */
  gutter?: number;
  /** Extra padding inside the safe area, on every edge. Defaults to 0. */
  padding?: number;
  /** Respect the host's safe area. Defaults to true. */
  safeArea?: boolean;
  /** Keep content above the software keyboard. Defaults to true. */
  keyboard?: boolean;
}

/** Everything a screen needs to place its own content. */
export interface ContentBox extends LayoutRect {
  /** The insets the box was derived from. */
  insets: Insets;
  /** The gutter actually used (a narrow window shrinks it). */
  gutter: number;
}

const finite = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The safe content box for a viewport: the window minus its insets, minus a
 * gutter, capped to a readable width and centred on the cross axis. This is
 * the `pageLayout` every screen otherwise reinvents, with the one difference
 * that a gutter too large for the window shrinks instead of overflowing.
 */
export function contentBoxFor(
  v: { width: number; height: number; insets: ViewportInsetsLike },
  options: ContentBoxOptions = {},
): ContentBox {
  const safe = options.safeArea === false ? ZERO : v.insets.safeArea;
  const ime = options.keyboard === false ? ZERO : v.insets.ime;
  const padding = Math.max(0, finite(options.padding, 0));
  const requested = Math.max(0, finite(options.gutter, 16));
  // Never spend more than half the usable width on the two gutters: on a
  // 320-wide phone a 20-unit gutter would otherwise leave less than a 44-pt
  // control per column.
  const usableWidth = Math.max(
    0,
    v.width - safe.left - safe.right - 2 * padding,
  );
  const gutter = Math.min(requested, Math.max(0, usableWidth / 2 - 1));
  const availableWidth = Math.max(0, usableWidth - 2 * gutter);
  const width = Math.max(
    0,
    Math.min(availableWidth, finite(options.maxWidth, availableWidth)),
  );
  const bottom = Math.max(safe.bottom, ime.bottom);
  const x = safe.left + padding + gutter + (availableWidth - width) / 2;
  const y = safe.top + padding;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(Math.max(0, v.height - safe.top - bottom - 2 * padding)),
    insets: safe,
    gutter: Math.round(gutter),
  };
}

interface ViewportInsetsLike {
  safeArea: Insets;
  ime: Insets;
}

const ZERO: Insets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

/**
 * Reactive safe content box. Call inside a component; reading the viewport
 * signal makes the result update on rotation, resize, keyboard and insets.
 *
 * ```tsx
 * const box = useContentBox({ maxWidth: 1180, gutter: 32 });
 * <Column x={box().x} y={box().y} width={box().width} height={box().height} />
 * ```
 */
export const useContentBox: (
  options?: ContentBoxOptions,
) => Accessor<ContentBox> =
  (options = {}) =>
  () =>
    contentBoxFor(viewport(), options);

/**
 * The design-space scale the app is running at: the factor between the
 * design coordinate space (`designSize`) and the screen. Apps without a
 * design size run at 1, so the same expression drives both.
 *
 * A portaled surface (dialog, menu, toast) lives outside `Screen`'s scaled
 * column. Multiply its design-unit constants by this to keep it the same
 * visual size as the app.
 */
export function useUiScale(): number {
  const scope = useContext(AppScope);
  const v = viewport();
  const design = scope?.designSize;
  if (design === undefined || design.width <= 0 || design.height <= 0) return 1;
  return Math.min(v.width / design.width, v.height / design.height);
}

/** A size that never exceeds the room available after a margin on each side. */
export function fitSize(
  preferred: number,
  available: number,
  margin: number = 0,
): number {
  return Math.max(0, Math.min(preferred, available - 2 * margin));
}

/** A size that never drops below `min` while still fitting the room. */
export function clampSize(
  value: number,
  min: number,
  available: number,
  margin: number = 0,
): number {
  const room = Math.max(0, available - 2 * margin);
  return Math.max(Math.min(min, room), Math.min(value, room));
}

/** Centre a box of `size` in `available`, never leaving the room. */
export function centerIn(size: number, available: number): number {
  return Math.max(0, (available - size) / 2);
}

/**
 * A node's box in viewport units, following every ancestor's translation and
 * scale. `absX`/`absY` on the renderer node are layout coordinates; a scaled
 * `Screen` (a TV design space) makes the drawn box different. Use this for
 * anything that leaves the scaled column: an anchored menu, a host editor, a
 * pointer handoff.
 */
export function screenRect(node: ElementNode): LayoutRect {
  const chain: ElementNode[] = [];
  for (let n: ElementNode | undefined = node; n; n = n.parent) chain.unshift(n);
  let x = 0;
  let y = 0;
  let scale = 1;
  for (const n of chain) {
    x += (n.x || 0) * scale;
    y += (n.y || 0) * scale;
    scale *= n.scale || 1;
  }
  return {
    x,
    y,
    width: (node.width || 0) * scale,
    height: (node.height || 0) * scale,
  };
}
