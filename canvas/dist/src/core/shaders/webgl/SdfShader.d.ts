import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
/**
 * SdfShader supports multi-channel and single-channel signed distance field textures.
 *
 * @remarks
 * All per-glyph data (position, color, distance range) is provided via vertex
 * attributes so that multiple text nodes sharing the same font atlas can be
 * batched into a single draw call. Two node-level values ride the render op
 * as system uniforms instead, so animating them never rewrites vertex data:
 * u_translate (pure translation from the cache base) and u_alpha (world
 * alpha). Ops merge only when both match across nodes; see
 * WebGlRenderer.finalizeSdfBatch.
 *
 * This Shader is used by the {@link SdfTextRenderer}. Do not use this Shader
 * directly. Instead create a Text Node and assign a SDF font family to it.
 */
export declare const Sdf: WebGlShaderType;
