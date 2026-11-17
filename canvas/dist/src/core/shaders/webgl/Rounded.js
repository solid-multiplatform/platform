import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { RoundedTemplate, } from '../templates/RoundedTemplate.js';
import { edgeWidthDefine } from '../utils.js';
import { defaultVertex } from './Default.js';
/**
 * Similar to the {@link DefaultShader} but cuts out 4 rounded rectangle corners
 * as defined by the specified corner {@link RoundedProps.radius}
 */
export const Rounded = {
    props: RoundedTemplate.props,
    update(node) {
        this.uniform4fa('u_radius', calcFactoredRadiusArray(this.props.radius, node.w, node.h));
        this.uniform2f('u_halfSize', node.w * 0.5, node.h * 0.5);
    },
    // Position relative to the node centre: linear across the quad, so it is
    // interpolated rather than rebuilt from node coords on every fragment.
    // a_nodeCoords is 0 or 1 at the corners, so this is exactly
    // (a_nodeCoords - 0.5) * size, built from the collection's u_halfSize rather
    // than the u_dimensions system uniform (a per-op compare and upload).
    vertex: defaultVertex(`    uniform vec2 u_halfSize;
    varying vec2 v_boxUv;`, `      v_boxUv = (a_nodeCoords * 2.0 - 1.0) * u_halfSize;`),
    fragment(renderer) {
        return `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    ${edgeWidthDefine(renderer.stage.pixelRatio)}

    uniform sampler2D u_texture;
    uniform vec4 u_radius;
    // Also declared by the vertex stage. A uniform shared by both stages must
    // have the same precision in each; both use the same precision guard.
    uniform vec2 u_halfSize;

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    varying vec2 v_boxUv;

    void main() {
      vec2 boxUv = v_boxUv;

      // Branchless radius selection based on quadrant
      // x: TL, y: TR, z: BR, w: BL
      vec2 stepVal = step(vec2(0.0), boxUv);
      float r = mix(
        mix(u_radius.x, u_radius.y, stepVal.x),
        mix(u_radius.w, u_radius.z, stepVal.x),
        stepVal.y
      );

      vec2 q = abs(boxUv) - u_halfSize + r;
      float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;

      float alpha = clamp(0.5 - d * INV_EDGE_WIDTH, 0.0, 1.0);

      // v_color is already premultiplied by the node's world alpha
      // (CoreNode premultipliedColor*), so alpha is applied once, like Default
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;
      gl_FragColor = color * alpha;
    }
  `;
    },
};
//# sourceMappingURL=Rounded.js.map