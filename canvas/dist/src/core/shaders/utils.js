import { assertTruthy } from '../../utils.js';
import { getNormalizedRgbaComponents } from '../lib/utils.js';
export const validateArrayLength4 = (value) => {
    if (!Array.isArray(value)) {
        return [value, value, value, value];
    }
    assertTruthy(value);
    if (value.length === 4) {
        return value;
    }
    if (value.length === 3) {
        value[3] = value[0];
        return value;
    }
    if (value.length === 2) {
        value[2] = value[0];
        value[3] = value[1];
        return value;
    }
    value[0] = value[0] || 0;
    value[1] = value[0];
    value[2] = value[0];
    value[3] = value[0];
    return value;
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
export const edgeWidthDefine = (pixelRatio) => `#define EDGE_WIDTH ${(1 / pixelRatio).toFixed(8)}
    #define INV_EDGE_WIDTH ${pixelRatio.toFixed(8)}`;
/**
 * Narrowest span a precomputed smoothstep ramp uses. Coincident edges (a zero
 * blur and spread, or a hard gradient stop) would make `1 / (e1 - e0)`
 * infinite. A 1/4096 span still renders as a hard step (well under a device
 * pixel, even for gradient units across a 1080p screen), and its 4096 scale
 * stays far inside the fp16 range mediump has on Mali-400 (65504).
 */
const MIN_RAMP_SPAN = 1 / 4096;
/**
 * Scale for a smoothstep whose edges are uniforms: `1 / (e1 - e0)`, computed
 * once per value key instead of a subtract and a division on every fragment.
 * With `offset = -e0 * scale`, the shader evaluates `smoothstep(e0, e1, x)` as
 * `t = clamp(x * scale + offset, 0.0, 1.0); t * t * (3.0 - 2.0 * t)`, the same
 * curve. Spans narrower than MIN_RAMP_SPAN use it instead, so the scale is
 * always finite.
 */
export const rampScale = (e0, e1) => {
    const span = e1 - e0;
    if (span < MIN_RAMP_SPAN && span > -MIN_RAMP_SPAN) {
        return 1 / MIN_RAMP_SPAN;
    }
    return 1 / span;
};
/** A JS number as a GLSL float literal (always with a decimal point). */
const glslFloat = (value) => Number.isInteger(value) === true ? value.toFixed(1) : String(value);
/**
 * GLSL for the viewport, which is fixed at construction: `PIXEL_RATIO`,
 * `RESOLUTION` (canvas size in device pixels) and `pxToClip`, which maps a
 * logical-pixel position to clip space (y down). Vertex shaders compile these
 * in instead of reading `u_pixelRatio` / `u_resolution` uniforms, so no draw
 * has to compare or upload them. Place it after the precision statement.
 */
export const viewportGlsl = (renderer) => `
    #define PIXEL_RATIO ${glslFloat(renderer.stage.pixelRatio)}
    #define RESOLUTION vec2(${glslFloat(renderer.glw.canvasW)}, ${glslFloat(renderer.glw.canvasH)})

    vec4 pxToClip(vec2 px) {
      return vec4((px * PIXEL_RATIO / RESOLUTION * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
    }
`;
/** Floats in a packed `u_params` array: four per row. */
export const paramsLength = (rows) => Object.keys(rows).length * 4;
/**
 * GLSL declaring a packed `u_params` array, plus a `#define NAME
 * u_params[row]` per row so the shader reads named rows through constant
 * indices, the only indexing GLSL ES 1.0 guarantees in fragment shaders. A
 * uniform used by both stages must be declared identically, precision
 * included, so both stages include this after the same precision guard.
 */
export const paramsGlsl = (rows) => {
    let glsl = `uniform vec4 u_params[${Object.keys(rows).length}];`;
    for (const name in rows) {
        glsl += `\n    #define ${name} u_params[${rows[name]}]`;
    }
    return glsl;
};
/** Write one vec4 row of a packed `u_params` array. */
export const setParam = (params, row, x, y, z, w) => {
    const i = row * 4;
    params[i] = x;
    params[i + 1] = y;
    params[i + 2] = z;
    params[i + 3] = w;
};
/**
 * Copy a Vec4 into one row. Copying matters: advanced prop setters mutate
 * their resolved arrays in place, and a filled collection is shared by
 * reference, so it must not hold a prop's own array.
 */
export const setParamVec4 = (params, row, value) => {
    setParam(params, row, value[0], value[1], value[2], value[3]);
};
/** A 0xRRGGBBAA colour as normalized RGBA, as `uniformRGBA` uploads it. */
export const setParamRgba = (params, row, rgba) => {
    const c = getNormalizedRgbaComponents(rgba);
    setParam(params, row, c[0], c[1], c[2], c[3]);
};
//# sourceMappingURL=utils.js.map