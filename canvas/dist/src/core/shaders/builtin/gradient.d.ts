import type { AdvancedProp, UniformWriter } from '../ShaderType.js';
/**
 * Rows the stops of `n` colours take. LinearGradient, RadialGradient and
 * RadialProgress keep their stops in `u_params` from a row `first`: the
 * colours, then the stop ramps two to a row (stop i, from 1, in row
 * `first + n + (i - 1) / 2`, xy for odd i and zw for even).
 */
export declare const gradientRows: (n: number) => number;
/** `uniform vec4 u_params[rows];` */
export declare const paramsUniform: (rows: number) => string;
/**
 * Branchless stop evaluation (1.10 genGradientColors): evaluates the stops
 * at `x` (a float expression in [0, 1]), leaving the colour in
 * `vec4 colorOut`. Segment i is
 * `smoothstep(stop[i - 1], stop[i], dist)` with its reciprocal span
 * precomputed, evaluated as `(dist - edge) * scale` (exact near the stop on
 * binary16, where a multiply-add is not).
 */
export declare const gradientGlsl: (n: number, first: number, x: string) => string;
/** Write the colours and stop ramps from row `first`. */
export declare const packGradient: (u: UniformWriter, first: number, colors: number[], stops: number[]) => void;
/** `colors`: a non-empty array, else the default (1.10). */
export declare const colorsProp: (def: number[]) => AdvancedProp<unknown>;
/** `stops`: one per colour, else spread evenly (1.10). */
export declare const stopsProp: (def: number[]) => AdvancedProp<unknown>;
