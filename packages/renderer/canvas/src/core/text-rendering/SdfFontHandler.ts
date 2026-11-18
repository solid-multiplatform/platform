import type {
  FontMetrics,
  NormalizedFontMetrics,
  TrProps,
  FontLoadOptions,
} from './TextRenderer.js';
import type { ImageTexture } from '../textures/ImageTexture.js';
import type { Stage } from '../Stage.js';
import type { CoreTextNode } from '../CoreTextNode.js';
import { hasZeroWidthSpace } from './Utils.js';
import { FontMetricsCache, FontWaitList } from './FontBookkeeping.js';
import { isProductionEnvironment } from '../../utils.js';
import type { TextureError } from '../TextureError.js';
import { takeSdfPrefetch } from './FontPrefetch.js';
import { convertUrlToAbsolute, fetchResource } from '../lib/utils.js';

/**
 * SDF Font Data structure matching msdf-bmfont-xml output
 */
export interface SdfFontData {
  pages: string[];
  chars: Array<{
    id: number;
    char: string;
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
    page: number;
    chnl: number;
  }>;

  kernings: Array<{
    first: number;
    second: number;
    amount: number;
  }>;
  info: {
    face: string;
    size: number;
    bold: number;
    italic: number;
    charset: string[];
    unicode: number;
    stretchH: number;
    smooth: number;
    aa: number;
    padding: [number, number, number, number]; // [up, right, down, left]
    spacing: [number, number]; // [horizontal, vertical]
    outline: number;
  };
  common: {
    lineHeight: number;
    base: number;
    scaleW: number;
    scaleH: number;
    pages: number;
    packed: number;
    alphaChnl: number;
    redChnl: number;
    greenChnl: number;
    blueChnl: number;
  };
  distanceField: {
    // msdf-bmfont-xml uses the string 'sdf' for single-channel SDF.
    fieldType: 'sdf' | 'msdf';
    distanceRange: number;
  };
  lightningMetrics?: FontMetrics;
}

/**
 * @typedef {Object} SdfGlyph
 * @property {number} id - Glyph ID
 * @property {string} char - Character
 * @property {number} x - Atlas x position
 * @property {number} y - Atlas y position
 * @property {number} width - Glyph width
 * @property {number} height - Glyph height
 * @property {number} xoffset - X offset
 * @property {number} yoffset - Y offset
 * @property {number} xadvance - Character advance width
 * @property {number} page - Page number
 * @property {number} chnl - Channel
 */

/**
 * @typedef {Object} KerningTable
 * Fast lookup table for kerning values
 */
type KerningTable = Record<
  number,
  Record<number, number | undefined> | undefined
>;

/**
 * @typedef {Object} SdfFontCache
 * Cached font data for performance
 */
export interface SdfFont {
  data: SdfFontData;
  glyphMap: Map<number, SdfFontData['chars'][0]>;
  kernings: KerningTable;
  atlasTexture: ImageTexture;
  metrics: FontMetrics;
  maxCharHeight: number;
}

// Number of times a failed font load is automatically retried before
// loadFont() finally rejects. Counts reloads *after* the initial attempt
// (matching the `maxRetryCount` = retries convention used for textures), so
// the load is attempted up to MAX_FONT_LOAD_RETRIES + 1 times in total.
export const MAX_FONT_LOAD_RETRIES = 3;

//global state variables for SdfFontHandler
const fontCache = new Map<string, SdfFont>();
const fontLoadPromises = new Map<string, Promise<void>>();
const metricsCache = new FontMetricsCache();
const waitList = new FontWaitList();
let initialized = false;

/**
 * Build kerning lookup table for fast access
 * @param {Array} kernings - Kerning data from font
 * @returns {KerningTable} Optimized kerning lookup table
 */
const buildKerningTable = (kernings: SdfFontData['kernings']): KerningTable => {
  const kerningTable: KerningTable = {};

  let i = 0;
  const length = kernings.length;

  while (i < length) {
    const kerning = kernings[i];
    i++;
    if (kerning === undefined) {
      continue;
    }
    const second = kerning.second;

    let firsts = kerningTable[second];
    if (firsts === undefined) {
      firsts = {};
      kerningTable[second] = firsts;
    }
    firsts[kerning.first] = kerning.amount;
  }

  return kerningTable;
};

