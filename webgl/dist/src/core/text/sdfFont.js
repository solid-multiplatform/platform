import { isProductionEnvironment } from '../../common/flags.js';
/**
 * A glyph as the layout reads it, made once per glyph when the font is
 * parsed, one shape for every glyph whatever fields its JSON has: its
 * advance, offsets and size in atlas design units, its UV rect in the
 * atlas, u1, v1 to u2, v2 (TextLayout's GLYPH_WORDS), and its kerning:
 * `kernColumn`, its column in the rows when it is the first glyph of a
 * pair (-1 when it starts none, or its id is 0, which 1.10 read as no
 * glyph before), and `kern`, its row when it is the second glyph of one,
 * or null: by the first glyph's column, where the pair's amount is in the
 * font's `kernAmounts`, 0 where the two make no pair.
 */
export class GlyphRecord {
    constructor(glyph, kernColumn, kern, invAtlasWidth, invAtlasHeight) {
        this.xadvance = glyph.xadvance;
        this.xoffset = glyph.xoffset;
        this.yoffset = glyph.yoffset;
        this.width = glyph.width;
        this.height = glyph.height;
        const u = glyph.x * invAtlasWidth;
        const v = glyph.y * invAtlasHeight;
        this.u1 = u;
        this.v1 = v;
        this.u2 = u + glyph.width * invAtlasWidth;
        this.v2 = v + glyph.height * invAtlasHeight;
        this.kernColumn = kernColumn;
        this.kern = kern;
    }
}
/** The page of a range without glyphs, shared: never written. */
const EMPTY_PAGE = [];
for (let i = 0; i < 256; i++) {
    EMPTY_PAGE.push(null);
}
/**
 * The glyph a missing codepoint draws: `?` in development builds, a space
 * in production (1.10).
 */
export const FALLBACK_GLYPH = isProductionEnvironment === true ? 32 : 63;
/** 1.10's metrics for a font that ships none. */
const DEFAULT_METRICS = {
    ascender: 800,
    descender: -200,
    lineGap: 200,
    unitsPerEm: 1000,
};
/**
 * Generic Latin ratios for a cap or x height a font does not give (1.10):
 * within a few percent of OS/2 sCapHeight and sxHeight across the common
 * Latin families.
 */
const CAP_HEIGHT_FALLBACK_RATIO = 0.7;
const X_HEIGHT_FALLBACK_RATIO = 0.5;
/**
 * Zero-width characters that draw nothing and take no width: zero-width
 * non-joiner and joiner, byte order mark, soft hyphen, word joiner. The
 * zero-width space (0x200b) is tested on its own, before these, as 1.10
 * did. 1.10 tested them with a global regular expression whose state
 * carried between calls; this test has none (spec 14).
 */
export const isInvisible = (code) => code === 0x200c ||
    code === 0x200d ||
    code === 0xfeff ||
    code === 0x00ad ||
    code === 0x2060;
/**
 * The code point at `i` (an index in range), as
 * `String.prototype.codePointAt` reads it: a surrogate pair's code point at
 * its high half, else the code unit, a lone surrogate included. Not the
 * built-in: Chrome 41, above the Chrome 38 floor.
 */
export function codePointAt(text, i) {
    const hi = text.charCodeAt(i);
    if (hi >= 0xd800 && hi <= 0xdbff) {
        // NaN past the end: no pair.
        const lo = text.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
            return (hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
        }
    }
    return hi;
}
/**
 * Parse an atlas description into its lookups (1.10 processFontData). The
 * metrics are `metrics`, else the JSON's `lightningMetrics`, else 1.10's
 * defaults (with a warning); a cap or x height they lack is derived from
 * glyph `H` or `x` in the atlas: the distance from the baseline (`base`)
 * to the glyph's top, in font units.
 */
