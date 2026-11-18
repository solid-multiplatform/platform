import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';
import { rampScale } from '../../../shaders/utils.js';

//#region Types
export interface AttributeInfo {
  name: string;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
}

export type SingleValue = number | Float32Array | Int32Array;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export type UniformValue = SingleValue | Vec2 | Vec3 | Vec4;

export interface UniformCollection {
  single: Record<string, Uniform<SingleValue>>;
  vec2: Record<string, Uniform<Vec2>>;
  vec3: Record<string, Uniform<Vec3>>;
  vec4: Record<string, Uniform<Vec4>>;
}

export interface Uniform<T = UniformValue> {
  method: string;
  value: T;
}

// prettier-ignore
type IsUniformMethod<MethodName, MethodType> = MethodName extends `uniform${string}`
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MethodType extends (location: WebGLUniformLocation | null, ...args: any[]) => void
  ? true
  : false
  : false;

// prettier-ignore
export type UniformMethodMap = {
  [Key in keyof WebGLRenderingContext as IsUniformMethod<Key, WebGLRenderingContext[Key]> extends true ? Key : never]: WebGLRenderingContext[Key] extends (
    location: WebGLUniformLocation | null,
    ...args: infer T
  ) => void
  ? T
  : never;
};

export type UniformSet1Param = Omit<
  UniformMethodMap,
  | 'uniform2f'
  | 'uniform2i'
  | 'uniform3f'
  | 'uniform3i'
  | 'uniform4f'
  | 'uniform4i'
>;
export type UniformSet2Params = Pick<
  UniformMethodMap,
  'uniform2f' | 'uniform2i'
>;
export type UniformSet3Params = Pick<
  UniformMethodMap,
  'uniform3f' | 'uniform3i'
>;
export type UniformSet4Params = Pick<
  UniformMethodMap,
  'uniform4f' | 'uniform4i'
>;

export type ShaderSource = string | ((textureUnits: number) => string);

export interface ShaderProgramSources {
  vertex: ShaderSource;
  fragment: ShaderSource;
  webGl2?: {
    vertex: ShaderSource;
    fragment: ShaderSource;
  };
}

//#endregion Types

export function createShader(
  glw: WebGlContextWrapper,
  type: number,
  source: string,
) {
  const shader = glw.createShader(type);
  if (!shader) {
    const glError = glw.getError();
    throw new Error(
      `Unable to create the shader: ${
        type === glw.VERTEX_SHADER ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER'
      }.${glError ? ` WebGlContext Error: ${glError}` : ''}`,
    );
  }

  glw.shaderSource(shader, source);
  glw.compileShader(shader);
  const success = !!glw.getShaderParameter(shader, glw.COMPILE_STATUS);
  if (success) {
    return shader;
  }

  console.error(glw.getShaderInfoLog(shader));
  glw.deleteShader(shader);
}

export function createProgram(
  glw: WebGlContextWrapper,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
) {
  const program = glw.createProgram();
  if (!program) {
    throw new Error('Unable to create program');
  }

  glw.attachShader(program, vertexShader);
  glw.attachShader(program, fragmentShader);
  glw.linkProgram(program);
  const success = !!glw.getProgramParameter(program, glw.LINK_STATUS);
  if (success) {
    return program;
  }

  const infoLog =
    glw.getProgramInfoLog(program) || 'Unknown program link error';
  console.warn(infoLog);
  glw.deleteProgram(program);
  throw new Error(`Unable to link shader program: ${infoLog}`);
}

/**
 * Generates branchless gradient-stop evaluation statements for a fragment
 * shader. Expects a `float dist` in scope and `u_colors` (vec4) and
 * `u_stopRamps` (vec2, filled by {@link gradientStopRamps}) uniform arrays of
 * length `stops`; leaves the result in `vec4 colorOut`.
 *
 * Segment i is `smoothstep(stop[i - 1], stop[i], dist)` with its reciprocal
 * span precomputed: `t = clamp((dist - edge) * scale)` is a subtract and a
 * multiply where smoothstep with uniform edges costs two subtracts and a
 * division. Subtracting first matters on Mali-400, whose mediump is binary16
 * with no fused multiply-add: near the segment the difference is exact, while
 * `dist * scale + offset` rounds the large product before the offset cancels
 * it (about 10/255 off on a 0.9 -> 0.91 segment, against under 4/255 here).
 *
 * The accumulated `mix()` chain is exactly equivalent to selecting the
 * segment containing `dist` (for ascending stops): below a segment the
 * smoothstep is 0 (no-op), above it is 1 (fully replaced by the next color).
 * No `if`/ternary — Mali 400-class fragment pipelines serialize any branch.
 */
export function genGradientColors(stops: number): string {
  let result = `vec4 colorOut = u_colors[0];`;
  for (let i = 1; i < stops; i++) {
    result += `
      float t${i} = clamp((dist - u_stopRamps[${i}].x) * u_stopRamps[${i}].y, 0.0, 1.0);
      colorOut = mix(colorOut, u_colors[${i}], t${i} * t${i} * (3.0 - 2.0 * t${i}));`;
  }
  return result;
}

/**
 * `u_stopRamps` data for {@link genGradientColors}: vec2 i holds the start
 * edge and scale of segment `stops[i - 1]` -> `stops[i]` (see `rampScale`);
 * vec2 0 is unused, keeping the indices aligned with `u_colors`.
 */
export const gradientStopRamps = (stops: number[]): Float32Array => {
  const ramps = new Float32Array(stops.length * 2);
  for (let i = 1; i < stops.length; i++) {
    const e0 = stops[i - 1] as number;
    ramps[i * 2] = e0;
    ramps[i * 2 + 1] = rampScale(e0, stops[i] as number);
  }
  return ramps;
};
