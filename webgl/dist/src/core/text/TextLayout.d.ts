import { type NormalizedFontMetrics, type SdfFont } from './sdfFont.js';
/**
 * The renderer-wide baseline anchor (the `textBaselineMode` setting, 1.10's
 * engine-wide value): which height a line's mid-line centres. 'optical'
 * (the default) centres the mean of the cap and x heights, 'cap' the cap
 * height, 'x' the x height, 'linebox' the ascender to descender box.
 */
export type TextBaselineMode = 'optical' | 'cap' | 'x' | 'linebox';
/**
 * Slack on the line breaker's width limit, in design units. A reported
 * width goes through the font scale and back, which can leave it a ulp
 * short of itself: a maxWidth equal to it would then cut its own text.
 */
export declare const WIDTH_TOLERANCE = 0.000001;
/**
 * The line breaker of 1.10's TextLayoutEngine, ported with its semantics
 * (the text snapshots pin them): lines of strings first (word wrap by
 * `maxWidth`, `maxLines` and `maxHeight`, `overflowSuffix`, the three
 * `wordBreak` strategies, letter spacing, line height multipliers at or
 * below 3, `textAlign`, the baseline anchor), then glyph runs. `measure`
 * is the font's width function and `font` the value it reads, so the
 * breaker can be tested with any font stand-in.
 */
export type MeasureTextFn<F> = (text: string, font: F, letterSpacing: number) => number;
/** A line: text, width, truncated, x offset, baseline y (1.10 TextLineStruct). */
export type TextLineStruct = [string, number, boolean, number, number];
/** Lines, lines left, text left (1.10 WrappedLinesStruct). */
export type WrappedLinesStruct = [TextLineStruct[], number, boolean];
/**
 * Lines, lines left, text left, bare line height, line height, width,
 * height (1.10 TextLayoutStruct).
 */
export type TextLayoutStruct = [
    TextLineStruct[],
    number,
    boolean,
    number,
    number,
    number,
    number
];
/**
 * Lay `text` out in lines (1.10 mapTextLayout). Widths are in the units
 * `measureText` returns; `lineHeight` at or below 3 multiplies the font's
 * line height (ascender, descender and line gap); `baselineMode` anchors
 * each line's baseline (1.10's engine-wide `textBaselineMode`, per
 * renderer here).
 */
export declare function mapTextLayout<F>(measureText: MeasureTextFn<F>, metrics: NormalizedFontMetrics, text: string, textAlign: string, font: F, lineHeight: number, overflowSuffix: string, wordBreak: string, letterSpacing: number, maxLines: number, maxWidth: number, maxHeight: number, baselineMode: TextBaselineMode): TextLayoutStruct;
/**
 * Lines without wrapping, up to `maxLines` (1.10 measureLines). The loop
 * ends at the last line too: `maxLines` is Infinity when given so, or when
 * maxHeight meets a line height of 0 (or is Infinity), and 1.10, counting
 * off the missing lines past the last, then never returned.
 */
export declare function measureLines<F>(measureText: MeasureTextFn<F>, lines: string[], font: F, letterSpacing: number, maxLines: number): WrappedLinesStruct;
/** Wrap every `\n` line at `maxWidth` (1.10 wrapText). */
export declare function wrapText<F>(measureText: MeasureTextFn<F>, text: string, font: F, maxWidth: number, letterSpacing: number, overflowSuffix: string, wordBreak: string, maxLines: number): WrappedLinesStruct;
/** Wrap one line at `maxWidth` (1.10 wrapLine). */
export declare function wrapLine<F>(measureText: MeasureTextFn<F>, line: string, font: F, maxWidth: number, letterSpacing: number, spaceWidth: number, overflowSuffix: string, overflowWidth: number, wordBreak: string, remainingLines: number): WrappedLinesStruct;
/**
 * 'overflow' (1.10): the word joins the line past `maxWidth`, which ends
 * there, with the suffix on the last line allowed.
 */
export declare function overflow<F>(measureText: MeasureTextFn<F>, word: string, wordWidth: number, font: F, letterSpacing: number, wrappedLines: TextLineStruct[], currentLine: string, currentLineWidth: number, remainingLines: number, remainingWord: string, maxWidth: number, space: string, spaceWidth: number, overflowSuffix: string, overflowWidth: number): [string, number, string];
/**
 * 'break-word' (1.10): the line ends before the word, which starts the
 * next; on the last line allowed the line is truncated with the suffix.
 */
export declare function breakWord<F>(measureText: MeasureTextFn<F>, word: string, wordWidth: number, font: F, letterSpacing: number, wrappedLines: TextLineStruct[], currentLine: string, currentLineWidth: number, remainingLines: number, remainingWord: string, maxWidth: number, space: string, spaceWidth: number, overflowSuffix: string, overflowWidth: number): [string, number, string];
/**
 * 'break-all' (1.10): the word fills the rest of the line and continues on
 * the next (truncated with the suffix on the last line allowed).
 */