export function parseSdfFont(name, data, metrics) {
    const kernings = {};
    const pairs = data.kernings ?? [];
    // The layout's kerning: a column per glyph that starts a pair, and a row
    // per glyph that ends one, holding 1 + the index of the pair's amount in
    // kernAmounts: the last of a repeated pair, none for a pair without an
    // amount, as `kernings` reads.
    const columns = new Map();
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let firsts = kernings[pair.second];
        if (firsts === undefined) {
            firsts = {};
            kernings[pair.second] = firsts;
        }
        firsts[pair.first] = pair.amount;
        if (columns.has(pair.first) === false) {
            columns.set(pair.first, columns.size);
        }
    }
    const kernAmounts = new Float64Array(pairs.length + 1);
    const rows = new Map();
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let row = rows.get(pair.second);
        if (row === undefined) {
            row =
                pairs.length < 0x10000
                    ? new Uint16Array(columns.size)
                    : new Uint32Array(columns.size);
            rows.set(pair.second, row);
        }
        kernAmounts[i + 1] = pair.amount;
        row[columns.get(pair.first)] = pair.amount === undefined ? 0 : i + 1;
    }
    // A repeated id keeps its last glyph, in `glyphs` and in the records. An
    // id that is not an integer is in `glyphs` only: no code point finds it.
    const glyphs = new Map();
    const pages = [];
    for (let i = 0; i < 256; i++) {
        pages.push(EMPTY_PAGE);
    }
    const astral = new Map();
    const invAtlasWidth = 1 / data.common.scaleW;
    const invAtlasHeight = 1 / data.common.scaleH;
    const chars = data.chars;
    for (let i = 0; i < chars.length; i++) {
        const glyph = chars[i];
        const id = glyph.id;
        glyphs.set(id, glyph);
        if (typeof id !== 'number' || id < 0 || Math.floor(id) !== id) {
            continue;
        }
        const column = columns.get(id);
        const row = rows.get(id);
        const record = new GlyphRecord(glyph, column === undefined || id === 0 ? -1 : column, row === undefined ? null : row, invAtlasWidth, invAtlasHeight);
        if (id >= 0x10000) {
            astral.set(id, record);
            continue;
        }
        let page = pages[id >> 8];
        if (page === EMPTY_PAGE) {
            page = EMPTY_PAGE.slice();
            pages[id >> 8] = page;
        }
        page[id & 255] = record;
    }
    let m = metrics ?? data.lightningMetrics;
    if (m === undefined) {
        console.warn(`Font metrics not found for SDF font ${name}. ` +
            'Make sure you are using the latest version of the Lightning ' +
            '3 msdf-generator tool to generate your SDF fonts. Using default metrics.');
        m = DEFAULT_METRICS;
    }
    // A copy: the derived heights never land in an object the app passed.
    const resolved = {
        ascender: m.ascender,
        descender: m.descender,
        lineGap: m.lineGap,
        unitsPerEm: m.unitsPerEm,
        capHeight: m.capHeight,
        xHeight: m.xHeight,
    };
    const base = data.common.base;
    const size = data.info.size;
    if (resolved.capHeight === undefined) {
        const cap = glyphs.get(72); // 'H'
        if (cap !== undefined) {
            resolved.capHeight = ((base - cap.yoffset) / size) * m.unitsPerEm;
        }
    }
    if (resolved.xHeight === undefined) {
        const x = glyphs.get(120); // 'x'
        if (x !== undefined) {
            resolved.xHeight = ((base - x.yoffset) / size) * m.unitsPerEm;
        }
    }
    return {
        data,
        glyphs,
        kernings,
        metrics: resolved,
        sizes: new Map(),
        pages,
        astral,
        fallback: pages[0][FALLBACK_GLYPH],
        kernAmounts,
    };
}
/** `metrics` in pixels at `fontSize` (1.10 normalizeFontMetrics). */
export function normalizeFontMetrics(metrics, fontSize) {
    const scale = fontSize / metrics.unitsPerEm;
    const capHeight = metrics.capHeight !== undefined
        ? metrics.capHeight
        : metrics.ascender * CAP_HEIGHT_FALLBACK_RATIO;
    const xHeight = metrics.xHeight !== undefined
        ? metrics.xHeight
        : metrics.ascender * X_HEIGHT_FALLBACK_RATIO;
    return {
        ascender: metrics.ascender * scale,
        descender: metrics.descender * scale,
        lineGap: metrics.lineGap * scale,
        capHeight: capHeight * scale,
        xHeight: xHeight * scale,
    };
}
/**
 * Font sizes whose metrics a font keeps normalized: an animated font size
 * lays out at a new size every frame, which 1.10 kept forever.
 */
