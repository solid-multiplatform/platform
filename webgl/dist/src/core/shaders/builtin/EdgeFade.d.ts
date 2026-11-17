import type { ShaderType } from '../ShaderType.js';
export interface EdgeFadeProps {
    /** Fade distance in px from each edge; 0 disables that edge's fade. */
    left: number;
    top: number;
    right: number;
    bottom: number;
}
/**
 * Multiplies the node's alpha by a linear ramp inward from each edge with a
 * fade (1.10 EdgeFade). Row 0: node size; row 1: the four reciprocals.
 */
export declare const EdgeFade: ShaderType<EdgeFadeProps>;
