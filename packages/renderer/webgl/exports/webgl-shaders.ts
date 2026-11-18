/**
 * The 1.10 path of the built-in shader types (`./webgl/shaders`): the same
 * exports as `./shaders`, and the types 1.10 exported here under their
 * 1.10 names (`WebGlShaderNode` is the type of `renderer.createShader`'s
 * result; 1.10's class has no v2 counterpart to construct).
 *
 * @module WebGlShaders
 */
export * from './shaders.js';
export type {
  WebGlShaderType,
  ShaderSource,
} from '../src/core/shaders/ShaderType.js';
export type { ShaderNode as WebGlShaderNode } from '../src/core/shaders/ShaderNode.js';
