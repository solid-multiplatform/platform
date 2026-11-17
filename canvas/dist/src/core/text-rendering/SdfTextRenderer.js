import { hasZeroWidthSpace } from './Utils.js';
import * as SdfFontHandler from './SdfFontHandler.js';
import { WebGlRenderer } from '../renderers/webgl/WebGlRenderer.js';
import { Sdf } from '../shaders/webgl/SdfShader.js';
import { isProductionEnvironment } from '../../utils.js';
import { SDF_GLYPH_STRIDE } from './TextRenderer.js';
import { mapTextLayout } from './TextLayoutEngine.js';
// Type definition to match interface
const type = 'sdf';
let sdfShader = null;
// Upper bound on layoutCache entries. Overridden from stage options in `init`.
// Enforced both eagerly on insert (see `renderText`) and in bulk on idle (see
// `cleanup`). The eager bound matters because a continuously animating scene
// never goes idle, so idle-only eviction would let apps with ever-changing text
// (clocks, counters, score/fps readouts) grow the cache without limit until the
// page runs out of memory. The per-insert cost is a single Map delete on a
// cache miss (i.e. only when new text is laid out), so it does not compete with
// steady-state rendering.
let maxLayoutCacheSize = 250;
// Initialize the SDF text renderer
const init = (stage) => {
    SdfFontHandler.init();
    const configuredCacheSize = stage.options.textLayoutCacheSize;
    if (configuredCacheSize !== undefined) {
        maxLayoutCacheSize = configuredCacheSize;
    }
    // Register the SDF shader, but defer the (expensive) compile + link until the
    // first SDF glyph actually renders — see getSdfShader / renderQuads. SDF fonts
    // load asynchronously, so the first frame almost never needs the shader, and
    // compiling it during Stage construction sits on the critical path to first
    // paint for no benefit.
    stage.shManager.registerShaderType('Sdf', Sdf);
    sdfShader = null;
};
/**
 * Lazily compile (and memoize) the SDF shader on first use.
 *
 * @remarks
 * The shader program is compiled and linked the first time an SDF glyph is
 * actually drawn, not at boot. Subsequent calls return the cached node.
 */
const getSdfShader = (stage) => {
    if (sdfShader === null) {
        sdfShader = stage.shManager.createShader('Sdf');
    }
    return sdfShader;
};
const font = SdfFontHandler;
const layoutCache = new Map();
const getLayoutCacheKey = (props) => `${props.fontFamily}-${props.fontStyle}-${props.fontSize}-${props.letterSpacing}-${props.lineHeight}-${props.maxHeight}-${props.maxWidth}-${props.maxLines}-${props.textAlign}-${props.wordBreak}-${props.overflowSuffix}-${props.text}`;
/**
 * SDF text renderer using MSDF/SDF fonts with WebGL
 *
 * @param stage - Stage instance for font resolution
 * @param props - Text rendering properties
 * @returns Object containing ImageData and dimensions
 */
