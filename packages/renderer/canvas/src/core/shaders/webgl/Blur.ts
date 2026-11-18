import type { CoreNode } from '../../CoreNode.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { BlurTemplate, type BlurProps } from '../templates/BlurTemplate.js';

/**
 * Single-pass 3x3 Gaussian-approximation blur (1,2,1 / 2,4,2 / 1,2,1) / 16.
 *
 * 9 texture fetches, no second pass, no render target — designed for Image
 * Textures on constrained devices. Larger blurs trade smoothness for speed;
 * if a higher-quality blur is needed, stack multiple nodes or do a separable
 * pass.
 */
export const Blur: WebGlShaderType<BlurProps> = {
  props: BlurTemplate.props,
  update(node: CoreNode) {
    // Tap offset in texture space: a function of props + size only, so it is
    // uploaded once instead of divided out on every fragment.
    const amount = this.props!.amount;
    this.uniform2f('u_px', amount / node.w, amount / node.h);
  },
  fragment: `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    uniform sampler2D u_texture;
    // Blur amount in texture space: amount / node size
    uniform vec2 u_px;

    varying vec4 v_color;
    varying vec2 v_textureCoords;

    void main() {
      vec2 px = u_px;

      vec4 c = texture2D(u_texture, v_textureCoords) * 0.25;
      c += texture2D(u_texture, v_textureCoords + vec2( px.x, 0.0)) * 0.125;
      c += texture2D(u_texture, v_textureCoords + vec2(-px.x, 0.0)) * 0.125;
      c += texture2D(u_texture, v_textureCoords + vec2(0.0,  px.y)) * 0.125;
      c += texture2D(u_texture, v_textureCoords + vec2(0.0, -px.y)) * 0.125;
      c += texture2D(u_texture, v_textureCoords + vec2( px.x,  px.y)) * 0.0625;
      c += texture2D(u_texture, v_textureCoords + vec2(-px.x, -px.y)) * 0.0625;
      c += texture2D(u_texture, v_textureCoords + vec2( px.x, -px.y)) * 0.0625;
      c += texture2D(u_texture, v_textureCoords + vec2(-px.x,  px.y)) * 0.0625;

      gl_FragColor = c * v_color;
    }
  `,
};
