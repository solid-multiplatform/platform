import type { CoreNode } from '../../CoreNode.js';
import { calcFactoredRadiusArray } from '../../lib/utils.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import type { WebGlRenderer } from '../../renderers/webgl/WebGlRenderer.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import {
  computeBorderGeometry,
  growQuadGlsl,
  growUniformsGlsl,
  growWithAa,
} from '../borderGeometry.js';
import {
  edgeWidthDefine,
  paramsGlsl,
  paramsLength,
  rampScale,
  setParam,
  setParamRgba,
  setParamVec4,
  viewportGlsl,
} from '../utils.js';
import {
  RoundedWithBorderAndShadowTemplate,
  type RoundedWithBorderAndShadowProps,
} from '../templates/RoundedWithBorderAndShadowTemplate.js';

/**
 * Rows of the packed `uniform vec4 u_params[12]`, which both stages read
 * through `#define NAME u_params[row]`. Uploaded with one uniform4fv.
 */
export const RoundedWithBorderAndShadowParams = {
  U_BORDER_COLOR: 0,
  U_SHADOW_COLOR: 1,
  // Shadow fade: smoothstep's t = clamp(dist * x + y), zw unused
  U_SHADOW_RAMP: 2,
  U_RADIUS: 3,
  // xy: half node size, z: 1 with a border, w: 1 with a gap
  U_NODE: 4,
  // xy: SDF offset (box centre = node centre - xy), zw: half size
  U_OUTER_BOX: 5,
  U_INNER_BOX: 6,
  U_OUTER_RADIUS: 7,
  U_INNER_RADIUS: 8,
  U_SHADOW_BOX: 9,
  U_SHADOW_RADIUS: 10,
  // Quad growth past the node per side: left, top, right, bottom
  U_GROW: 11,
} as const;

const P = RoundedWithBorderAndShadowParams;
const PARAMS_LENGTH = paramsLength(P);

