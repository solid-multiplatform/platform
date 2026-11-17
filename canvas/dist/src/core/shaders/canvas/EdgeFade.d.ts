import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import { type EdgeFadeProps } from '../templates/EdgeFadeTemplate.js';
/**
 * Canvas2D implementation of {@link EdgeFade}: the node's content is drawn
 * into an offscreen canvas, the edge ramps are erased with destination-out
 * gradients, and the result is composited onto the main canvas. This keeps
 * the background behind the node intact, which a destination-out pass on the
 * main canvas could not.
 */
export declare const EdgeFade: CanvasShaderType<EdgeFadeProps>;
