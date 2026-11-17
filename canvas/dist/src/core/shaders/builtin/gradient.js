import { rampScale, rgbaRow } from '../glsl.js';
/**
 * Rows the stops of `n` colours take. LinearGradient, RadialGradient and
 * RadialProgress keep their stops in `u_params` from a row `first`: the
 * colours, then the stop ramps two to a row (stop i, from 1, in row
 * `first + n + (i - 1) / 2`, xy for odd i and zw for even).
 */
export const gradientRows = (n) => n + (n >> 1);
/** `uniform vec4 u_params[rows];` */
export const paramsUniform = (rows) => `uniform vec4 u_params[${rows}];`;
/**
 * Branchless stop evaluation (1.10 genGradientColors): evaluates the stops
 * at `x` (a float expression in [0, 1]), leaving the colour in
 * `vec4 colorOut`. Segment i is
 * `smoothstep(stop[i - 1], stop[i], dist)` with its reciprocal span
 * precomputed, evaluated as `(dist - edge) * scale` (exact near the stop on
 * binary16, where a multiply-add is not).
 */
export const gradientGlsl = (n, first, x) => {
    let glsl = `vec4 colorOut=u_params[${first}];`;
    for (let i = 1; i < n; i++) {
        const ramp = `u_params[${first + n + ((i - 1) >> 1)}]`;
        const color = `u_params[${first + i}]`;
        const xy = (i & 1) === 1 ? 'x' : 'z';
        const yw = (i & 1) === 1 ? 'y' : 'w';
        glsl +=
            `float t${i}=clamp((${x}-${ramp}.${xy})*${ramp}.${yw},0.0,1.0);` +
                `colorOut=mix(colorOut,${color},t${i}*t${i}*(3.0-2.0*t${i}));`;
    }
    return glsl;
};
/**
 * Stop `i` of `n` colours (n > 1): the given one, or spread evenly (as
 * `stopsProp` spreads them) when the stops do not match the colours, as
 * after a `colors` write that changed the count: the node switches to the
 * program of the new count, and its stops follow until `stops` is written.
 */
const stopAt = (stops, n, i) => stops.length === n ? stops[i] : i * (1 / (n - 1));
/** Write the colours and stop ramps from row `first`. */
export const packGradient = (u, first, colors, stops) => {
    const n = colors.length;
    for (let i = 0; i < n; i++) {
        rgbaRow(u, first + i, colors[i]);
    }
    for (let i = 1; i < n; i += 2) {
        const e0 = stopAt(stops, n, i - 1);
        const s0 = rampScale(e0, stopAt(stops, n, i));
        let e1 = 0;
        let s1 = 0;
        if (i + 1 < n) {
            e1 = stopAt(stops, n, i);
            s1 = rampScale(e1, stopAt(stops, n, i + 1));
        }
        u.row(first + n + ((i - 1) >> 1), e0, s0, e1, s1);
    }
};
/** `colors`: a non-empty array, else the default (1.10). */
export const colorsProp = (def) => ({
    default: def,
    resolve: (value) => value !== undefined && value.length > 0
        ? value.slice()
        : def.slice(),
});
/** `stops`: one per colour, else spread evenly (1.10). */
export const stopsProp = (def) => ({
    default: def,
    resolve(value, props) {
        const colors = props.colors;
        const len = colors.length;
        if (value !== undefined && value.length === len) {
            return value.slice();
        }
        const stops = [];
        if (len === 1) {
            stops.push(0);
            return stops;
        }
        for (let i = 0; i < len; i++) {
            stops.push(i * (1 / (len - 1)));
        }
        return stops;
    },
});
//# sourceMappingURL=gradient.js.map