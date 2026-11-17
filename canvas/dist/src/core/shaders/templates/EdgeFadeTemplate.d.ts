import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';
/**
 * Properties of the {@link EdgeFade} shader
 */
export interface EdgeFadeProps {
    /**
     * Fade distance in pixels from the left edge. Alpha ramps 0 → 1 over this
     * distance. 0 disables the fade for this edge.
     *
     * @default 0
     */
    left: number;
    /**
     * Fade distance in pixels from the top edge.
     *
     * @default 0
     */
    top: number;
    /**
     * Fade distance in pixels from the right edge.
     *
     * @default 0
     */
    right: number;
    /**
     * Fade distance in pixels from the bottom edge.
     *
     * @default 0
     */
    bottom: number;
}
export declare const EdgeFadeTemplate: CoreShaderType<EdgeFadeProps>;
