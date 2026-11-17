import { growQuadGlsl, growUniformsGlsl } from '../borderGeometry.js';
import { edgeWidthDefine, rampScale, viewportGlsl } from '../utils.js';
import { ShadowTemplate, } from '../templates/ShadowTemplate.js';
export const Shadow = {
    props: ShadowTemplate.props,
    update(node) {
        const shadow = this.props.projection;
        const blur = shadow[2];
        const spread = shadow[3];
        const halfW = node.w * 0.5;
        const halfH = node.h * 0.5;
        this.uniformRGBA('u_color', this.props.color);
        // Copied, not uniform4fa: the collection is shared by reference, and the
        // x/y/blur/spread setters (animations included) write the prop array in
        // place.
        this.uniform4f('u_shadow', shadow[0], shadow[1], shadow[2], shadow[3]);
        this.uniform4f('u_boxSize', halfW, halfH, halfW + spread, halfH + spread);
        // Fade: smoothstep(-blur, blur + 0.001, dist) as a multiply-add
        const fade = rampScale(-blur, blur + 0.001);
        this.uniform2f('u_shadowRamp', fade, blur * fade);
        // Quad growth per side: the shadow box is the node grown by spread, its
        // fade runs blur past that, and the offset shifts it toward one side.
        // Never below 0 (the quad must still cover the node), and none at all
        // for a transparent shadow, which the fragment shader skips.
        const reach = spread + shadow[2];
        const sx = shadow[0];
        const sy = shadow[1];
        const visible = (this.props.color & 0xff) !== 0;
        this.uniform4f('u_grow', visible === true ? Math.max(0, reach - sx) : 0, visible === true ? Math.max(0, reach - sy) : 0, visible === true ? Math.max(0, reach + sx) : 0, visible === true ? Math.max(0, reach + sy) : 0);
    },
    vertex: (renderer) => `
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
    fragment(renderer) {
        return `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    ${edgeWidthDefine(renderer.stage.pixelRatio)}

    uniform float u_alpha;
    uniform sampler2D u_texture;

    uniform vec4 u_color;
    uniform vec4 u_shadow;
    // Half sizes -- xy: node, zw: shadow (node + spread)
    uniform vec4 u_boxSize;
    // Fade smoothstep's t = clamp(dist * x + y): scale and offset from update()
    uniform vec2 u_shadowRamp;

    varying vec4 v_color;
    varying vec2 v_textureCoords;

    varying vec2 v_boxUv;
    varying vec2 v_shadowBox;

    float box(vec2 p, vec2 s) {
      vec2 q = abs(p) - s;
      return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
    }

    float shadowBox(vec2 p, vec2 s, float r) {
      vec2 q = abs(p) - s + r;
      float dist = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      float t = clamp(dist * u_shadowRamp.x + u_shadowRamp.y, 0.0, 1.0);
      return 1.0 - t * t * (3.0 - 2.0 * t);
    }

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;

      float boxDist = box(v_boxUv, u_boxSize.xy);
      // AA centred on the node's true edge, like every other SDF shader
      float boxAlpha = clamp(0.5 - boxDist * INV_EDGE_WIDTH, 0.0, 1.0);

      // Uniform-driven gate: a fully transparent shadow contributes nothing,
      // so skip its SDF entirely rather than multiplying the result by zero.
      // The condition is the same for every fragment in the draw call.
      vec4 resColor = vec4(0.0);
      if (u_color.a >= 0.0001) {
        float shadowDist = shadowBox(v_shadowBox, u_boxSize.zw, max(0.0, u_shadow.w));
        resColor = u_color * shadowDist;
      }

      resColor = mix(resColor, color, min(color.a, boxAlpha));
      gl_FragColor = resColor * u_alpha;
    }
  `;
    },
};
//# sourceMappingURL=Shadow.js.map