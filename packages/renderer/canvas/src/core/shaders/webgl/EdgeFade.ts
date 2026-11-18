import type { CoreNode } from '../../CoreNode.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { defaultVertex } from './Default.js';
import {
  EdgeFadeTemplate,
  type EdgeFadeProps,
} from '../templates/EdgeFadeTemplate.js';

/**
 * Largest value a fade ramp may reach at the far side of the node. The ramps
 * are varyings, binary16 on Mali-400 (max 65504); past that they overflow to
 * inf, and interpolating inf yields NaN.
 */
const MAX_RAMP = 60000;

/**
 * Reciprocal of one edge's fade width, or 0 for an edge without a fade (the
 * vertex shader then adds 1, keeping that ramp saturated). A fade too narrow
 * for `size * recip` to stay under MAX_RAMP is widened to the limit: that is
 * well under a pixel for any realistic node, e.g. while a fade animates in
 * from 0.
 */
const fadeRecip = (fade: number, size: number): number =>
  fade > 0 ? 1 / Math.max(fade, size / MAX_RAMP) : 0;

/**
 * Multiplies the node's alpha by a linear ramp inward from each edge with a
 * non-zero fade distance, revealing whatever is rendered behind the node.
 * Unlike {@link LinearGradient} this masks the texture's own alpha instead of
 * blending a gradient color over its RGB.
 */
export const EdgeFade: WebGlShaderType<EdgeFadeProps> = {
  props: EdgeFadeTemplate.props,
  update(node: CoreNode) {
    const props = this.props!;
    // Reciprocals are uploaded so the fragment shader needs no division and
    // no zero-guard branch (see fadeRecip).
    this.uniform4f(
      'u_fadeRecip',
      fadeRecip(props.left, node.w),
      fadeRecip(props.top, node.h),
      fadeRecip(props.right, node.w),
      fadeRecip(props.bottom, node.h),
    );
  },
  // Each edge's ramp (distance to the edge * 1 / fade) is linear across the
  // quad, so the vertex shader computes it and the fragment only clamps. An
  // edge without a fade has a reciprocal of 0; step() turns that into a
  // constant 1, so no ramp ever holds a sentinel too large for binary16.
  vertex: defaultVertex(
    `    uniform vec2 u_dimensions;
    uniform vec4 u_fadeRecip;
    varying vec4 v_fade;`,
    `      vec2 px = a_nodeCoords * u_dimensions;
      v_fade = vec4(px, u_dimensions - px) * u_fadeRecip + step(u_fadeRecip, vec4(0.0));`,
  ),
  fragment: `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    uniform sampler2D u_texture;

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    // Per-edge ramps: left, top, right, bottom
    varying vec4 v_fade;

    void main() {
      vec4 color = v_color * texture2D(u_texture, v_textureCoords);
      vec4 f = clamp(v_fade, 0.0, 1.0);
      gl_FragColor = color * (f.x * f.y * f.z * f.w);
    }
  `,
};
