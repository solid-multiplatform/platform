import { S } from './theme';
import type { UiFamily } from './family';

/**
 * One page box for every screen: a centred content column with equal side
 * margins. Headers, heroes, rails and lists all sit on its left edge, and
 * anything with a trailing action ends on its right edge — the alignment is
 * computed, not eyeballed. A phone uses the full width minus its margin; a
 * desktop window and a TV centre the column once it would grow past the max.
 */
export interface PageLayout {
  /** The column's x within the screen. */
  x: number;
  /** The column's width. */
  width: number;
  /** The screen's side margin (the gap outside the column). */
  margin: number;
}

const MARGINS: Record<UiFamily, number> = {
  mobile: S(5),
  desktop: S(8),
  tv: S(20),
};

const MAX_WIDTHS: Record<UiFamily, number> = {
  mobile: Infinity,
  desktop: 1180,
  tv: 1680,
};

export function pageLayout(width: number, family: UiFamily): PageLayout {
  const margin = MARGINS[family];
  const content = Math.max(0, Math.min(width - 2 * margin, MAX_WIDTHS[family]));
  return {
    x: Math.round((width - content) / 2),
    width: Math.round(content),
    margin,
  };
}
