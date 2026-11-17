import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { type EdgeFadeProps } from '../templates/EdgeFadeTemplate.js';
/**
 * Multiplies the node's alpha by a linear ramp inward from each edge with a
 * non-zero fade distance, revealing whatever is rendered behind the node.
 * Unlike {@link LinearGradient} this masks the texture's own alpha instead of
 * blending a gradient color over its RGB.
 */
export declare const EdgeFade: WebGlShaderType<EdgeFadeProps>;