/**
 * Build glyph map from font data for fast character lookup
 * @param {Array} chars - Character data from font
 * @returns {Map} Glyph map for character to glyph lookup
 */
const buildGlyphMap = (
  chars: SdfFontData['chars'],
): Map<number, SdfFontData['chars'][0]> => {
  const glyphMap = new Map<number, SdfFontData['chars'][0]>();
  let maxCharHeight = 0;

  let i = 0;
  const length = chars.length;

  while (i < length) {
    const glyph = chars[i];

    i++;
    if (glyph === undefined) {
      continue;
    }

    glyphMap.set(glyph.id, glyph);

    const charHeight = glyph.yoffset + glyph.height;
    if (charHeight > maxCharHeight) {
      maxCharHeight = charHeight;
    }
  }

  return glyphMap;
};

/**
 * Process font data and create optimized cache entry
 * @param {string} fontFamily - Font family name
 * @param {SdfFontData} fontData - Raw font data
 * @param {ImageTexture} atlasTexture - Atlas texture
 * @param {FontMetrics} metrics - Font metrics
 */
const processFontData = (
  fontFamily: string,
  fontData: SdfFontData,
  atlasTexture: ImageTexture,
  metrics?: FontMetrics,
): void => {
  // Build optimized data structures
  const glyphMap = buildGlyphMap(fontData.chars);
  const kernings = buildKerningTable(fontData.kernings);

  // Calculate max char height
  let maxCharHeight = 0;
  let i = 0;
  const length = fontData.chars.length;

  while (i < length) {
    const glyph = fontData.chars[i];
    if (glyph !== undefined) {
      const charHeight = glyph.yoffset + glyph.height;
      if (charHeight > maxCharHeight) {
        maxCharHeight = charHeight;
      }
    }
    i++;
  }

  if (metrics === undefined && fontData.lightningMetrics === undefined) {
    console.warn(
      `Font metrics not found for SDF font ${fontFamily}. ` +
        'Make sure you are using the latest version of the Lightning ' +
        '3 msdf-generator tool to generate your SDF fonts. Using default metrics.',
    );
  }

  metrics = metrics ||
    fontData.lightningMetrics || {
      ascender: 800,
      descender: -200,
      lineGap: 200,
      unitsPerEm: 1000,
    };

  // Derive cap-height from the atlas when the metrics block doesn't already
  // supply it. The layout engine uses this value to vertically center
  // capital letters on each line. BMFont stores per-glyph `yoffset` as the
  // distance from the line-box top to the glyph's top, and `common.base` as
  // the distance from the line-box top to the alphabetic baseline — so the
  // distance from the baseline up to the top of 'H' (atlas design px) is
  // `common.base - H.yoffset`. Converted into font units it slots into
  // `FontMetrics.capHeight` alongside the existing ascender / descender
  // values and flows through `normalizeFontMetrics`.
  if (metrics.capHeight === undefined) {
    const capGlyph = glyphMap.get(72); // 'H'
    if (capGlyph !== undefined) {
      const capHeightAtlasPx = fontData.common.base - capGlyph.yoffset;
      metrics = {
        ...metrics,
        capHeight: (capHeightAtlasPx / fontData.info.size) * metrics.unitsPerEm,
      };
    }
    // If 'H' isn't in the atlas (icon-only fonts, etc.) we leave capHeight
    // undefined and rely on the 0.7 × ascender fallback inside
    // normalizeFontMetrics.
  }

  // Same derivation for x-height using glyph 'x' (id 120). Consumed by
  // both `textBaselineMode === 'x'` and `'optical'` (which uses the mean
  // of cap-height and x-height); the 0.5 × ascender fallback inside
  // `normalizeFontMetrics` covers fonts that ship without an 'x' glyph.
  if (metrics.xHeight === undefined) {
    const xGlyph = glyphMap.get(120); // 'x'
    if (xGlyph !== undefined) {
      const xHeightAtlasPx = fontData.common.base - xGlyph.yoffset;
      metrics = {
        ...metrics,
        xHeight: (xHeightAtlasPx / fontData.info.size) * metrics.unitsPerEm,
      };
    }
  }

  // Cache processed data
  fontCache.set(fontFamily, {
    data: fontData,
    glyphMap,
    kernings,
    atlasTexture,
    metrics,
    maxCharHeight,
  });
};