export declare function breakAll<F>(measureText: MeasureTextFn<F>, word: string, wordWidth: number, font: F, letterSpacing: number, wrappedLines: TextLineStruct[], currentLine: string, currentLineWidth: number, remainingLines: number, remainingWord: string, maxWidth: number, space: string, spaceWidth: number, overflowSuffix: string, overflowWidth: number): [string, number, string];
/**
 * End `currentLine` with the suffix, removing characters from its end
 * until both fit `maxWidth` (1.10 truncateLineEnd); only the suffix when
 * nothing fits beside it.
 */
export declare function truncateLineEnd<F>(measureText: MeasureTextFn<F>, font: F, letterSpacing: number, currentLine: string, currentLineWidth: number, remainingWord: string, maxWidth: number, overflowSuffix: string, overflowWidth: number): [string, number, string];
/**
 * The start of `word` that fits `maxWidth` with the suffix after it, the
 * rest, and its width (1.10 truncateWord). Whether it removes characters
 * from the end or adds them from the start depends on how much is cut, as
 * in 1.10.
 */
export declare function truncateWord<F>(measureText: MeasureTextFn<F>, word: string, wordWidth: number, maxWidth: number, font: F, letterSpacing: number, overflowSuffix: string, overflowWidth: number): [string, string, number];
/**
 * The start of `word` that fits `maxWidth`, the rest, and its width (1.10
 * splitWord), searched as truncateWord searches.
 */
export declare function splitWord<F>(measureText: MeasureTextFn<F>, word: string, wordWidth: number, maxWidth: number, font: F, letterSpacing: number): [string, string, number];
/** The text props a layout depends on (spec 10.2). */
export interface TextLayoutProps {
    text: string;
    fontSize: number;
    fontStyle: string;
    letterSpacing: number;
    lineHeight: number;
    maxWidth: number;
    maxHeight: number;
    maxLines: number;
    textAlign: string;
    wordBreak: string;
    overflowSuffix: string;
    /**
     * The resolved layout direction: under rtl, `left` and `right` swap
     * (effectiveAlign). A cache key like the rest, so a `left` text under RTL
     * and a `right` text under LTR are two entries.
     */
    rtl: boolean;
}
/**
 * The horizontal alignment a layout uses: `left` and `right` swap under
 * rtl, anything else (`center`) is as written.
 */
export declare const effectiveAlign: (textAlign: string, rtl: boolean) => string;
/**
 * A text's glyph runs (spec 10.2): 8 words per glyph, `f32` and `u32`
 * over one buffer. Words 0 to 3 are the glyph's x, y, width and height in
 * atlas design units (Float32, as 1.10 stored them, so the emitter's
 * arithmetic matches its); words 4 to 7 its UV rect in the atlas, u1, v1,
 * u2, v2 (Float32, as 1.10 stored them). Width and
 * height are in pixels; `distanceRange` is the atlas range at this size,
 * the glyph vertices' `a_extra`.
 */
export interface TextLayout {
    readonly f32: Float32Array;
    readonly u32: Uint32Array;
    readonly glyphCount: number;
    readonly width: number;
    readonly height: number;
    readonly fontScale: number;
    readonly lineHeight: number;
    readonly distanceRange: number;
}
/** Words per glyph in a TextLayout. */
export declare const GLYPH_WORDS = 8;
/**
 * Glyph runs for `props` in `font` (1.10 generateTextLayout): the lines of
 * mapTextLayout, each glyph placed at the line's offset and baseline, kerned
 * against the one before it, advanced by its width plus the letter spacing
 * (in design units); a zero width space or an invisible character draws
 * nothing, and a missing glyph the fallback. A glyph without area (the
 * space) advances and kerns as any other but stores no quad, where 1.10
 * drew it as an empty one. Empty text is a layout of no glyphs and no size
 * (1.10 skipped the layout).
 */
export declare function layoutText(props: TextLayoutProps, font: SdfFont, baselineMode: TextBaselineMode): TextLayout;
/**
 * Layouts by content (spec 10.2), shared by every node that lays out the
 * same text the same way, least recently used first out: bounded on
 * insert (an animating scene never idles, and a clock's text changes every
 * second) and trimmed again at idle maintenance. Found by font (its
 * record's id), then by the text itself (a string caches its own hash, so
 * a lookup builds nothing), then by the other props, compared one by one
 * along the text's few layouts (a NaN prop never matches, so it lays out
 * anew). A use stamps the layout with the cache's clock; an eviction
 * drops the lowest stamp.
 */
export declare class LayoutCache {
    max: number;
    /** Per font record id, the latest layout of each text, the rest chained. */
    private readonly fonts;
    /** Every layout cached, in no order. */
    private readonly entries;
    private clock;
    constructor(max: number);
    get size(): number;
    /**
     * The layout cached for `p` in font `font`, now the most recently used,
     * or undefined.
     */
    get(font: number, p: TextLayoutProps): TextLayout | undefined;
    /** Cache `layout` for `p` in font `font` (one get missed it). */
    set(font: number, p: TextLayoutProps, layout: TextLayout): void;
    /**
     * Drop the least recently used layouts beyond `max`; below 0, as at 0,
     * none stays (an empty cache is never smaller than a negative max).
     */
    trim(): void;
    /** Drop the layout used longest ago. */
    private evictOldest;
}
