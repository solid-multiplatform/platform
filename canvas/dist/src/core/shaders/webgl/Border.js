import { BorderTemplate, } from '../templates/BorderTemplate.js';
import { computeBorderGeometry, growQuadGlsl, growUniformsGlsl, growWithAa, } from '../borderGeometry.js';
import { edgeWidthDefine, paramsGlsl, paramsLength, setParam, setParamRgba, viewportGlsl, } from '../utils.js';
// The square Border has no corner radius; never mutated.
const NO_RADIUS = [0, 0, 0, 0];
/**
 * Rows of the packed `uniform vec4 u_params[5]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export const BorderParams = {
    U_BORDER_COLOR: 0,
    // xy: half node size, z: 1 with a border, w: 1 with a gap
    U_NODE: 1,
    // Quad growth past the node per side: left, top, right, bottom
    U_GROW: 2,
    // xy: SDF offset (box centre = node centre - xy), zw: half size
    U_OUTER_BOX: 3,
    U_INNER_BOX: 4,
};
const P = BorderParams;
const PARAMS_LENGTH = paramsLength(P);
export const Border = {
    props: BorderTemplate.props,
    update(node) {
        const props = this.props;
        // One device pixel (AA margin); pixel ratio is fixed at construction
        const ew = 1 / this.stage.pixelRatio;
        const g = computeBorderGeometry(node.w, node.h, NO_RADIUS, props.w, props.align, props.gap);
        // A fresh array per value-key miss: the collection holding it is shared
        // by reference and never written again.
        const params = new Float32Array(PARAMS_LENGTH);
        setParamRgba(params, P.U_BORDER_COLOR, props.color);
        setParam(params, P.U_NODE, node.w * 0.5, node.h * 0.5, g.hasBorder === true ? 1 : 0, g.hasGap === true ? 1 : 0);
        setParam(params, P.U_GROW, growWithAa(g.growL, ew), growWithAa(g.growT, ew), growWithAa(g.growR, ew), growWithAa(g.growB, ew));
        setParam(params, P.U_OUTER_BOX, g.outerUvX, g.outerUvY, g.outerHalfW, g.outerHalfH);
        setParam(params, P.U_INNER_BOX, g.innerUvX, g.innerUvY, g.innerHalfW, g.innerHalfH);
        this.uniform4fv('u_params', params);
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
    ${paramsGlsl(P)}

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    varying vec2 v_boxUv;

    void main() {
${growQuadGlsl('U_GROW')}

      v_color = a_color;
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
    ${paramsGlsl(P)}

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    varying vec2 v_boxUv;

    float box(vec2 p, vec2 s) {
      vec2 q = abs(p) - s;
      return (min(max(q.x, q.y), 0.0) + length(max(q, 0.0)));
    }

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;

      // Degenerate case: no border. Uniform-driven, so the whole draw call
      // takes it together, and it skips both border SDFs -- e.g. a focus
      // border before it has grown from zero.
      if (U_NODE.z < 0.5) {
        float nodeDist = box(v_boxUv, U_NODE.xy);
        float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);
        gl_FragColor = (color * nodeAlpha) * u_alpha;
        return;
      }

      float outerDist = box(v_boxUv + U_OUTER_BOX.xy, U_OUTER_BOX.zw);
      float innerDist = box(v_boxUv + U_INNER_BOX.xy, U_INNER_BOX.zw);

      // Degenerate case: no gap and an opaque border. Uniform-driven, so the
      // whole draw call takes it together and the node SDF never runs. The
      // border band drops the content here, which only an opaque border hides;
      // a translucent one takes the path below, which composites it over the
      // content. The edge alphas live in here because the path below
      // composites from the raw distances instead.
      if (U_NODE.w < 0.5 && U_BORDER_COLOR.a >= 0.9999) {
        float outerAlpha = clamp(0.5 - outerDist * INV_EDGE_WIDTH, 0.0, 1.0);
        float innerAlpha = clamp(0.5 - innerDist * INV_EDGE_WIDTH, 0.0, 1.0);
        vec4 resNoGap = mix(vec4(0.0), U_BORDER_COLOR, outerAlpha * U_BORDER_COLOR.a);
        resNoGap = mix(resNoGap, color, innerAlpha);
        gl_FragColor = resNoGap * u_alpha;
        return;
      }

      float nodeDist = box(v_boxUv, U_NODE.xy);
      float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);

      float borderDist = max(-innerDist, outerDist);
      float borderAlpha = clamp(0.5 - borderDist * INV_EDGE_WIDTH, 0.0, 1.0);

      vec4 resGap = mix(vec4(0.0), color, nodeAlpha);
      resGap = mix(resGap, U_BORDER_COLOR, borderAlpha * U_BORDER_COLOR.a);
      gl_FragColor = resGap * u_alpha;
    }
  `;
    },
};
//# sourceMappingURL=Border.js.map