/**
 * Check if the SDF font handler can render a font
 * @param {TrProps} trProps - Text rendering properties
 * @returns {boolean} True if the font can be rendered
 */
export const canRenderFont = (trProps: TrProps): boolean => {
  return (
    isFontLoaded(trProps.fontFamily) || fontLoadPromises.has(trProps.fontFamily)
  );
};

/**
 * Load SDF font from JSON + PNG atlas
 * @param {Object} options - Font loading options
 * @param {string} options.fontFamily - Font family name
 * @param {string} options.fontUrl - JSON font data URL (atlasDataUrl)
 * @param {string} options.atlasUrl - PNG atlas texture URL
 * @param {FontMetrics} options.metrics - Optional font metrics
 */
export const loadFont = (
  stage: Stage,
  options: FontLoadOptions,
): Promise<void> => {
  const { fontFamily, atlasUrl, atlasDataUrl, metrics } = options;
  // A single load may register the font under several names (the atlas is
  // fetched once and shared). The first entry is the primary name used to key
  // the in-flight promise and drive the fetch; the rest are aliases.
  const names = Array.isArray(fontFamily) ? fontFamily : [fontFamily];
  const primary = names[0]!;

  // A prefetch started before the renderer existed, if any. Claimed here —
  // ahead of the early returns — so that a font which turns out to need no
  // load still releases the prefetched atlas blob rather than pinning it.
  const prefetched = takeSdfPrefetch(primary);

  // Early return if already loaded
  if (fontCache.get(primary) !== undefined) {
    return Promise.resolve();
  }

  // Early return if already loading
  const existingPromise = fontLoadPromises.get(primary);
  if (existingPromise !== undefined) {
    return existingPromise;
  }

  if (atlasDataUrl === undefined) {
    return Promise.reject(
      new Error(`Atlas data URL must be provided for SDF font: ${primary}`),
    );
  }

  // Ensure every name has a waiter list so nodes requesting an alias can park
  // and be woken on load. Reuse existing lists — a previous load attempt for a
  // name may have failed and left nodes parked there; overwriting the list
  // would strand them, so a successful retry could never wake them. Lists are
  // consumed (and deleted) on the next successful load.
  for (let i = 0; i < names.length; i++) {
    waitList.open(names[i]!);
  }
  // One attempt at fetching + decoding the JSON atlas description. A fresh
  // XHR runs per attempt so a transient network/parse failure can recover.
  //
  // Resolved the way ImageTexture resolves the atlas image, so a relative URL
  // means the same thing for both halves of the font. Engines without
  // `responseType = 'json'` support hand back the raw string.
  const fetchFontData = (): Promise<SdfFontData> =>
    fetchResource(convertUrlToAbsolute(atlasDataUrl), 'json').then((data) => {
      if (typeof data !== 'string') {
        return data as SdfFontData;
      }
      try {
        return JSON.parse(data) as SdfFontData;
      } catch (e) {
        throw new Error('Failed to parse font data JSON');
      }
    });

  // One attempt at loading the atlas texture for the given font data. On
  // success it processes + caches the font and wakes parked nodes. On failure
  // it drops the dead atlas texture (createTexture caches by `src`, so the
  // next attempt must evict it to build a fresh one) and rejects.
  //
  // `atlasBlob` is the prefetched atlas image when one was claimed. Passing it
  // as `src` skips a second download; `key` is set to the atlas URL so the
  // texture cache key is identical to the one the URL path produces — the two
  // paths must not produce two cache entries for the same atlas.
  const loadAtlas = (
    fontData: SdfFontData,
    atlasBlob: Blob | null,
  ): Promise<void> => {
    if (!fontData || !fontData.chars) {
      return Promise.reject(new Error('Invalid SDF font data format'));
    }

    // Atlas texture should be provided externally
    if (!atlasUrl) {
      return Promise.reject(
        new Error('Atlas texture must be provided for SDF fonts'),
      );
    }

    return new Promise<void>((resolve, reject) => {
      // create new atlas texture using ImageTexture
      const atlasTexture = stage.txManager.createTexture('ImageTexture', {
        src: atlasBlob !== null ? atlasBlob : atlasUrl,
        key: atlasUrl,
        premultiplyAlpha: false,
      });

      // Register every name as a renderable owner so the shared atlas stays
      // alive as long as any of its names is in use.
      for (let i = 0; i < names.length; i++) {
        atlasTexture.setRenderableOwner(names[i]!, true);
      }
      atlasTexture.preventCleanup = true; // Prevent automatic cleanup

      const onLoaded = () => {
        // Process and cache font data under the primary name...
        processFontData(primary, fontData, atlasTexture, metrics);
        // ...then alias the remaining names onto the same cache entry so they
        // resolve to the identical glyph/kerning/atlas data.
        const cached = fontCache.get(primary)!;
        for (let i = 1; i < names.length; i++) {
          fontCache.set(names[i]!, cached);
        }

        // Wake every parked node across all names and clear their lists.
        for (let i = 0; i < names.length; i++) {
          waitList.wake(names[i]!);
        }
        resolve();
      };

      if (atlasTexture.state === 'loaded') {
        // If already loaded, process immediately
        onLoaded();
        return;
      }

      atlasTexture.on('loaded', onLoaded);

      // EventEmitter invokes listeners as (target, data), so the error payload
      // is the SECOND argument. The first arg is the Texture that emitted the
      // event. Reading it as the only param (the previous behavior) rejected
      // and logged the Texture instead of the actual TextureError.
      atlasTexture.on('failed', (_target, error: TextureError) => {
        // Drop the failed atlas so a retry builds a fresh texture rather than
        // getting this dead instance back from the createTexture key-cache.
        for (let i = 0; i < names.length; i++) {
          atlasTexture.setRenderableOwner(names[i]!, false);
        }
        stage.txManager.removeTextureFromCache(atlasTexture);
        reject(error);
      });
    });
  };

  // Initial attempt plus up to MAX_FONT_LOAD_RETRIES automatic reloads. Only
  // the first attempt uses the prefetch; a retry goes back to the network
  // rather than replaying a payload that may be exactly what failed.
  const loadPromise = (async (): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_FONT_LOAD_RETRIES; attempt++) {
      try {
        // Both halves of a prefetch are already in flight in parallel; the
        // fallbacks below are the original sequential path.
        const fontData =
          (attempt === 0 && prefetched !== undefined
            ? await prefetched.data
            : null) ?? (await fetchFontData());

        const atlasBlob =
          attempt === 0 && prefetched !== undefined
            ? await prefetched.atlas
            : null;

        await loadAtlas(fontData, atlasBlob);
        // Success: clear the in-flight markers (the font now lives in
        // fontCache) — parked nodes were already woken inside loadAtlas.
        for (let i = 0; i < names.length; i++) {
          fontLoadPromises.delete(names[i]!);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_FONT_LOAD_RETRIES) {
          console.warn(
            `SDF font "${primary}" failed to load (attempt ${attempt + 1} of ${
              MAX_FONT_LOAD_RETRIES + 1
            }), retrying.`,
            error,
          );
        }
      }
    }

    // Every attempt failed. Clear the in-flight markers so the font can be
    // requested again and drop any partial cache entry. The wait list
    // is deliberately kept: nodes parked here must survive so a later
    // loadFont() (which reuses the list) can still wake them if the font
    // eventually loads. The list shrinks as nodes self-remove via
    // stopWaitingForFont on destroy.
    for (let i = 0; i < names.length; i++) {
      fontLoadPromises.delete(names[i]!);
      fontCache.delete(names[i]!);
    }
    console.error(`Failed to load SDF font: ${primary}`, lastError);
    throw lastError;
  })();

  // Mark the load in flight under *every* name, not just the primary.
  // `canRenderFont` treats a name with no cache entry and no in-flight promise
  // as unrenderable, so keying only the primary made an alias unresolvable for
  // the whole load: the stage would either fall through to the Canvas engine
  // (permanently, with a substitute face) or, on an SDF-only engine list,
  // throw "No compatible text renderer found". Registering every name also
  // makes a later loadFont() for an alias dedupe onto this same load.
  for (let i = 0; i < names.length; i++) {
    fontLoadPromises.set(names[i]!, loadPromise);
  }
  return loadPromise;
};

