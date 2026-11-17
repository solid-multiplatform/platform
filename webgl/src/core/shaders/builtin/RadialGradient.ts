import { PRECISION, defaultVertex } from '../glsl.js';
import type { ShaderType } from '../ShaderType.js';
import {
  colorsProp,
  gradientGlsl,
  gradientRows,
  packGradient,
  paramsUniform,
  stopsProp,
} from './gradient.js';

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
export const RadialGradient: ShaderType<RadialGradientProps> = {
  props: {
    colors: colorsProp([0x000000ff, 0xffffffff]),
    stops: stopsProp([0, 1]),
    w: 50,
    h: 50,
    // Copied, as the other array props are: a pivot changed in place and
    // written back is a new value, and repacks (1.10).
    pivot: {
      default: [0.5, 0.5],
      resolve: (value: unknown) =>
        value === undefined
          ? [0.5, 0.5]
          : [(value as number[])[0], (value as number[])[1]],
    },
  } as ShaderType<RadialGradientProps>['props'],
  variant: (props) => String(props.colors.length),
  // A colors write that changes the count switches the program.
  variantProps: ['colors'],
  vertex: (ctx, props) =>
    defaultVertex(
      ctx.viewport,
      paramsUniform(2 + gradientRows(props.colors.length)) +
        'varying vec2 v_gradient;',
      'v_gradient=(a_nodeCoords*u_params[0].xy-u_params[0].zw)/u_params[1].xy;',
    ),
  fragment: (_ctx, props) => {
    const n = props.colors.length;
    return (
      PRECISION +
      'uniform float u_alpha;uniform sampler2D u_texture;' +
      paramsUniform(2 + gradientRows(n)) +
      'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_gradient;\n' +
      'void main(){vec4 color=texture2D(u_texture,v_textureCoords)*v_color;' +
      'float dist=clamp(length(v_gradient),0.0,1.0);' +
      gradientGlsl(n, 2, 'dist') +
      'gl_FragColor=mix(color,colorOut*u_alpha,clamp(colorOut.a,0.0,1.0));}'
    );
  },
  pack(props, w, h, u) {
    u.row(0, w, h, props.pivot[0] * w, props.pivot[1] * h);
    u.row(1, props.w, props.h, 0, 0);
    packGradient(u, 2, props.colors, props.stops);
  },
};
