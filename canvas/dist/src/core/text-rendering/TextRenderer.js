/**
 * Number of Float32 entries per glyph in a packed {@link TextLayout.glyphs}
 * buffer. The per-glyph fields are stored contiguously in this order:
 *
 * ```
 * [0] x            [4] atlasX
 * [1] y            [5] atlasY
 * [2] width        [6] atlasWidth
 * [3] height       [7] atlasHeight
 * ```
 *
 * Glyph `i` occupies `glyphs[i * SDF_GLYPH_STRIDE .. +SDF_GLYPH_STRIDE]`.
 * A flat typed array (instead of an array of `{x, y, ...}` objects) avoids
 * allocating one object per glyph on every layout generation.
 */
export const SDF_GLYPH_STRIDE = 8;
//# sourceMappingURL=TextRenderer.js.map