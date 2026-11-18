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
export const LinearGradient: ShaderType<LinearGradientProps> = {
  props: {
    colors: colorsProp([0x000000ff, 0xffffffff]),
    stops: stopsProp([0, 1]),
    angle: 0,
  } as ShaderType<LinearGradientProps>['props'],
  variant: (props) => String(props.colors.length),
  // A colors write that changes the count switches the program.
  variantProps: ['colors'],
  vertex: (ctx, props) =>
    defaultVertex(
      ctx.viewport,
      paramsUniform(1 + gradientRows(props.colors.length)) +
        'varying float v_dist;',
      'v_dist=dot(a_textureCoords,u_params[0].xy)+u_params[0].z;',
    ),
  fragment: (_ctx, props) => {
    const n = props.colors.length;
    return (
      PRECISION +
      'uniform float u_alpha;uniform sampler2D u_texture;' +
      paramsUniform(1 + gradientRows(n)) +
      'varying vec4 v_color;varying vec2 v_textureCoords;varying float v_dist;\n' +
      'void main(){vec4 color=texture2D(u_texture,v_textureCoords)*v_color;' +
      'float dist=clamp(v_dist,0.0,1.0);' +
      gradientGlsl(n, 1, 'dist') +
      'gl_FragColor=mix(color,colorOut*u_alpha,clamp(colorOut.a,0.0,1.0));}'
    );
  },
  pack(props, w, h, u) {
    const angle = props.angle - (Math.PI / 180) * 90;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const lineDist = Math.abs(w * c) + Math.abs(h * s);
    // Gradient axis (from -> to) and origin.
    const gx = -lineDist * c;
    const gy = -lineDist * s;
    const gg = gx * gx + gy * gy;
    const invGG = gg > 0 ? 1 / gg : 0;
    const fx = lineDist * 0.5 * c + w * 0.5;
    const fy = lineDist * 0.5 * s + h * 0.5;
    u.row(0, w * gx * invGG, h * gy * invGG, -(fx * gx + fy * gy) * invGG, 0);
    packGradient(u, 1, props.colors, props.stops);
  },
};
