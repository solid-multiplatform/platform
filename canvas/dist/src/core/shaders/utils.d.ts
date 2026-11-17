import type { Vec4 } from '../renderers/webgl/internal/ShaderUtils.js';
import type { WebGlRenderer } from '../renderers/webgl/WebGlRenderer.js';
export declare const validateArrayLength4: (value: number | number[]) => Vec4;
export type PrefixedType<T, P extends string | undefined = undefined> = {
    [Key in keyof T as P extends string ? `${P}-${string & Key}` : Key]: T[Key];
};
/**
 * GLSL `#define EDGE_WIDTH` for SDF anti-aliasing: one device pixel in logical
 * pixels, and `INV_EDGE_WIDTH`, its reciprocal (the pixel ratio). Pixel ratio
 * is fixed at construction, so both compile into the program instead of
 * costing a `1.0 / u_pixelRatio` on every fragment.
 *
 * An SDF edge's coverage is `clamp(0.5 - d * INV_EDGE_WIDTH, 0.0, 1.0)`: a
 * linear ramp one device pixel wide, 50% on the true edge. That is one
 * multiply-add and a clamp; a smoothstep would add a Hermite curve whose shape
 * is invisible across a single pixel.
 */
export declare const edgeWidthDefine: (pixelRatio: number) => string;
/**
 * Scale for a smoothstep whose edges are uniforms: `1 / (e1 - e0)`, computed
 * once per value key instead of a subtract and a division on every fragment.
 * With `offset = -e0 * scale`, the shader evaluates `smoothstep(e0, e1, x)` as
 * `t = clamp(x * scale + offset, 0.0, 1.0); t * t * (3.0 - 2.0 * t)`, the same
 * curve. Spans narrower than MIN_RAMP_SPAN use it instead, so the scale is
 * always finite.
 */
export declare const rampScale: (e0: number, e1: number) => number;
/**
 * GLSL for the viewport, which is fixed at construction: `PIXEL_RATIO`,
 * `RESOLUTION` (canvas size in device pixels) and `pxToClip`, which maps a
 * logical-pixel position to clip space (y down). Vertex shaders compile these
 * in instead of reading `u_pixelRatio` / `u_resolution` uniforms, so no draw
 * has to compare or upload them. Place it after the precision statement.
 */
export declare const viewportGlsl: (renderer: WebGlRenderer) => string;
/**
 * A shader's packed per-node values: GLSL name -> row of its
 * `uniform vec4 u_params[N]`. Rows run 0..N-1. A collection switch then
 * costs one uniform4fv instead of one gl.uniform* call (plus a name lookup
 * and method dispatch in bindRenderOp) per value.
 */
export type ParamRows = Readonly<Record<string, number>>;
/** Floats in a packed `u_params` array: four per row. */
export declare const paramsLength: (rows: ParamRows) => number;
/**
 * GLSL declaring a packed `u_params` array, plus a `#define NAME
 * u_params[row]` per row so the shader reads named rows through constant
 * indices, the only indexing GLSL ES 1.0 guarantees in fragment shaders. A
 * uniform used by both stages must be declared identically, precision
 * included, so both stages include this after the same precision guard.
 */
export declare const paramsGlsl: (rows: ParamRows) => string;
/** Write one vec4 row of a packed `u_params` array. */
export declare const setParam: (params: Float32Array, row: number, x: number, y: number, z: number, w: number) => void;
/**
 * Copy a Vec4 into one row. Copying matters: advanced prop setters mutate
 * their resolved arrays in place, and a filled collection is shared by
 * reference, so it must not hold a prop's own array.
 */
export declare const setParamVec4: (params: Float32Array, row: number, value: Vec4) => void;
/** A 0xRRGGBBAA colour as normalized RGBA, as `uniformRGBA` uploads it. */
export declare const setParamRgba: (params: Float32Array, row: number, rgba: number) => void;
