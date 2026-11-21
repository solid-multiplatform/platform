import { factorRadius, toVec4, type Vec4 } from '../borderGeometry.js';
import { rampScale, rgbaRow } from '../glsl.js';
import type { AdvancedProp, UniformWriter } from '../ShaderType.js';

/**
 * Rows the stops of `n` colours take. LinearGradient, RadialGradient and
 * RadialProgress keep their stops in `u_params` from a row `first`: the
 * colours, then the stop ramps two to a row (stop i, from 1, in row
 * `first + n + (i - 1) / 2`, xy for odd i and zw for even).
 */
export const gradientRows = (n: number): number => n + (n >> 1);

/** `uniform vec4 u_params[rows];` */
export const paramsUniform = (rows: number): string =>
  `uniform vec4 u_params[${rows}];`;

/**
 * Branchless stop evaluation (1.10 genGradientColors): evaluates the stops
 * at `x` (a float expression in [0, 1]), leaving the colour in
 * `vec4 colorOut`. Segment i is
 * `smoothstep(stop[i - 1], stop[i], dist)` with its reciprocal span
 * precomputed, evaluated as `(dist - edge) * scale` (exact near the stop on
 * binary16, where a multiply-add is not).
 */
export const gradientGlsl = (n: number, first: number, x: string): string => {
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
const stopAt = (stops: number[], n: number, i: number): number =>
  stops.length === n ? stops[i]! : i * (1 / (n - 1));

/** Write the colours and stop ramps from row `first`. */
export const packGradient = (
  u: UniformWriter,
  first: number,
  colors: number[],
  stops: number[],
): void => {
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    rgbaRow(u, first + i, colors[i]!);
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

/**
 * `radius`: the node's corner radii, in node pixels (a number or up to four).
 * A gradient draws the node's quad itself, so the corner mask the rounded
 * shaders apply has to be applied here too — otherwise a gradient node's
 * `borderRadius` is silently ignored.
 */
export const radiusProp = (def: Vec4 = [0, 0, 0, 0]): AdvancedProp<unknown> => ({
  default: def,
  resolve: (value) =>
    value === undefined ? def.slice() : toVec4(value),
});

/**
 * The fragment source of the rounded mask: rows `sizeRow` (half the node
 * size in xy) and `radiusRow` (the four radii, already factored). `p` is the
 * pixel position from the centre, from a 0..1 varying. Alpha is the same
 * half-pixel edge the rounded shaders use.
 */
export const roundedMaskGlsl = (
  sizeRow: number,
  radiusRow: number,
  halfSize = `u_params[${sizeRow}].xy`,
): string =>
  `vec2 p=(v_textureCoords*2.0-1.0)*${halfSize};` +
  `vec4 r=u_params[${radiusRow}];` +
  'vec2 s=step(vec2(0.0),p);' +
  'float rad=mix(mix(r.x,r.y,s.x),mix(r.w,r.z,s.x),s.y);' +
  `vec2 q=abs(p)-${halfSize}+rad;` +
  'float d=(min(max(q.x,q.y),0.0)+length(max(q,0.0)))-rad;' +
  'gl_FragColor*=clamp(0.5-d*INV_EDGE_WIDTH,0.0,1.0);';

/** Write `sizeRow` (half size) and `radiusRow` (factored radii) for a mask. */
export const packRoundedMask = (
  u: UniformWriter,
  sizeRow: number,
  radiusRow: number,
  radius: unknown,
  w: number,
  h: number,
): void => {
  u.row(sizeRow, w * 0.5, h * 0.5, 0, 0);
  const r = factorRadius(toVec4(radius), w, h);
  u.row(radiusRow, r[0], r[1], r[2], r[3]);
};

/** `colors`: a non-empty array, else the default (1.10). */
export const colorsProp = (def: number[]): AdvancedProp<unknown> => ({
  default: def,
  resolve: (value) =>
    value !== undefined && (value as number[]).length > 0
      ? (value as number[]).slice()
      : def.slice(),
});

/** `stops`: one per colour, else spread evenly (1.10). */
export const stopsProp = (def: number[]): AdvancedProp<unknown> => ({
  default: def,
  resolve(value, props) {
    const colors = props.colors as number[];
    const len = colors.length;
    if (value !== undefined && (value as number[]).length === len) {
      return (value as number[]).slice();
    }
    const stops: number[] = [];
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
