/**
 * Text layout for the SceneGraph backend: the WebGL backend's line breaker
 * (word wrap by maxWidth, maxLines and maxHeight, the overflow suffix, the
 * three wordBreak modes, letter spacing, line height as a multiplier at or
 * below 3 and pixels above) run over this backend's font widths, and the
 * WebGL backend's placement of the block in its box (contain, textAlign,
 * verticalAlign, offsetY). The breaker itself is imported, not copied, so the
 * two backends cannot drift apart; only the widths differ, and those are the
 * widths the device draws.
 */
import { effectiveAlign, mapTextLayout } from '../webgl/src/core/text/TextLayout.js';
import type { SizedFont } from './font-metrics.js';

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type TextContain = 'none' | 'width' | 'height' | 'both';
export type WordBreak = 'overflow' | 'break-all' | 'break-word';

export interface TextLayoutInput {
  text: string;
  font: SizedFont;
  /** A multiplier of the font's line height at or below 3, else pixels. */
  lineHeight: number;
  maxWidth: number;
  maxHeight: number;
  maxLines: number;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  contain: TextContain;
  wordBreak: WordBreak;
  overflowSuffix: string;
  letterSpacing: number;
  offsetY: number;
  rtl: boolean;
}

export interface TextLine {
  text: string;
  width: number;
  /** The line's left edge inside the block. */
  x: number;
  /** The line's baseline below the block's top. */
  baseline: number;
}

export interface TextLayoutResult {
  lines: TextLine[];
  /** The widest line and the lines' total height: the text node's own `w` and `h`. */
  width: number;
  height: number;
  lineHeight: number;
  /** The box mount and pivot use: the contain size on an axis that has one, else the block's. */
  boxW: number;
  boxH: number;
  /** Where the block sits in the node. */
  boxX: number;
  boxY: number;
  /** The alignment drawn: `textAlign`, with left and right swapped under rtl. */
  align: TextAlign;
  /** The width lines align in: the contain width when there is one, else the block's. */
  alignWidth: number;
}

/** The scene's default optical baseline: the mean of cap and x height centred on the line. */
const BASELINE = 'optical';

export function layoutText(input: TextLayoutInput): TextLayoutResult {
  const font = input.font;
  const align = effectiveAlign(input.textAlign, input.rtl) as TextAlign;
  let lines: TextLine[] = [];
  let width = 0;
  let height = 0;
  let lineHeight = 0;
  // Empty text is a layout of no lines and no size, as on WebGL.
  if (input.text.length > 0) {
    const layout = mapTextLayout(
      (text: string, sized: SizedFont, spacing: number) => sized.measure(text, spacing),
      font.metrics,
      input.text,
      align,
      font,
      input.lineHeight,
      input.overflowSuffix,
      input.wordBreak,
      input.letterSpacing,
      input.maxLines,
      input.maxWidth,
      input.maxHeight,
      BASELINE,
    );
    lines = layout[0].map((line) => ({ text: line[0], width: line[1], x: line[3], baseline: line[4] }));
    lineHeight = layout[4];
    width = layout[5];
    height = layout[6];
  }

  // The WebGL backend's TextNodes.place.
  const inWidth = (input.contain === 'width' || input.contain === 'both') && input.maxWidth > 0;
  const inHeight = (input.contain === 'height' || input.contain === 'both') && input.maxHeight > 0;
  let boxX = 0;
  if (inWidth && align === 'right') boxX = input.maxWidth - width;
  else if (inWidth && align === 'center') boxX = (input.maxWidth - width) * 0.5;
  let boxY = 0;
  const slack = (input.maxHeight > 0 ? input.maxHeight : height) - height;
  if (slack > 0) {
    if (input.verticalAlign === 'bottom') boxY = slack;
    else if (input.verticalAlign === 'middle') boxY = slack * 0.5;
  }
  boxY += input.offsetY;

  return {
    lines,
    width,
    height,
    lineHeight,
    boxW: inWidth ? input.maxWidth : width,
    boxH: inHeight ? input.maxHeight : height,
    boxX,
    boxY,
    align,
    alignWidth: inWidth ? input.maxWidth : width,
  };
}
