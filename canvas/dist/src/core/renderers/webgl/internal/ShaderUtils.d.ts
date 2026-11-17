import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';
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
type IsUniformMethod<MethodName, MethodType> = MethodName extends `uniform${string}` ? MethodType extends (location: WebGLUniformLocation | null, ...args: any[]) => void ? true : false : false;
export type UniformMethodMap = {
    [Key in keyof WebGLRenderingContext as IsUniformMethod<Key, WebGLRenderingContext[Key]> extends true ? Key : never]: WebGLRenderingContext[Key] extends (location: WebGLUniformLocation | null, ...args: infer T) => void ? T : never;
};
export type UniformSet1Param = Omit<UniformMethodMap, 'uniform2f' | 'uniform2i' | 'uniform3f' | 'uniform3i' | 'uniform4f' | 'uniform4i'>;
export type UniformSet2Params = Pick<UniformMethodMap, 'uniform2f' | 'uniform2i'>;
export type UniformSet3Params = Pick<UniformMethodMap, 'uniform3f' | 'uniform3i'>;
export type UniformSet4Params = Pick<UniformMethodMap, 'uniform4f' | 'uniform4i'>;
export type ShaderSource = string | ((textureUnits: number) => string);
export interface ShaderProgramSources {
    vertex: ShaderSource;
    fragment: ShaderSource;
    webGl2?: {
        vertex: ShaderSource;
        fragment: ShaderSource;
    };
}
export declare function createShader(glw: WebGlContextWrapper, type: number, source: string): WebGLShader | undefined;
export declare function createProgram(glw: WebGlContextWrapper, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram;
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
export declare function genGradientColors(stops: number): string;
/**
 * `u_stopRamps` data for {@link genGradientColors}: vec2 i holds the start
 * edge and scale of segment `stops[i - 1]` -> `stops[i]` (see `rampScale`);
 * vec2 0 is unused, keeping the indices aligned with `u_colors`.
 */
export declare const gradientStopRamps: (stops: number[]) => Float32Array;
export {};
