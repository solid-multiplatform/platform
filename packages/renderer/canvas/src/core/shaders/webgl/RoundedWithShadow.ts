import type { CoreNode } from '../../CoreNode.js';
import { calcFactoredRadiusArray } from '../../lib/utils.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import type { WebGlRenderer } from '../../renderers/webgl/WebGlRenderer.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import { growQuadGlsl, growUniformsGlsl } from '../borderGeometry.js';
import { edgeWidthDefine, rampScale, viewportGlsl } from '../utils.js';
import {
  RoundedWithShadowTemplate,
  type RoundedWithShadowProps,
} from '../templates/RoundedWithShadowTemplate.js';

export const RoundedWithShadow: WebGlShaderType<RoundedWithShadowProps> = {
  props: RoundedWithShadowTemplate.props,
  update(node: CoreNode) {
    const shadow = this.props!['shadow-projection']!;
    const radius = calcFactoredRadiusArray(
      this.props!.radius as Vec4,
      node.w,
      node.h,
    );
    const blur = shadow[2];
    const spread = shadow[3];
    const halfW = node.w * 0.5;
    const halfH = node.h * 0.5;
    this.uniformRGBA('u_shadow_color', this.props!['shadow-color']!);
    // Copied, not uniform4fa: the collection is shared by reference, and the
    // shadow-x/y/blur/spread setters (animations included) write the prop
    // array in place.
    this.uniform4f('u_shadow', shadow[0], shadow[1], shadow[2], shadow[3]);
    this.uniform4fa('u_radius', radius);
    this.uniform4f('u_boxSize', halfW, halfH, halfW + spread, halfH + spread);
    // Fade: smoothstep(-blur, blur + 0.001, dist) as a multiply-add
    const fade = rampScale(-blur, blur + 0.001);
    this.uniform2f('u_shadowRamp', fade, blur * fade);
    this.uniform4f(
      'u_shadowRadius',
      Math.max(0, radius[0] + spread),
      Math.max(0, radius[1] + spread),
      Math.max(0, radius[2] + spread),
      Math.max(0, radius[3] + spread),
    );
    // Quad growth per side: the shadow box is the node grown by spread, its
    // fade runs blur past that, and the offset shifts it toward one side.
    // Never below 0 (the quad must still cover the node), and none at all
    // for a transparent shadow, which the fragment shader skips.
    const reach = spread + shadow[2];
    const sx = shadow[0];
    const sy = shadow[1];
    const visible = (this.props!['shadow-color']! & 0xff) !== 0;
    this.uniform4f(
      'u_grow',
      visible === true ? Math.max(0, reach - sx) : 0,
      visible === true ? Math.max(0, reach - sy) : 0,
      visible === true ? Math.max(0, reach + sx) : 0,
      visible === true ? Math.max(0, reach + sy) : 0,
    );
  },
  vertex: (renderer: WebGlRenderer) => `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    attribute vec2 a_position;
    attribute vec2 a_textureCoords;
    attribute vec4 a_color;
    attribute vec2 a_nodeCoords;

    ${viewportGlsl(renderer)}
    uniform vec2 u_dimensions;
    ${growUniformsGlsl}

    uniform vec4 u_shadow;
    // Quad growth past the node per side: left, top, right, bottom
    uniform vec4 u_grow;

    varying vec4 v_color;
    varying vec2 v_textureCoords;

    varying vec2 v_boxUv;
    varying vec2 v_shadowBox;

    void main() {
${growQuadGlsl('u_grow')}

      v_color = a_color;
      v_shadowBox = v_boxUv - u_shadow.xy;
    }
  `,
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

    uniform vec4 u_shadow_color;
    uniform vec4 u_radius;
    uniform vec4 u_shadowRadius;
    // Half sizes -- xy: node, zw: shadow (node + spread)
    uniform vec4 u_boxSize;
    // Fade smoothstep's t = clamp(dist * x + y): scale and offset from update()
    uniform vec2 u_shadowRamp;

    varying vec4 v_color;
    varying vec2 v_textureCoords;

    varying vec2 v_boxUv;
    varying vec2 v_shadowBox;

    // Branchless quadrant radius select (r: x TL, y TR, z BR, w BL) --
    // Mali 400-class fragment pipelines serialize any branch, ternaries included.
    float quadRadius(vec2 p, vec4 r) {
      vec2 stepVal = step(vec2(0.0), p);
      return mix(mix(r.x, r.y, stepVal.x), mix(r.w, r.z, stepVal.x), stepVal.y);
    }

    float roundedBox(vec2 p, vec2 s, vec4 r) {
      float rad = quadRadius(p, r);
      vec2 q = abs(p) - s + rad;
      return (min(max(q.x, q.y), 0.0) + length(max(q, 0.0))) - rad;
    }

    float shadowBox(vec2 p, vec2 s, vec4 r) {
      float rad = quadRadius(p, r);
      vec2 q = abs(p) - s + rad;
      float dist = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
      float t = clamp(dist * u_shadowRamp.x + u_shadowRamp.y, 0.0, 1.0);
      return 1.0 - t * t * (3.0 - 2.0 * t);
    }

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;

      float boxDist = roundedBox(v_boxUv, u_boxSize.xy, u_radius);
      float roundedAlpha = clamp(0.5 - boxDist * INV_EDGE_WIDTH, 0.0, 1.0);

      // Uniform-driven gate: a fully transparent shadow contributes nothing,
      // so skip its SDF entirely rather than multiplying the result by zero.
      // The condition is the same for every fragment in the draw call.
      vec4 resColor = vec4(0.0);
      if (u_shadow_color.a >= 0.0001) {
        float shadowAlpha = shadowBox(v_shadowBox, u_boxSize.zw, u_shadowRadius);
        resColor = u_shadow_color * shadowAlpha;
      }

      resColor = mix(resColor, color, min(color.a, roundedAlpha));
      gl_FragColor = resColor * u_alpha;
    }
  `;
  },
};
