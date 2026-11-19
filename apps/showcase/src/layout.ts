/**
 * The showcase's three window classes, and the few numbers that change
 * between them. A television is 1920 wide and keeps the 10-foot spacing the
 * scene has always used; a desktop window is narrower and the same spacing
 * still fits; a phone is at most 500 wide and portrait, so the margins and
 * the page header shrink and every list becomes one column.
 *
 * `breakpointFor` is pure so it can be read from a viewport subscription and
 * unit tested without a renderer. The thresholds are the showcase's, not the
 * SDK's Material window classes (`sdk/responsive`): this app needs a TV
 * class, which Material does not have.
 */
export type Layout = 'mobile' | 'desktop' | 'tv';

/** At or below this width the scene is a phone. */
export const MOBILE_MAX_WIDTH = 500;
/** Above this width the scene is a television: 1920 and wider. */
export const DESKTOP_MAX_WIDTH = 1600;

export function layoutFor(width: number): Layout {
  if (!(width > MOBILE_MAX_WIDTH)) return 'mobile';
  if (width <= DESKTOP_MAX_WIDTH) return 'desktop';
  return 'tv';
}

export interface LayoutMetrics {
  layout: Layout;
  /** Space between the safe edge and the content. */
  margin: number;
  /** The page title's position and size. */
  titleY: number;
  titleSize: number;
  /** The line under the title (target and probe status, on Home). */
  subtitleY: number;
  subtitleSize: number;
  /** Where a screen's content column starts. */
  screenBodyY: number;
  /** Where Home's list of sections starts. */
  homeBodyY: number;
  /** Gap inside a column. */
  gap: number;
  /** Height of a Home card. */
  tileHeight: number;
}

/**
 * The numbers for a width. Desktop and television return exactly what the
 * scene used before it was adaptive, so 1920 renders unchanged (the Roku
 * visual suite depends on it) and 1280 keeps the geometry its mouse test
 * clicks against.
 */
export function metricsFor(width: number): LayoutMetrics {
  const layout = layoutFor(width);
  if (layout === 'mobile')
    return {
      layout,
      margin: 16,
      titleY: 10,
      titleSize: 26,
      subtitleY: 42,
      subtitleSize: 15,
      screenBodyY: 60,
      homeBodyY: 70,
      gap: 10,
      tileHeight: 84,
    };
  return {
    layout,
    margin: 32,
    titleY: 18,
    titleSize: 34,
    subtitleY: 68,
    subtitleSize: 18,
    screenBodyY: 76,
    homeBodyY: 110,
    gap: 16,
    tileHeight: 110,
  };
}