const MAX_SIZES = 64;
/**
 * The font's metrics at `fontSize`, normalized once per size; the last 64
 * sizes stay cached, the oldest first out.
 */
export function metricsAt(font, fontSize) {
    const sizes = font.sizes;
    let m = sizes.get(fontSize);
    if (m === undefined) {
        if (sizes.size >= MAX_SIZES) {
            sizes.delete(sizes.keys().next().value);
        }
        m = normalizeFontMetrics(font.metrics, fontSize);
        sizes.set(fontSize, m);
    }
    return m;
}
/** The glyph for `code`, or the fallback glyph, or undefined without either. */
export function glyphOf(font, code) {
    const glyph = font.glyphs.get(code);
    return glyph !== undefined ? glyph : font.glyphs.get(FALLBACK_GLYPH);
}
/**
 * The record of an astral code point's glyph, or null: out of the loops
 * that look a glyph up inline, as astral text is rare.
 */
export function astralOf(font, code) {
    const glyph = font.astral.get(code);
    return glyph !== undefined ? glyph : null;
}
/**
 * Width of `text` in atlas design units (1.10 SdfFontHandler.measureText):
 * each glyph's advance plus `letterSpacing`, kerning between pairs; zero
 * width and invisible characters take nothing, and a missing glyph the
 * fallback's advance. An astral codepoint is one glyph.
 */
export function measureText(text, font, letterSpacing) {
    return measureRange(text, 0, text.length, font, letterSpacing);
}
/**
 * measureText of `text.substring(start, end)`, without making it: a
 * surrogate pair counts only within the range. The code point, glyph and
 * kerning lookups are written out in the loop, which runs for every
 * character a layout measures.
 */
export function measureRange(text, start, end, font, letterSpacing) {
    const pages = font.pages;
    if (end - start === 1) {
        // As one character measures: its advance and spacing, without the sum.
        const code = text.charCodeAt(start);
        if (code === 0x200b || isInvisible(code) === true) {
            return 0;
        }
        let glyph = pages[code >> 8][code & 255];
        if (glyph === null) {
            glyph = font.fallback;
            if (glyph === null) {
                return 0;
            }
        }
        return glyph.xadvance + letterSpacing;
    }
    const kernAmounts = font.kernAmounts;
    let width = 0;
    // The kerning column of the glyph before, -1 when there is none.
    let prev = -1;
    for (let i = start; i < end; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < end) {
            const lo = text.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdfff) {
                code = (code - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
            }
        }
        let glyph;
        if (code > 0xffff) {
            i++;
            glyph = astralOf(font, code);
        }
        else {
            // Every zero-width or invisible character is at 0xad or above.
            if (code >= 0xad && (code === 0x200b || isInvisible(code) === true)) {
                continue;
            }
            glyph = pages[code >> 8][code & 255];
        }
        if (glyph === null) {
            glyph = font.fallback;
            if (glyph === null) {
                continue;
            }
        }
        let advance = glyph.xadvance;
        if (prev !== -1) {
            const row = glyph.kern;
            if (row !== null) {
                const pair = row[prev];
                if (pair !== 0) {
                    advance += kernAmounts[pair];
                }
            }
        }
        width += advance + letterSpacing;
        prev = glyph.kernColumn;
    }
    return width;
}
//# sourceMappingURL=sdfFont.js.map