const renderText = (props) => {
    // Early return if no text
    if (props.text.length === 0) {
        return {
            width: 0,
            height: 0,
        };
    }
    const cacheKey = getLayoutCacheKey(props);
    let layout = layoutCache.get(cacheKey);
    if (layout !== undefined) {
        // Refresh LRU recency: re-insert moves the key to the most-recently-used
        // end so idle `cleanup` evicts genuinely cold entries first. renderText
        // runs on text/layout change, not per frame, so this re-insert is cheap.
        layoutCache.delete(cacheKey);
        layoutCache.set(cacheKey, layout);
        return {
            remainingLines: 0,
            hasRemainingText: false,
            width: layout.width,
            height: layout.height,
            layout,
        };
    }
    // Get font cache for this font family
    const fontData = SdfFontHandler.getFontData(props.fontFamily);
    if (fontData === undefined) {
        // Font not loaded, return empty result
        return {
            width: 0,
            height: 0,
        };
    }
    // Calculate text layout and generate glyph data for caching
    layout = generateTextLayout(props, fontData);
    layoutCache.set(cacheKey, layout);
    // Eagerly bound the cache. Idle `cleanup` alone is not enough: an animating
    // scene never idles, so without this, ever-changing text grows the cache
    // without limit. The Map is insertion-ordered and cache hits re-insert
    // (delete + set) to the end, so the first key is the least-recently-used.
    if (layoutCache.size > maxLayoutCacheSize) {
        const oldest = layoutCache.keys().next().value;
        layoutCache.delete(oldest);
    }
    // For SDF renderer, ImageData is null since we render via WebGL
    return {
        remainingLines: 0,
        hasRemainingText: false,
        width: layout.width,
        height: layout.height,
        layout,
    };
};
/**
 * Submit SDF glyphs to the renderer's shared batched buffer.
 *
 * Two paths:
 * 1. **Cache hit**: layout, linear transform (scale/rotation) and color
 *    haven't changed. The cached pre-transformed Float32Array is mem-copied
 *    into the shared SDF buffer unmodified; any tx/ty delta from the cache
 *    base (the scroll path) rides the render op as the per-op u_translate
 *    uniform, and worldAlpha rides it as u_alpha (the fade path). The bytes
 *    are the same every frame, so the renderer can skip the buffer upload
 *    entirely.
 * 2. **Cache miss**: re-computes per-glyph world-space vertices via
 *    `addSdfQuads`, then snapshots the result into the cache.
 *
 * A node parked away from its cache base (same non-zero delta two frames
 * running) gets its delta folded into the cache once, so it returns to delta
 * zero and merges back into the same render op as static text.
 */
const renderQuads = (renderer, layout, _vertexBuffer, renderProps) => {
    const fontFamily = renderProps.fontFamily;
    const atlasTexture = SdfFontHandler.getAtlas(fontFamily);
    if (atlasTexture === null) {
        return null;
    }
    const webGlRenderer = renderer;
    const cache = renderProps.sdfCache;
    const ctxTexture = atlasTexture.ctxTexture;
    // Compiles on the first real SDF draw; cheap memoized lookup thereafter.
    const shader = getSdfShader(webGlRenderer.stage);
    // --- Cache-hit fast paths -----------------------------------------------
    if (cache !== undefined && cache.vertices !== null) {
        const t = renderProps.globalTransform;
        // worldAlpha is absent on purpose: it rides the render op as the u_alpha
        // uniform, so a fade replays the cached bytes like any other hit.
        if (cache.layoutRef === layout &&
            cache.color === renderProps.color &&
            cache.ta === t.ta &&
            cache.tc === t.tc &&
            cache.tb === t.tb &&
            cache.td === t.td) {
            let dx = t.tx - cache.tx;
            let dy = t.ty - cache.ty;
            // Parked away from the base: the same non-zero delta two frames
            // running means the node stopped moving (dx/dy compare positions, not
            // velocities). Fold the delta into the cache once so the node returns
            // to delta zero and batches with static text again; otherwise a
            // screen that scrolled once keeps one render op per scroll generation
            // forever. The fold writes fresh bytes at existing offsets, which the
            // renderer's skip test cannot see in a cache mutation, so raise the
            // upload flag here.
            if ((dx !== 0 || dy !== 0) &&
                dx === cache.lastDx &&
                dy === cache.lastDy) {
                const vertices = cache.vertices;
                const len = vertices.length;
                for (let i = 0; i < len; i += 6) {
                    vertices[i] = vertices[i] + dx;
                    vertices[i + 1] = vertices[i + 1] + dy;
                }
                cache.tx = t.tx;
                cache.ty = t.ty;
                webGlRenderer.sdfBufferChanged = true;
                dx = 0;
                dy = 0;
            }
            cache.lastDx = dx;
            cache.lastDy = dy;
            // Mem-copy the cached vertices as-is; a non-zero delta (the scroll
            // path) rides the render op as the u_translate uniform. The cache
            // keeps its base, so every frame writes the same bytes: no drift, no
            // per-frame re-snapshot, and no buffer re-upload while scrolling.
            webGlRenderer.addSdfCachedQuads(cache.vertices, cache.glyphCount, dx, dy, ctxTexture, renderProps.clippingRect, renderProps.worldAlpha, layout.width, layout.height, shader);
            return null;
        }
    }
    // --- Cache-miss slow path -----------------------------------------------
    const startIdx = webGlRenderer.sdfBufferIdx;
    webGlRenderer.addSdfQuads(layout.glyphs, layout.glyphCount, layout.fontScale, renderProps.globalTransform, renderProps.color, renderProps.worldAlpha, layout.distanceRange, ctxTexture, renderProps.clippingRect, layout.width, layout.height, shader);
    // Snapshot the written vertex data into the cache for future frames
    if (cache !== undefined) {
        const endIdx = webGlRenderer.sdfBufferIdx;
        const len = endIdx - startIdx;
        if (len > 0) {
            if (cache.vertices === null || cache.vertices.length !== len) {
                cache.vertices = new Float32Array(len);
            }
            cache.vertices.set(webGlRenderer.fSdfBuffer.subarray(startIdx, endIdx));
            cache.glyphCount = layout.glyphCount;
            cache.color = renderProps.color;
            cache.layoutRef = layout;
            // The new base is the transform just written: drawn delta is zero.
            cache.lastDx = 0;
            cache.lastDy = 0;
            const t = renderProps.globalTransform;
            cache.ta = t.ta;
            cache.tc = t.tc;
            cache.tb = t.tb;
            cache.td = t.td;
            cache.tx = t.tx;
            cache.ty = t.ty;
        }
    }
    return null;
};
/**
 * Generate complete text layout with glyph positioning for caching
 */
