import type { CoreNode } from '../../CoreNode.js';
import type { Stage } from '../../Stage.js';
import { CoreShaderNode, type CoreShaderType } from '../CoreShaderNode.js';
import type { UniformCollection, Vec2, Vec3, Vec4 } from './internal/ShaderUtils.js';
import type { WebGlRenderer, WebGlRenderOp } from './WebGlRenderer.js';
import type { WebGlShaderProgram } from './WebGlShaderProgram.js';
export type ShaderSource<T> = string | ((renderer: WebGlRenderer, props: T) => string);
/**
 * This is the WebGL specific ShaderType @mixes CoreShaderType
 */
export type WebGlShaderType<T extends object = Record<string, unknown>> = CoreShaderType<T> & {
    /**
     * fragment shader source for WebGl
     */
    fragment: ShaderSource<T>;
    /**
     * vertex shader source for WebGl
     */
    vertex?: ShaderSource<T>;
    /**
     * This function is called when one of the props is changed, here you can update the uniforms you use in the fragment / vertex shader.
     * @param node WebGlContextWrapper with utilities to update uniforms, and other actions.
     */
    update?: (this: WebGlShaderNode<T>, node: CoreNode) => void;
    /**
     * This function is used to check if the shader can be reused based on quad info
     * @param props
     */
    canBatch?: (node: CoreNode, currentRenderOp: WebGlRenderOp) => boolean;
    /**
     * extensions required for specific shader?
     */
    webgl1Extensions?: string[];
};
export declare class WebGlShaderNode<Props extends object = Record<string, unknown>> extends CoreShaderNode<Props> {
    readonly program: WebGlShaderProgram;
    uniforms: UniformCollection;
    constructor(shaderKey: string, config: WebGlShaderType<Props>, program: WebGlShaderProgram, stage: Stage, props?: Props);
    protected resetValues(): Record<string, unknown>;
    protected adoptValues(values: Record<string, unknown>): void;
    /**
     * Sets the value of a RGBA variable
     * @param location
     * @param value
     */
    uniformRGBA(location: string, value: number): void;
    /**
     * Sets the value of a single float uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The value to set.
     */
    uniform1f(location: string, value: number): void;
    /**
     * Sets the value of a float array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of values to set.
     */
    uniform1fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a single integer uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The value to set.
     */
    uniform1i(location: string, value: number): void;
    /**
     * Sets the value of an integer array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of values to set.
     */
    uniform1iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     */
    uniform2f(location: string, v0: number, v1: number): void;
    /**
     * Sets the value of a vec2 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec2 values to set as FloatArray.
     */
    uniform2fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a vec2 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec2 values to set.
     */
    uniform2fa(location: string, value: Vec2): void;
    /**
     * Sets the value of a ivec2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     */
    uniform2i(location: string, v0: number, v1: number): void;
    /**
     * Sets the value of an ivec2 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec2 values to set.
     */
    uniform2iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec3 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     */
    uniform3f(location: string, v0: number, v1: number, v2: number): void;
    /**
     * Sets the value of a vec3 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param
     */
    uniform3fa(location: string, value: Vec3): void;
    /**
     * Sets the value of a vec3 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec3 values to set.
     */
    uniform3fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a ivec3 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     */
    uniform3i(location: string, v0: number, v1: number, v2: number): void;
    /**
     * Sets the value of an ivec3 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec3 values to set.
     */
    uniform3iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a vec4 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     * @param v3 - The fourth component of the vector.
     */
    uniform4f(location: string, v0: number, v1: number, v2: number, v3: number): void;
    /**
     * Sets an array of numbers
     * @param location The location of the uniform variable.
     * @param value
     */
    uniform4fa(location: string, value: Vec4): void;
    /**
     * Sets the value of a vec4 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of vec4 values to set.
     */
    uniform4fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a ivec4 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param v0 - The first component of the vector.
     * @param v1 - The second component of the vector.
     * @param v2 - The third component of the vector.
     * @param v3 - The fourth component of the vector.
     */
    uniform4i(location: string, v0: number, v1: number, v2: number, v3: number): void;
    /**
     * Sets the value of an ivec4 array uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param value - The array of ivec4 values to set.
     */
    uniform4iv(location: string, value: Int32Array): void;
    /**
     * Sets the value of a mat2 uniform variable.
     *
     * @param location - The location of the uniform variable.
     * @param transpose - Whether to transpose the matrix.
     * @param value - The array of mat2 values to set.
     */
    uniformMatrix2fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a mat2 uniform variable.
     * @param location - The location of the uniform variable.
     * @param value - The array of mat2 values to set.
     */
    uniformMatrix3fv(location: string, value: Float32Array): void;
    /**
     * Sets the value of a mat4 uniform variable.
     * @param location - The location of the uniform variable.
     * @param value - The array of mat4 values to set.
     */
    uniformMatrix4fv(location: string, value: Float32Array): void;
}