/**
 * Stop waiting for a font to load
 * @param {string} fontFamily - Font family name
 * @param {CoreTextNode} node - Node that was waiting for the font
 */
export const waitingForFont = (fontFamily: string, node: CoreTextNode) => {
  waitList.add(fontFamily, node);
};

/**
 * Stop waiting for a font to load
 *
 * @param fontFamily
 * @param node
 * @returns
 */
export const stopWaitingForFont = (fontFamily: string, node: CoreTextNode) => {
  waitList.remove(fontFamily, node);
};

/**
 * Initialize the SDF font handler
 */
export const init = (
  c?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): void => {
  if (initialized === true) {
    return;
  }

  initialized = true;
};

export const type = 'sdf';

/**
 * Check if a font is already loaded by font family
 */
export const isFontLoaded = (fontFamily: string): boolean => {
  return fontCache.has(fontFamily);
};

/**
 * Get normalized font metrics for a font family
 */
export const getFontMetrics = (
  fontFamily: string,
  fontSize: number,
): NormalizedFontMetrics => {
  const cached = metricsCache.get(fontFamily, fontSize);
  if (cached !== undefined) {
    return cached;
  }
  return metricsCache.set(
    fontFamily,
    fontSize,
    fontCache.get(fontFamily)!.metrics,
  );
};

