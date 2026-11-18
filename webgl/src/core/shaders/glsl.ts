import type { UniformWriter } from './ShaderType.js';

/**
 * The fragment precision guard (CLAUDE.md): highp where the stage has it,
 * mediump (binary16 on Mali 400) otherwise. Vertex shaders open with it too,
 * so varyings and shared uniforms get the same precision in both stages.
 */
export const PRECISION =
  '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

/** A number as a GLSL float literal, always with a decimal point (1.10). */
const glslFloat = (value: number): string =>
  Number.isInteger(value) === true ? value.toFixed(1) : String(value);

/**
 * The viewport, fixed at construction, compiled in: `PIXEL_RATIO`,
 * `RESOLUTION` (canvas size in device pixels) and `pxToClip`, which maps a
 * logical-pixel position to clip space with y down (1.10 viewportGlsl).
 */
export const viewportGlsl = (
  pixelRatio: number,
  w: number,
  h: number,
): string =>
  `#define PIXEL_RATIO ${glslFloat(pixelRatio)}\n` +
  `#define RESOLUTION vec2(${glslFloat(w)}, ${glslFloat(h)})\n` +
  'vec4 pxToClip(vec2 px){return vec4((px*PIXEL_RATIO/RESOLUTION*2.0-1.0)*vec2(1.0,-1.0),0.0,1.0);}\n';

/**
 * The default vertex shader plus per-shader extras: `declarations` adds
 * uniforms and varyings, `assignments` writes them inside main(), where the
 * attributes are in scope. Interpolate values that are linear across the
 * quad here instead of rebuilding them per fragment. `viewport` is the
 * backend's viewportGlsl.
 */
export const defaultVertex = (
  viewport: string,
  declarations: string,
  assignments: string,
): string =>
  PRECISION +
  'attribute vec2 a_position;attribute vec2 a_textureCoords;attribute vec4 a_color;attribute vec2 a_nodeCoords;\n' +
  viewport +
  'varying vec4 v_color;varying vec2 v_textureCoords;\n' +
  declarations +
  '\nvoid main(){v_color=a_color;v_textureCoords=a_textureCoords;\n' +
  assignments +
  '\ngl_Position=pxToClip(a_position);}';

/**
 * `EDGE_WIDTH` (one device pixel, in logical px) and `INV_EDGE_WIDTH` (the
 * pixel ratio) for SDF anti-aliasing, compiled in with the literals 1.10
 * compiled (pixel parity). An edge's coverage is
 * `clamp(0.5 - d * INV_EDGE_WIDTH, 0.0, 1.0)`: a linear ramp one device
 * pixel wide, 50% on the true edge.
 */
export const edgeWidthDefine = (pixelRatio: number, resizable = false): string =>
  resizable ? '#ifndef SMP_PIXEL_RATIO_UNIFORM\n#define SMP_PIXEL_RATIO_UNIFORM\nuniform float u_pixelRatio;\n#endif\n#define EDGE_WIDTH (1.0/u_pixelRatio)\n#define INV_EDGE_WIDTH u_pixelRatio\n' :
  `#define EDGE_WIDTH ${(1 / pixelRatio).toFixed(8)}\n` +
  `#define INV_EDGE_WIDTH ${pixelRatio.toFixed(8)}\n`;

/**
 * Narrowest span a precomputed smoothstep uses: coincident edges would make
 * `1 / (e1 - e0)` infinite. 1/4096 still renders as a hard step, and its
 * 4096 scale stays far inside binary16 (65504, mediump on Mali-400).
 */
const MIN_RAMP_SPAN = 1 / 4096;

/**
 * `1 / (e1 - e0)`, computed in `pack` so the shader evaluates
 * `smoothstep(e0, e1, x)` with a multiply instead of a subtract and a
 * division per fragment (1.10 rampScale).
 */
export const rampScale = (e0: number, e1: number): number => {
  const span = e1 - e0;
  if (span < MIN_RAMP_SPAN && span > -MIN_RAMP_SPAN) {
    return 1 / MIN_RAMP_SPAN;
  }
  return 1 / span;
};

/**
 * Row `i` of `u_params` from a 0xRRGGBBAA colour, normalized (1.10
 * uniformRGBA). The byte math is inline, where `getNormalizedRgbaComponents`
 * allocates an array per colour: a pack runs on every frame of a
 * shader-prop animation.
 */
export const rgbaRow = (u: UniformWriter, i: number, color: number): void => {
  u.row(
    i,
    (color >>> 24) / 255,
    ((color >>> 16) & 0xff) / 255,
    ((color >>> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  );
};

/**
 * `uniform vec4 u_params[N]` and a `#define NAME u_params[i]` per row, so a
 * shader reads its rows through constant indices, the only indexing GLSL ES
 * 1.0 guarantees in fragment shaders. A shader that reads rows in both
 * stages includes it in both, after the same precision guard: a uniform
 * the stages share must match.
 */
export const paramsGlsl = (rows: string[]): string => {
  let glsl = `uniform vec4 u_params[${rows.length}];\n`;
  for (let i = 0; i < rows.length; i++) {
    glsl += `#define ${rows[i]!} u_params[${i}]\n`;
  }
  return glsl;
};
