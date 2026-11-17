import type { UniformWriter } from './ShaderType.js';
/**
 * The fragment precision guard (CLAUDE.md): highp where the stage has it,
 * mediump (binary16 on Mali 400) otherwise. Vertex shaders open with it too,
 * so varyings and shared uniforms get the same precision in both stages.
 */
export declare const PRECISION = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
/**
 * The viewport, fixed at construction, compiled in: `PIXEL_RATIO`,
 * `RESOLUTION` (canvas size in device pixels) and `pxToClip`, which maps a
 * logical-pixel position to clip space with y down (1.10 viewportGlsl).
 */
export declare const viewportGlsl: (pixelRatio: number, w: number, h: number) => string;
/**
 * The default vertex shader plus per-shader extras: `declarations` adds
 * uniforms and varyings, `assignments` writes them inside main(), where the
 * attributes are in scope. Interpolate values that are linear across the
 * quad here instead of rebuilding them per fragment. `viewport` is the
 * backend's viewportGlsl.
 */
export declare const defaultVertex: (viewport: string, declarations: string, assignments: string) => string;
/**
 * `EDGE_WIDTH` (one device pixel, in logical px) and `INV_EDGE_WIDTH` (the
 * pixel ratio) for SDF anti-aliasing, compiled in with the literals 1.10
 * compiled (pixel parity). An edge's coverage is
 * `clamp(0.5 - d * INV_EDGE_WIDTH, 0.0, 1.0)`: a linear ramp one device
 * pixel wide, 50% on the true edge.
 */
export declare const edgeWidthDefine: (pixelRatio: number) => string;
/**
 * `1 / (e1 - e0)`, computed in `pack` so the shader evaluates
 * `smoothstep(e0, e1, x)` with a multiply instead of a subtract and a
 * division per fragment (1.10 rampScale).
 */
export declare const rampScale: (e0: number, e1: number) => number;
/**
 * Row `i` of `u_params` from a 0xRRGGBBAA colour, normalized (1.10
 * uniformRGBA). The byte math is inline, where `getNormalizedRgbaComponents`
 * allocates an array per colour: a pack runs on every frame of a
 * shader-prop animation.
 */
export declare const rgbaRow: (u: UniformWriter, i: number, color: number) => void;
/**
 * `uniform vec4 u_params[N]` and a `#define NAME u_params[i]` per row, so a
 * shader reads its rows through constant indices, the only indexing GLSL ES
 * 1.0 guarantees in fragment shaders. A shader that reads rows in both
 * stages includes it in both, after the same precision guard: a uniform
 * the stages share must match.
 */
export declare const paramsGlsl: (rows: string[]) => string;