/**
 * Get atlas texture for a font family
 * @param {string} fontFamily - Font family name
 * @returns {ImageTexture|null} Atlas texture or null
 */
export const getAtlas = (fontFamily: string): ImageTexture | null => {
  const cache = fontCache.get(fontFamily);
  return cache !== undefined ? cache.atlasTexture : null;
};

/**
 * Get font data for a font family
 * @param {string} fontFamily - Font family name
 * @returns {SdfFontData|null} Font data or null
 */
export const getFontData = (fontFamily: string): SdfFont | undefined => {
  return fontCache.get(fontFamily);
};

export const measureText = (
  text: string,
  fontFamily: string,
  letterSpacing: number,
): number => {
  const cache = fontCache.get(fontFamily);
  if (cache === undefined) return 0;

  const glyphMap = cache.glyphMap;
  const kernings = cache.kernings;
  const fallbackGlyphId = isProductionEnvironment ? 32 : 63;
  const textLength = text.length;

  if (textLength === 1) {
    const codepoint = text.codePointAt(0) as number;
    if (codepoint === 0x200b) return 0;
    const char = text[0] as string;
    if (hasZeroWidthSpace(char) === true) return 0;

    let glyph = glyphMap.get(codepoint);
    if (glyph === undefined) {
      glyph = glyphMap.get(fallbackGlyphId);
      if (glyph === undefined) return 0;
    }
    return glyph.xadvance + letterSpacing;
  }

  let width = 0;
  let prevGlyphId = 0;
  for (let i = 0; i < textLength; i++) {
    const codepoint = text.codePointAt(i) as number;
    if (codepoint > 0xffff) {
      i++;
    }

    if (codepoint === 0x200b) {
      continue;
    }

    const char = text[i] as string;
    // Skip zero-width spaces in width calculations
    if (hasZeroWidthSpace(char) === true) {
      continue;
    }

    let glyph = glyphMap.get(codepoint);
    if (glyph === undefined) {
      glyph = glyphMap.get(fallbackGlyphId);
      if (glyph === undefined) {
        continue;
      }
    }

    let advance = glyph.xadvance;

    // Add kerning if there's a previous character
    if (prevGlyphId !== 0) {
      const seconds = kernings[glyph.id];
      if (seconds !== undefined) {
        const amount = seconds[prevGlyphId];
        if (amount !== undefined) {
          advance += amount;
        }
      }
    }

    width += advance + letterSpacing;
    prevGlyphId = glyph.id;
  }

  return width;
};