const generateTextLayout = (props, fontCache) => {
    const fontSize = props.fontSize;
    const fontFamily = props.fontFamily;
    const metrics = SdfFontHandler.getFontMetrics(fontFamily, fontSize);
    const fontData = fontCache.data;
    const commonFontData = fontData.common;
    const designFontSize = fontData.info.size;
    // common.base = distance from BMFont line-box top to the alphabetic baseline,
    // in atlas design units. Used to convert per-glyph yoffset (BMFont top -> glyph top)
    // into baseline-relative placement.
    const atlasBase = commonFontData.base;
    // When the user does not specify lineHeight, fall back to the engine's
    // 'normal' line height (ascender + lineGap - descender) computed inside
    // mapTextLayout via the supplied metrics. Passing 0 below triggers that path.
    const lineHeight = props.lineHeight;
    const atlasWidth = commonFontData.scaleW;
    const atlasHeight = commonFontData.scaleH;
    const invAtlasWidth = 1 / atlasWidth;
    const invAtlasHeight = 1 / atlasHeight;
    const glyphMap = fontCache.glyphMap;
    const kernings = fontCache.kernings;
    const fallbackGlyphId = isProductionEnvironment ? 32 : 63;
    // Calculate the pixel scale from design units to pixels
    const fontScale = fontSize / designFontSize;
    const letterSpacing = props.letterSpacing / fontScale;
    const maxWidth = props.maxWidth / fontScale;
    const maxHeight = props.maxHeight;
    const [lines, _remainingLines, _hasRemainingText, _bareLineHeight, lineHeightPx, effectiveWidth, effectiveHeight,] = mapTextLayout(SdfFontHandler.measureText, metrics, props.text, props.textAlign, fontFamily, lineHeight, props.overflowSuffix, props.wordBreak, letterSpacing, props.maxLines, maxWidth, maxHeight);
    const lineAmount = lines.length;
    // Upper bound on glyph slots = total chars across all lines. Surrogate pairs
    // and skipped codepoints (zero-width / missing) may leave the tail of this
    // buffer unused; the real count is tracked in `glyphCount`.
    let maxGlyphs = 0;
    for (let i = 0; i < lineAmount; i++) {
        maxGlyphs += lines[i][0].length;
    }
    // Packed glyph buffer: SDF_GLYPH_STRIDE floats per glyph. One Float32Array
    // replaces what used to be one object literal per glyph.
    const glyphs = new Float32Array(maxGlyphs * SDF_GLYPH_STRIDE);
    let glyphIdx = 0;
    let glyphCount = 0;
    let currentX = 0;
    let baselineY = 0;
    for (let i = 0; i < lineAmount; i++) {
        const line = lines[i];
        const textLine = line[0];
        const textLineLength = textLine.length;
        let prevGlyphId = 0;
        currentX = line[3];
        // line[4] is the alphabetic baseline Y in screen px. Convert to atlas
        // design units (where glyph.yoffset and atlasBase live).
        baselineY = line[4] / fontScale;
        for (let j = 0; j < textLineLength; j++) {
            const codepoint = textLine.codePointAt(j);
            if (codepoint > 0xffff) {
                j++;
            }
            if (codepoint === 0x200b) {
                continue;
            }
            const char = textLine[j];
            if (hasZeroWidthSpace(char) === true) {
                continue;
            }
            // Get glyph data from font handler
            let glyph = glyphMap.get(codepoint);
            if (glyph === undefined) {
                glyph = glyphMap.get(fallbackGlyphId);
                if (glyph === undefined) {
                    continue;
                }
            }
            // Kerning offsets the current glyph relative to the previous glyph.
            let kerning = 0;
            // Add kerning if there's a previous character
            if (prevGlyphId !== 0) {
                const seconds = kernings[glyph.id];
                if (seconds !== undefined) {
                    const amount = seconds[prevGlyphId];
                    if (amount !== undefined) {
                        kerning = amount;
                    }
                }
            }
            // Apply pair kerning before placing this glyph.
            currentX += kerning;
            // Glyph position in atlas design units. yoffset is measured from the
            // BMFont line-box top; subtracting atlasBase re-anchors it relative to
            // the alphabetic baseline so fonts with different BMFont 'base' values
            // share the same on-screen baseline.
            glyphs[glyphIdx] = currentX + glyph.xoffset;
            glyphs[glyphIdx + 1] = baselineY + glyph.yoffset - atlasBase;
            glyphs[glyphIdx + 2] = glyph.width;
            glyphs[glyphIdx + 3] = glyph.height;
            glyphs[glyphIdx + 4] = glyph.x * invAtlasWidth;
            glyphs[glyphIdx + 5] = glyph.y * invAtlasHeight;
            glyphs[glyphIdx + 6] = glyph.width * invAtlasWidth;
            glyphs[glyphIdx + 7] = glyph.height * invAtlasHeight;
            glyphIdx += SDF_GLYPH_STRIDE;
            glyphCount++;
            // Advance position with letter spacing (in design units)
            currentX += glyph.xadvance + letterSpacing;
            prevGlyphId = glyph.id;
        }
    }
    // Convert final dimensions to pixel space for the layout
    return {
        glyphs,
        glyphCount,
        distanceRange: fontScale * fontData.distanceField.distanceRange,
        width: effectiveWidth * fontScale,
        height: effectiveHeight,
        fontScale: fontScale,
        lineHeight: lineHeightPx,
        fontFamily,
    };
};
/**
 * Trim the layout cache back down to `maxLayoutCacheSize`, evicting the
 * least-recently-used entries first. Called when the stage goes idle so this
 * never competes with active rendering. A fresh iterator is taken each step so
 * we always delete the current front (oldest) key without iterator-invalidation
 * concerns; this runs at most once per idle transition and only when over cap.
 */
const cleanup = () => {
    while (layoutCache.size > maxLayoutCacheSize) {
        const oldest = layoutCache.keys().next().value;
        layoutCache.delete(oldest);
    }
};
/**
 * SDF Text Renderer - implements TextRenderer interface
 */
const SdfTextRenderer = {
    type,
    font,
    renderText,
    renderQuads,
    init,
    cleanup,
};
export default SdfTextRenderer;
//# sourceMappingURL=SdfTextRenderer.js.map