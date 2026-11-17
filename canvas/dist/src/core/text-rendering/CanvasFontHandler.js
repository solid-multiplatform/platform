import { hasZeroWidthSpace } from './Utils.js';
import { defaultFontMetrics } from './TextLayoutEngine.js';
import { FontMetricsCache, FontWaitList } from './FontBookkeeping.js';
import { takeCanvasPrefetch } from './FontPrefetch.js';
// Global state variables for fontHandler
const fontLoadPromises = new Map();
const metricsCache = new FontMetricsCache();
const waitList = new FontWaitList();
const fontCache = new Map();
let initialized = false;
let context;
let measureContext;
/**
 * Check if a font can be rendered
 */
export const canRenderFont = () => {
    // Canvas can always render any font family (assuming the browser supports it)
    return true;
};
const processFontData = (fontFamily, fontFace, metrics) => {
    metrics = metrics || defaultFontMetrics;
    fontCache.set(fontFamily, {
        fontFamily,
        fontFace,
        metrics,
    });
};
/**
 * Load a font by providing fontFamily, fontUrl, and optional metrics
 */
export const loadFont = (stage, options) => {
    const { fontFamily, fontUrl, metrics } = options;
    // A single load may register the font under several names. The first entry
    // is the primary name used to key the in-flight promise; the rest are
    // aliases registered against the same source URL (the browser dedupes the
    // download by URL).
    const names = Array.isArray(fontFamily) ? fontFamily : [fontFamily];
    const primary = names[0];
    // Faces whose download was started before the renderer existed, if any.
    // Claimed ahead of the early returns so an unneeded prefetch is released.
    const prefetched = takeCanvasPrefetch(primary);
    // If already loaded, return immediately
    if (fontCache.has(primary) === true) {
        return Promise.resolve();
    }
    const existingPromise = fontLoadPromises.get(primary);
    // If already loading, return the existing promise
    if (existingPromise !== undefined) {
        return existingPromise;
    }
    for (let i = 0; i < names.length; i++) {
        waitList.open(names[i]);
    }
    // Register a FontFace under every name (all share the same source URL) and
    // wait for all of them to be ready before waking parked nodes. Prefetched
    // faces are already loaded — they only still need registering with the
    // platform, which is the one step that required a stage.
    const loadPromise = Promise.resolve(prefetched)
        .then((faces) => faces != null && faces.length === names.length
        ? faces
        : Promise.all(names.map((name) => new FontFace(name, `url(${fontUrl})`).load())))
        .then((faces) => {
        for (let i = 0; i < names.length; i++) {
            const loadedFont = faces[i];
            stage.platform.addFont(loadedFont);
            processFontData(names[i], loadedFont, metrics);
        }
    })
        .then(() => {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            fontLoadPromises.delete(name);
            waitList.wake(name);
        }
    })
        .catch((error) => {
        for (let i = 0; i < names.length; i++) {
            fontLoadPromises.delete(names[i]);
        }
        console.error(`Failed to load font: ${primary}`, error);
        throw error;
    });
    // Keyed under every name so a later loadFont() for an alias dedupes onto
    // this load rather than starting a second one. (Canvas `canRenderFont` is
    // unconditionally true, so unlike SDF this does not affect renderer choice.)
    for (let i = 0; i < names.length; i++) {
        fontLoadPromises.set(names[i], loadPromise);
    }
    return loadPromise;
};
/**
 * Initialize the global font handler
 */
export const init = (c, mc) => {
    if (initialized === true) {
        return;
    }
    if (c === undefined) {
        throw new Error('Canvas context is not provided for font handler initialization');
    }
    context = c;
    measureContext = mc || c;
    // Register the default 'sans-serif' font face
    const defaultMetrics = {
        ascender: 800,
        descender: -200,
        lineGap: 200,
        unitsPerEm: 1000,
    };
    processFontData('sans-serif', undefined, defaultMetrics);
    initialized = true;
};
export const type = 'canvas';
/**
 * Check if a font is already loaded by font family
 */
