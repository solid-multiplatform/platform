import type { ShaderType } from '../ShaderType.js';
export interface LinearGradientProps {
    /**
     * 0xRRGGBBAA colours, at most 9: 10 take 17 fragment uniform vectors,
     * past the 16 of the GPU floor (the rules test holds the count).
     */
    colors: number[];
    /** Angle in radians (0: top to bottom). */
    angle: number;
    /** One per colour, in [0, 1]; spread evenly when they do not match. */
    stops: number[];
}
/**
 * A linear gradient blended over the node's colour by the gradient's alpha
 * (1.10 LinearGradient). The gradient distance is affine in the texture
 * coordinates, `dot(uv, a) + b`, with `a` and `b` from the angle and size:
 * linear across the quad, so the vertex stage computes it and the fragment
 * clamps the interpolated value (1.10 rebuilt it per fragment). Row 0: a
 * (xy) and b (z); then the stops. One program per colour count.
 */
export declare const LinearGradient: ShaderType<LinearGradientProps>;
