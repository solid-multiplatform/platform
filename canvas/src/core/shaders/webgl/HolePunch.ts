import { calcFactoredRadiusArray } from '../../lib/utils.js';
import {
  HolePunchTemplate,
  type HolePunchProps,
} from '../templates/HolePunchTemplate.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import type { WebGlRenderer } from '../../renderers/webgl/WebGlRenderer.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { edgeWidthDefine } from '../utils.js';
import { defaultVertex } from './Default.js';

export const HolePunch: WebGlShaderType<HolePunchProps> = {
  props: HolePunchTemplate.props,
  update() {
    const props = this.props!;
    this.uniform2f('u_pos', props.x, props.y);
    //precalculate to halfSize once instead of for every pixel
    this.uniform2f('u_size', props.w * 0.5, props.h * 0.5);

    this.uniform4fa(
      'u_radius',
      calcFactoredRadiusArray(props.radius as Vec4, props.w, props.h),
    );
  },
  // Position relative to the hole centre is linear across the quad
  vertex: defaultVertex(
    `    uniform vec2 u_dimensions;
    uniform vec2 u_pos;
    uniform vec2 u_size;
    varying vec2 v_hole;`,
    `      v_hole = (a_textureCoords * u_dimensions - u_pos) - u_size;`,
  ),
  getCacheMarkers(props: HolePunchProps) {
    return `radiusArray:${Array.isArray(props.radius)}`;
  },
  fragment(renderer: WebGlRenderer) {
    return `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    ${edgeWidthDefine(renderer.stage.pixelRatio)}

    uniform float u_alpha;
    uniform sampler2D u_texture;

    uniform vec2 u_size;

    uniform vec4 u_radius;

    uniform vec4 u_color;
    varying vec4 v_color;
    varying vec2 v_textureCoords;
    // Position relative to the hole centre
    varying vec2 v_hole;

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;
      vec2 p = v_hole;

      // Branchless radius selection based on quadrant
      // x: TL, y: TR, z: BR, w: BL
      vec2 stepVal = step(vec2(0.0), p);
      float r = mix(
        mix(u_radius.x, u_radius.y, stepVal.x),
        mix(u_radius.w, u_radius.z, stepVal.x),
        stepVal.y
      );

      p = abs(p) - u_size + r;
      float dist = min(max(p.x, p.y), 0.0) + length(max(p, 0.0)) - r + 2.0;
      // One device pixel of AA, like every other SDF shader (this used
      // u_pixelRatio, which is the reciprocal of the right width): a linear
      // ramp from dist 0 to EDGE_WIDTH, 50% at its middle as before
      float roundedAlpha = clamp(1.0 - dist * INV_EDGE_WIDTH, 0.0, 1.0);
      gl_FragColor = mix(color, vec4(0.0), min(color.a, roundedAlpha));
    }
  `;
  },
};