export const isFontLoaded = (fontFamily) => {
    return fontCache.has(fontFamily);
};
/**
 * Wait for a font to load
 *
 * @param fontFamily
 * @param node
 */
export const waitingForFont = (fontFamily, node) => {
    waitList.add(fontFamily, node);
};
/**
 * Stop waiting for a font to load
 *
 * @param fontFamily
 * @param node
 * @returns
 */
export const stopWaitingForFont = (fontFamily, node) => {
    waitList.remove(fontFamily, node);
};
export const getFontMetrics = (fontFamily, fontSize) => {
    const out = metricsCache.get(fontFamily, fontSize);
    if (out !== undefined) {
        return out;
    }
    let metrics = fontCache.get(fontFamily).metrics;
    if (metrics === undefined) {
        metrics = calculateFontMetrics(fontFamily, fontSize);
    }
    return metricsCache.set(fontFamily, fontSize, metrics);
};
export const measureText = (text, fontFamily, letterSpacing) => {
    if (letterSpacing === 0) {
        return measureContext.measureText(text).width;
    }
    // Spaced text is drawn one character at a time by `CanvasTextRenderer`
    // (`ctx.letterSpacing` needs Chrome 99+ and the floor here is 38), so the
    // drawn run carries no kerning. Measure it the same way, character by
    // character, rather than taking the kerned width of the whole string: the
    // measured width becomes the line width, the line width sets the alignment
    // offset, and mixing the two makes every centered line sit off-center and
    // every right-aligned line overrun its box by the run's total kerning.
    let width = 0;
    for (let i = 0, n = text.length; i < n; i++) {
        const char = text.charAt(i);
        if (hasZeroWidthSpace(char) === true) {
            continue;
        }
        width += measureContext.measureText(char).width + letterSpacing;
    }
    return width;
};
/**
 * Get the font metrics for a font face.
 *
 * @remarks
 * This function will attempt to grab the explicitly defined metrics from the
 * font face first. If the font face does not have metrics defined, it will
 * attempt to calculate the metrics using the browser's measureText method.
 *
 * If the browser does not support the font metrics API, it will use some
 * default values.
 *
 * @param context
 * @param fontFace
 * @param fontSize
 * @returns
 */
export function calculateFontMetrics(fontFamily, fontSize) {
    // If the font face doesn't have metrics defined, we fallback to using the
    // browser's measureText method to calculate take a best guess at the font
    // actual font's metrics.
    // - fontBoundingBox[Ascent|Descent] is the best estimate but only supported
    //   in Chrome 87+ (2020), Firefox 116+ (2023), and Safari 11.1+ (2018).
    //   - It is an estimate as it can vary between browsers.
    // - actualBoundingBox[Ascent|Descent] is less accurate and supported in
    //   Chrome 77+ (2019), Firefox 74+ (2020), and Safari 11.1+ (2018).
    // - If neither are supported, we'll use some default values which will
    //   get text on the screen but likely not be great.
    // NOTE: It's been decided not to rely on fontBoundingBox[Ascent|Descent]
    // as it's browser support is limited and it also tends to produce higher than
    // expected values. It is instead HIGHLY RECOMMENDED that developers provide
    // explicit metrics in the font face definition.
    const metrics = measureContext.measureText('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
    console.warn(`Font metrics not provided for Canvas Web font ${fontFamily}. ` +
        'Using fallback values. It is HIGHLY recommended you use the latest ' +
        'version of the Lightning 3 `msdf-generator` tool to extract the default ' +
        'metrics for the font and provide them in the Canvas Web font definition.');
    const ascender = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? 0;
    const descender = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? 0;
    return {
        ascender,
        descender: -descender,
        lineGap: (metrics.emHeightAscent ?? 0) +
            (metrics.emHeightDescent ?? 0) -
            (ascender + descender),
        unitsPerEm: (metrics.emHeightAscent ?? 0) + (metrics.emHeightDescent ?? 0),
    };
}
//# sourceMappingURL=CanvasFontHandler.js.map