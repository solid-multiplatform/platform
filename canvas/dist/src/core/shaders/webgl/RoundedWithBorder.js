import { calcFactoredRadiusArray } from '../../lib/utils.js';
import { computeBorderGeometry, growQuadGlsl, growUniformsGlsl, growWithAa, } from '../borderGeometry.js';
import { edgeWidthDefine, paramsGlsl, paramsLength, setParam, setParamRgba, setParamVec4, viewportGlsl, } from '../utils.js';
import { RoundedWithBorderTemplate, } from '../templates/RoundedWithBorderTemplate.js';
/**
 * Rows of the packed `uniform vec4 u_params[9]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export const RoundedWithBorderParams = {
    U_BORDER_COLOR: 0,
    U_FILL_COLOR: 1,
    U_RADIUS: 2,
    // xy: half node size, z: 1 with a border, w: 1 with a gap
    U_NODE: 3,
    // Quad growth past the node per side: left, top, right, bottom
    U_GROW: 4,
    // xy: SDF offset (box centre = node centre - xy), zw: half size
    U_OUTER_BOX: 5,
    U_INNER_BOX: 6,
    U_OUTER_RADIUS: 7,
    U_INNER_RADIUS: 8,
};
const P = RoundedWithBorderParams;
const PARAMS_LENGTH = paramsLength(P);
export const RoundedWithBorder = {
    props: RoundedWithBorderTemplate.props,
    update(node) {
        const props = this.props;
        // One device pixel (AA margin); pixel ratio is fixed at construction
        const ew = 1 / this.stage.pixelRatio;
        const radius = calcFactoredRadiusArray(props.radius, node.w, node.h);
        const g = computeBorderGeometry(node.w, node.h, radius, props['border-w'], props['border-align'], props['border-gap']);
        // A fresh array per value-key miss: the collection holding it is shared
        // by reference and never written again.
        const params = new Float32Array(PARAMS_LENGTH);
        setParamRgba(params, P.U_BORDER_COLOR, props['border-color']);
        setParamRgba(params, P.U_FILL_COLOR, props['border-fill']);
        setParamVec4(params, P.U_RADIUS, radius);
        setParam(params, P.U_NODE, node.w * 0.5, node.h * 0.5, g.hasBorder === true ? 1 : 0, g.hasGap === true ? 1 : 0);
        setParam(params, P.U_GROW, growWithAa(g.growL, ew), growWithAa(g.growT, ew), growWithAa(g.growR, ew), growWithAa(g.growB, ew));
        setParam(params, P.U_OUTER_BOX, g.outerUvX, g.outerUvY, g.outerHalfW, g.outerHalfH);
        setParam(params, P.U_INNER_BOX, g.innerUvX, g.innerUvY, g.innerHalfW, g.innerHalfH);
        setParamVec4(params, P.U_OUTER_RADIUS, g.outerRadius);
        setParamVec4(params, P.U_INNER_RADIUS, g.innerRadius);
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

    // Branchless quadrant radius select (r: x TL, y TR, z BR, w BL). This one
    // is driven by the fragment's own position, so it genuinely diverges per
    // fragment -- it must stay arithmetic, ternaries included.
    float quadRadius(vec2 p, vec4 r) {
      vec2 stepVal = step(vec2(0.0), p);
      return mix(mix(r.x, r.y, stepVal.x), mix(r.w, r.z, stepVal.x), stepVal.y);
    }

    float roundedBox(vec2 p, vec2 s, vec4 r) {
      float rad = quadRadius(p, r);
      vec2 q = abs(p) - s + rad;
      return (min(max(q.x, q.y), 0.0) + length(max(q, 0.0))) - rad;
    }

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;

      // Degenerate case: no border. Every fragment in the draw call takes this
      // path -- the condition is uniform-driven, so there is no divergence to
      // serialize, and skipping the two border SDFs saves two length()/sqrt
      // evaluations per fragment on what is the most common quad in a TV rail.
      if (U_NODE.z < 0.5) {
        float nodeDist = roundedBox(v_boxUv, U_NODE.xy, U_RADIUS);
        float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);
        gl_FragColor = (color * nodeAlpha) * u_alpha;
        return;
      }

      float outerDist = roundedBox(v_boxUv + U_OUTER_BOX.xy, U_OUTER_BOX.zw, U_OUTER_RADIUS);
      float innerDist = roundedBox(v_boxUv + U_INNER_BOX.xy, U_INNER_BOX.zw, U_INNER_RADIUS);
      float innerAlpha = clamp(0.5 - innerDist * INV_EDGE_WIDTH, 0.0, 1.0);

      // Second uniform-driven degenerate case: an opaque border with no gap
      // composites straight from the outer and inner SDFs and never needs the
      // node SDF. The border band drops the content here, which only an opaque
      // border hides; a translucent one takes the path below, which composites
      // it over the content. outerAlpha lives in here because only this path
      // uses it.
      if (U_NODE.w < 0.5 && U_BORDER_COLOR.a >= 0.9999) {
        float outerAlpha = clamp(0.5 - outerDist * INV_EDGE_WIDTH, 0.0, 1.0);
        vec4 resNoGap = mix(vec4(0.0), U_BORDER_COLOR, outerAlpha * U_BORDER_COLOR.a);
        resNoGap = mix(resNoGap, color, innerAlpha);
        gl_FragColor = resNoGap * u_alpha;
        return;
      }

      float nodeDist = roundedBox(v_boxUv, U_NODE.xy, U_RADIUS);
      float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);

      float gapAlpha = max(0.0, innerAlpha - nodeAlpha);
      float borderDist = max(-innerDist, outerDist);
      float borderAlpha = clamp(0.5 - borderDist * INV_EDGE_WIDTH, 0.0, 1.0);

      vec4 resGap = (color * nodeAlpha) + (U_FILL_COLOR * gapAlpha);
      resGap = mix(resGap, U_BORDER_COLOR, borderAlpha * U_BORDER_COLOR.a);
      gl_FragColor = resGap * u_alpha;
    }
  `;
    },
};
//# sourceMappingURL=RoundedWithBorder.js.map