export const RoundedWithBorderAndShadow: WebGlShaderType<RoundedWithBorderAndShadowProps> =
  {
    props: RoundedWithBorderAndShadowTemplate.props,
    update(node: CoreNode) {
      const props = this.props!;
      // One device pixel (AA margin); pixel ratio is fixed at construction
      const ew = 1 / this.stage.pixelRatio;
      const radius = calcFactoredRadiusArray(
        props.radius as Vec4,
        node.w,
        node.h,
      );
      const g = computeBorderGeometry(
        node.w,
        node.h,
        radius,
        props['border-w'] as Vec4,
        props['border-align'] as number,
        props['border-gap'] as number,
      );
      const shadow = props['shadow-projection'];

      // A fresh array per value-key miss: the collection holding it is shared
      // by reference and never written again. Rows hold copied values, never
      // a prop's own array: the shadow-x/y/blur/spread setters write the
      // projection array in place, and must not reach a collection other
      // nodes are drawing with.
      const params = new Float32Array(PARAMS_LENGTH);
      setParamRgba(params, P.U_BORDER_COLOR, props['border-color']);
      setParamRgba(params, P.U_SHADOW_COLOR, props['shadow-color']);
      setParamVec4(params, P.U_RADIUS, radius);
      setParam(
        params,
        P.U_NODE,
        node.w * 0.5,
        node.h * 0.5,
        g.hasBorder === true ? 1 : 0,
        g.hasGap === true ? 1 : 0,
      );
      setParam(
        params,
        P.U_OUTER_BOX,
        g.outerUvX,
        g.outerUvY,
        g.outerHalfW,
        g.outerHalfH,
      );
      setParam(
        params,
        P.U_INNER_BOX,
        g.innerUvX,
        g.innerUvY,
        g.innerHalfW,
        g.innerHalfH,
      );
      setParamVec4(params, P.U_OUTER_RADIUS, g.outerRadius);
      setParamVec4(params, P.U_INNER_RADIUS, g.innerRadius);

      // The shadow hugs the outer border box when the border grows the quad
      // past the node on either axis, otherwise the node box.
      const outer = g.shadowOnOuter;
      const blur = shadow[2];
      const spread = shadow[3];
      const shadowRadius = outer === true ? g.outerRadius : radius;
      setParam(
        params,
        P.U_SHADOW_BOX,
        (outer === true ? g.outerUvX : 0) - shadow[0],
        (outer === true ? g.outerUvY : 0) - shadow[1],
        (outer === true ? g.outerHalfW : node.w * 0.5) + spread,
        (outer === true ? g.outerHalfH : node.h * 0.5) + spread,
      );
      setParam(
        params,
        P.U_SHADOW_RADIUS,
        shadowRadius[0] + blur,
        shadowRadius[1] + blur,
        shadowRadius[2] + blur,
        shadowRadius[3] + blur,
      );
      // Fade: smoothstep(-spread, spread + blur, dist) as a multiply-add
      const fade = rampScale(-spread, spread + blur);
      setParam(params, P.U_SHADOW_RAMP, fade, spread * fade, 0, 0);

      // Quad growth per side: enough for the border's outer box (never below
      // 0). A transparent shadow (alpha byte 0, e.g. the idle state of a
      // shadow that animates in on focus) adds none: the fragment shader
      // skips it, and its U_SHADOW_COLOR.a gate agrees with this test.
      const borderL = growWithAa(g.growL, ew);
      const borderT = growWithAa(g.growT, ew);
      const borderR = growWithAa(g.growR, ew);
      const borderB = growWithAa(g.growB, ew);
      if ((props['shadow-color'] & 0xff) === 0) {
        setParam(params, P.U_GROW, borderL, borderT, borderR, borderB);
        this.uniform4fv('u_params', params);
        return;
      }

      // A visible shadow reaches 2 * spread + blur past its base box (node or
      // outer box), shifted by the shadow offset. Never below 0, so a large
      // offset cannot pull the quad inside the node.
      const halfW = node.w * 0.5;
      const halfH = node.h * 0.5;
      const reach = spread * 2 + blur;
      const sx = shadow[0];
      const sy = shadow[1];
      const baseL = outer === true ? g.outerHalfW + g.outerUvX - halfW : 0;
      const baseT = outer === true ? g.outerHalfH + g.outerUvY - halfH : 0;
      const baseR = outer === true ? g.outerHalfW - g.outerUvX - halfW : 0;
      const baseB = outer === true ? g.outerHalfH - g.outerUvY - halfH : 0;
      setParam(
        params,
        P.U_GROW,
        Math.max(0, borderL, baseL + reach - sx),
        Math.max(0, borderT, baseT + reach - sy),
        Math.max(0, borderR, baseR + reach + sx),
        Math.max(0, borderB, baseB + reach + sy),
      );
      this.uniform4fv('u_params', params);
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
    ${paramsGlsl(P)}

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    varying vec2 v_boxUv;

    void main() {
${growQuadGlsl('U_GROW')}

      v_color = a_color;
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
    ${paramsGlsl(P)}

    varying vec4 v_color;
    varying vec2 v_textureCoords;
    varying vec2 v_boxUv;

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
      float t = clamp(dist * U_SHADOW_RAMP.x + U_SHADOW_RAMP.y, 0.0, 1.0);
      return 1.0 - t * t * (3.0 - 2.0 * t);
    }

    void main() {
      vec4 color = texture2D(u_texture, v_textureCoords) * v_color;

      // Uniform-driven gate: a fully transparent shadow contributes nothing,
      // so skip its SDF entirely rather than multiplying the result by zero.
      // The condition is the same for every fragment in the draw call.
      vec4 shadowBase = vec4(0.0);
      if (U_SHADOW_COLOR.a >= 0.0001) {
        // Shadow geometry (node box or outer border box) is selected on the CPU.
        float shadowAlpha = shadowBox(v_boxUv + U_SHADOW_BOX.xy, U_SHADOW_BOX.zw, U_SHADOW_RADIUS);
        shadowBase = U_SHADOW_COLOR * shadowAlpha;
      }

      // Degenerate case: no border. Uniform-driven, so the whole draw call
      // takes it together -- no divergence to serialize -- and it drops the
      // two border SDFs, halving the length()/sqrt count per fragment.
      if (U_NODE.z < 0.5) {
        float nodeDist = roundedBox(v_boxUv, U_NODE.xy, U_RADIUS);
        float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);
        gl_FragColor = mix(shadowBase, color, nodeAlpha) * u_alpha;
        return;
      }

      float outerDist = roundedBox(v_boxUv + U_OUTER_BOX.xy, U_OUTER_BOX.zw, U_OUTER_RADIUS);
      float innerDist = roundedBox(v_boxUv + U_INNER_BOX.xy, U_INNER_BOX.zw, U_INNER_RADIUS);

      // Second uniform-driven degenerate case: an opaque border with no gap
      // never needs the node SDF. The border band drops the content here,
      // which only an opaque border hides; a translucent one takes the path
      // below, which composites it over the content. The edge alphas live in
      // here because the path below composites from the raw distances instead.
      if (U_NODE.w < 0.5 && U_BORDER_COLOR.a >= 0.9999) {
        float outerAlpha = clamp(0.5 - outerDist * INV_EDGE_WIDTH, 0.0, 1.0);
        float innerAlpha = clamp(0.5 - innerDist * INV_EDGE_WIDTH, 0.0, 1.0);
        vec4 resNoGap = mix(shadowBase, U_BORDER_COLOR, outerAlpha * U_BORDER_COLOR.a);
        resNoGap = mix(resNoGap, color, innerAlpha);
        gl_FragColor = resNoGap * u_alpha;
        return;
      }

      float nodeDist = roundedBox(v_boxUv, U_NODE.xy, U_RADIUS);
      float nodeAlpha = clamp(0.5 - nodeDist * INV_EDGE_WIDTH, 0.0, 1.0);

      float borderDist = max(-innerDist, outerDist);
      float borderAlpha = clamp(0.5 - borderDist * INV_EDGE_WIDTH, 0.0, 1.0);

      vec4 resFill = mix(shadowBase, color, nodeAlpha);
      vec4 resGap = mix(resFill, U_BORDER_COLOR, borderAlpha * U_BORDER_COLOR.a);
      gl_FragColor = resGap * u_alpha;
    }
  `;
    },
  };
