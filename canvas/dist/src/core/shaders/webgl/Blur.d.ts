import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { type BlurProps } from '../templates/BlurTemplate.js';
/**
 * Single-pass 3x3 Gaussian-approximation blur (1,2,1 / 2,4,2 / 1,2,1) / 16.
 *
 * 9 texture fetches, no second pass, no render target — designed for Image
 * Textures on constrained devices. Larger blurs trade smoothness for speed;
 * if a higher-quality blur is needed, stack multiple nodes or do a separable
 * pass.
 */
export declare const Blur: WebGlShaderType<BlurProps>;
