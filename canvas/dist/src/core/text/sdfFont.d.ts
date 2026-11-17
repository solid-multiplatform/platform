import type { FontMetrics } from '../../common/types.js';
/** One glyph of an msdf-bmfont-xml atlas description, in atlas design units. */
export interface SdfGlyph {
    id: number;
    char?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
    page?: number;
    chnl?: number;
}
/** An MSDF or SSDF atlas description (msdf-bmfont-xml JSON, 1.10 SdfFontData). */
export interface SdfFontData {
    pages: string[];
    chars: SdfGlyph[];
    kernings: {
        first: number;
        second: number;
        amount: number;
    }[];
    info: {
        face: string;
        size: number;
    };
    common: {
        lineHeight: number;
        base: number;
        scaleW: number;
        scaleH: number;
    };
    distanceField: {
        fieldType: 'sdf' | 'msdf';
        distanceRange: number;
    };
    lightningMetrics?: FontMetrics;
}
/** Font metrics in pixels at one font size (1.10 NormalizedFontMetrics). */
export interface NormalizedFontMetrics {
    ascender: number;
    descender: number;
    lineGap: number;
    capHeight: number;
    xHeight: number;
}
/** Kerning amount by second glyph id, then first glyph id. */
export type KerningTable = Record<number, Record<number, number | undefined> | undefined>;
/**
 * A glyph as the layout reads it, made once per glyph when the font is
 * parsed, one shape for every glyph whatever fields its JSON has: its
 * advance, offsets and size in atlas design units, its corner UVs packed
 * (v << 16) | u in 1/32768ths of the atlas, top-left, top-right,
 * bottom-left, bottom-right (TextLayout's GLYPH_WORDS), and its kerning:
 * `kernColumn`, its column in the rows when it is the first glyph of a
 * pair (-1 when it starts none, or its id is 0, which 1.10 read as no
 * glyph before), and `kern`, its row when it is the second glyph of one,
 * or null: by the first glyph's column, where the pair's amount is in the
 * font's `kernAmounts`, 0 where the two make no pair.
 */
export declare class GlyphRecord {
    readonly xadvance: number;
    readonly xoffset: number;
    readonly yoffset: number;
    readonly width: number;
    readonly height: number;
    readonly uvTopLeft: number;
    readonly uvTopRight: number;
    readonly uvBottomLeft: number;
    readonly uvBottomRight: number;
    readonly kernColumn: number;
    readonly kern: KerningRow | null;
    constructor(glyph: SdfGlyph, kernColumn: number, kern: KerningRow | null, invAtlasWidth: number, invAtlasHeight: number);
}
/** A kerning row: Uint32Array for a font of 65536 pairs or more. */
type KerningRow = Uint16Array | Uint32Array;
/** A page of 256 code points, null where the font has no glyph. */
type GlyphPage = (GlyphRecord | null)[];
/**
 * A loaded atlas description: the glyph and kerning lookups, the metrics
 * (cap and x height derived from the atlas when absent), and the metrics
 * normalized per font size, the last 64 cached (1.10 FontMetricsCache,
 * which kept every size). The layout looks a code point's glyph up in
 * `pages` (code >> 8, then code & 255) below U+10000 and in `astral` above,
 * the glyph `glyphs` gives it, takes `fallback` when there is none, and
 * reads a kerning amount from `kernAmounts` (see GlyphRecord).
 */
export interface SdfFont {
    readonly data: SdfFontData;
    readonly glyphs: Map<number, SdfGlyph>;
    readonly kernings: KerningTable;
    readonly metrics: FontMetrics;
    readonly sizes: Map<number, NormalizedFontMetrics>;
    readonly pages: GlyphPage[];
    readonly astral: Map<number, GlyphRecord>;
    readonly fallback: GlyphRecord | null;
    readonly kernAmounts: Float64Array;
}
/**
 * The glyph a missing codepoint draws: `?` in development builds, a space
 * in production (1.10).
 */
export declare const FALLBACK_GLYPH: number;
/**
 * Zero-width characters that draw nothing and take no width: zero-width
 * non-joiner and joiner, byte order mark, soft hyphen, word joiner. The
 * zero-width space (0x200b) is tested on its own, before these, as 1.10
 * did. 1.10 tested them with a global regular expression whose state
 * carried between calls; this test has none (spec 14).
 */
export declare const isInvisible: (code: number) => boolean;
/**
 * The code point at `i` (an index in range), as
 * `String.prototype.codePointAt` reads it: a surrogate pair's code point at
 * its high half, else the code unit, a lone surrogate included. Not the
 * built-in: Chrome 41, above the Chrome 38 floor.
 */
export declare function codePointAt(text: string, i: number): number;
/**
 * Parse an atlas description into its lookups (1.10 processFontData). The
 * metrics are `metrics`, else the JSON's `lightningMetrics`, else 1.10's
 * defaults (with a warning); a cap or x height they lack is derived from
 * glyph `H` or `x` in the atlas: the distance from the baseline (`base`)
 * to the glyph's top, in font units.
 */
export declare function parseSdfFont(name: string, data: SdfFontData, metrics: FontMetrics | undefined): SdfFont;
/** `metrics` in pixels at `fontSize` (1.10 normalizeFontMetrics). */
export declare function normalizeFontMetrics(metrics: FontMetrics, fontSize: number): NormalizedFontMetrics;
/**
 * The font's metrics at `fontSize`, normalized once per size; the last 64
 * sizes stay cached, the oldest first out.
 */
export declare function metricsAt(font: SdfFont, fontSize: number): NormalizedFontMetrics;
/** The glyph for `code`, or the fallback glyph, or undefined without either. */
export declare function glyphOf(font: SdfFont, code: number): SdfGlyph | undefined;
/**
 * The record of an astral code point's glyph, or null: out of the loops
 * that look a glyph up inline, as astral text is rare.
 */
export declare function astralOf(font: SdfFont, code: number): GlyphRecord | null;
/**
 * Width of `text` in atlas design units (1.10 SdfFontHandler.measureText):
 * each glyph's advance plus `letterSpacing`, kerning between pairs; zero
 * width and invisible characters take nothing, and a missing glyph the
 * fallback's advance. An astral codepoint is one glyph.
 */
export declare function measureText(text: string, font: SdfFont, letterSpacing: number): number;
/**
 * measureText of `text.substring(start, end)`, without making it: a
 * surrogate pair counts only within the range. The code point, glyph and
 * kerning lookups are written out in the loop, which runs for every
 * character a layout measures.
 */
export declare function measureRange(text: string, start: number, end: number, font: SdfFont, letterSpacing: number): number;
export {};
