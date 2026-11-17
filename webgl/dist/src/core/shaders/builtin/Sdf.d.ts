/**
 * The SDF text program (spec 10.3), compiled the first time a glyph is
 * emitted (ShaderRegistry.program). Per vertex: the world position, the
 * glyph's UV in the atlas (float, as 1.10's), the node's premultiplied
 * colour and the distance range at the text's size (`a_extra`). Glyphs of
 * every size and alpha share the program and batch per atlas and clip.
 * The UV is highp, which every vertex stage has: a mediump (binary16) UV
 * near 1.0 is off by up to half a texel of a 1024-wide atlas.
 */
export declare const sdfVertex: (viewport: string) => string;
/**
 * 1.10's SDF fragment shader: the median of the three channels (one for
 * SSDF, whose channels are equal) as a signed distance in screen pixels,
 * coverage a one-pixel ramp; no derivatives, no branch. The colour is
 * premultiplied already (world alpha folded in), so the output is the
 * colour times the coverage, where 1.10 premultiplied a straight colour by
 * it here.
 */
export declare const SDF_FRAGMENT: string;
