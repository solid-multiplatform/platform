import type { ShaderType } from '../ShaderType.js';
export interface RadialGradientProps {
    /**
     * 0xRRGGBBAA colours, at most 9: 10 take 18 fragment uniform vectors,
     * past the 16 of the GPU floor (the rules test holds the count).
     */
    colors: number[];
    stops: number[];
    /** Radial width, from the centre to the outer edge. */
    w: number;
    /** Radial height. */
    h: number;
    /** The centre, as a fraction of the node size (copied). */
    pivot: [number, number];
}
/**
 * A radial gradient blended over the node's colour (1.10 RadialGradient).
 * `(point - centre) / size` is linear across the quad, so it is
 * interpolated and the fragment takes its length. Row 0: node size (xy) and
 * centre (zw); row 1: radial size; then the stops.
 */
export declare const RadialGradient: ShaderType<RadialGradientProps>;
