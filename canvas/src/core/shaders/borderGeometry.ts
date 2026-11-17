import type { Vec4 } from '../renderers/webgl/internal/ShaderUtils.js';

/**
 * Per-node border geometry shared by the WebGL and Canvas rounded-border
 * shaders. Every value is a function of the shader props and node w/h only,
 * so it is computed once per value key in `update()` (WebGL uploads it as
 * uniforms, Canvas keeps it in `computed`) instead of per vertex.
 *
 * Boxes use the WebGL SDF convention: coordinates are relative to the node
 * centre, and a box is centred at `node centre - uv`, so a fragment at
 * centre-relative position `p` samples `roundedBox(p + uv, half, radius)`.
 */
export interface BorderGeometry {
  /** Any border width is non-zero; false means render as plain Rounded */
  hasBorder: boolean;
  /** Border gap is non-zero; false lets the shader skip the node SDF */
  hasGap: boolean;
  /**
   * The outer box reaches the node edge on either axis. The shadow of
   * RoundedWithBorderAndShadow then hugs the outer box, otherwise the node.
   */
  shadowOnOuter: boolean;
  outerUvX: number;
  outerUvY: number;
  outerHalfW: number;
  outerHalfH: number;
  innerUvX: number;
  innerUvY: number;
  innerHalfW: number;
  innerHalfH: number;
  /** [tl, tr, br, bl] */
  outerRadius: Vec4;
  /** [tl, tr, br, bl] */
  innerRadius: Vec4;
  /**
   * How far the outer box reaches past each node edge, in px, clamped at 0:
   * the quad growth a border needs on that side. The outer box's anti-aliased
   * edge ends inside it, so no extra margin is needed.
   */
  growL: number;
  growT: number;
  growR: number;
  growB: number;
}

/**
 * Width remap the WebGL border shaders have always applied: >= 1 is kept,
 * (0, 1) shrinks toward 0, and 0 becomes -1 so a side without a border pulls
 * the outer box 1px inside the node edge (hiding its anti-aliased fringe).
 */
const adjustWidth = (w: number): number => w - 1 + Math.min(Math.max(w, -1), 1);

/**
 * Compute the outer/inner border boxes for a node.
 *
 * Allocates a fresh result (and fresh radius arrays): callers store it in a
 * value collection that is shared by reference and must never be mutated.
 * Only runs on a value-key miss, never per frame.
 *
 * @param radius - node corner radius, already factored to the node size
 * @param borderW - raw border widths [top, right, bottom, left]
 */
export const computeBorderGeometry = (
  w: number,
  h: number,
  radius: Vec4,
  borderW: Vec4,
  align: number,
  gap: number,
): BorderGeometry => {
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const hasBorder =
    Math.abs(borderW[0]) +
      Math.abs(borderW[1]) +
      Math.abs(borderW[2]) +
      Math.abs(borderW[3]) >=
    0.001;

  if (hasBorder === false) {
    return {
      hasBorder,
      hasGap: Math.abs(gap) >= 0.0001,
      shadowOnOuter: false,
      outerUvX: 0,
      outerUvY: 0,
      outerHalfW: halfW,
      outerHalfH: halfH,
      innerUvX: 0,
      innerUvY: 0,
      innerHalfW: halfW,
      innerHalfH: halfH,
      outerRadius: [radius[0], radius[1], radius[2], radius[3]],
      innerRadius: [radius[0], radius[1], radius[2], radius[3]],
      growL: 0,
      growT: 0,
      growR: 0,
      growB: 0,
    };
  }

  const t = adjustWidth(borderW[0]);
  const r = adjustWidth(borderW[1]);
  const b = adjustWidth(borderW[2]);
  const l = adjustWidth(borderW[3]);

  const sizeX = r + l;
  const sizeY = t + b;
  const extraX = sizeX * align;
  const extraY = sizeY * align;

  // A gap only opens on sides that carry a border
  const gapT = t >= 0.001 ? gap : 0;
  const gapR = r >= 0.001 ? gap : 0;
  const gapB = b >= 0.001 ? gap : 0;
  const gapL = l >= 0.001 ? gap : 0;

  const outerHalfW = (w + gapL + gapR + extraX) * 0.5;
  const outerHalfH = (h + gapT + gapB + extraY) * 0.5;

  const diffX = r - l;
  const diffY = b - t;
  const outerUvX = -diffX * align * 0.5 - (gapR - gapL) * 0.5;
  const outerUvY = -diffY * align * 0.5 - (gapB - gapT) * 0.5;

  const alignT = t * align;
  const alignR = r * align;
  const alignB = b * align;
  const alignL = l * align;
  const oTl = Math.max(0, radius[0] + Math.max(alignT, alignL) + gap);
  const oTr = Math.max(0, radius[1] + Math.max(alignT, alignR) + gap);
  const oBr = Math.max(0, radius[2] + Math.max(alignB, alignR) + gap);
  const oBl = Math.max(0, radius[3] + Math.max(alignB, alignL) + gap);

  const growsX = outerHalfW >= halfW;
  const growsY = outerHalfH >= halfH;

  return {
    hasBorder,
    hasGap: Math.abs(gap) >= 0.0001,
    shadowOnOuter: growsX === true || growsY === true,
    outerUvX,
    outerUvY,
    outerHalfW,
    outerHalfH,
    innerUvX: outerUvX + diffX * 0.5,
    innerUvY: outerUvY + diffY * 0.5,
    innerHalfW: outerHalfW - sizeX * 0.5,
    innerHalfH: outerHalfH - sizeY * 0.5,
    outerRadius: [oTl, oTr, oBr, oBl],
    innerRadius: [
      Math.max(0, oTl - Math.max(t, l)),
      Math.max(0, oTr - Math.max(t, r)),
      Math.max(0, oBr - Math.max(b, r)),
      Math.max(0, oBl - Math.max(b, l)),
    ],
    growL: Math.max(0, outerHalfW + outerUvX - halfW),
    growT: Math.max(0, outerHalfH + outerUvY - halfH),
    growR: Math.max(0, outerHalfW - outerUvX - halfW),
    growB: Math.max(0, outerHalfH - outerUvY - halfH),
  };
};

/**
 * Quad growth for one side with room for anti-aliasing: shaders centre the
 * AA ramp on the true box edge, so it reaches half a device pixel past a box
 * that extends past the node. `edgeWidth` is one device pixel in logical px.
 */
export const growWithAa = (grow: number, edgeWidth: number): number =>
  grow > 0 ? grow + edgeWidth : 0;

/**
 * Vertex-stage declarations for a shader whose quad grows past the node: the
 * two per-draw system uniforms it needs besides its own growth, written by
 * `WebGlShaderProgram.bindRenderOp`.
 */
export const growUniformsGlsl = `
    // The node's world transform without translation: xy is its local x axis
    // in world px, zw its local y axis
    uniform vec4 u_nodeTransform;
    // The quad's texture coords at node coords (0, 0) (xy) and (1, 1) (zw)
    uniform vec4 u_uvRect;`;

/**
 * Vertex `main()` body for a growing quad. `grow` is a vec4 expression: the
 * growth past each side (left, top, right, bottom) in the node's local px.
 * Writes gl_Position, v_boxUv (local px from the node centre) and
 * v_textureCoords; the caller writes the rest.
 *
 * The growth is a local offset: it reaches world space through
 * `u_nodeTransform`, so the SDF space stays 1:1 with the node under scale and
 * rotation, and the texture coords extend at the node's own UV rate
 * (`u_uvRect`), so crops, sub-textures and flips sample the texels an ungrown
 * quad would.
 */
export const growQuadGlsl = (grow: string): string => `
      // Legacy: offsets the box/texture coords by one clip-space unit
      // (~0.001px). Kept so output stays byte-identical.
      vec2 screenSpace = vec2(2.0 / RESOLUTION.x, -2.0 / RESOLUTION.y);
      vec2 edge = clamp(a_nodeCoords * 2.0 - vec2(1.0), -1.0, 1.0);
      // Left/top corners grow by ${grow}.xy, right/bottom by ${grow}.zw. The
      // box and texture coords shift by exactly what the corner does, so the
      // SDF space maps 1:1 and the output does not depend on the growth.
      vec2 edgeOffset = edge * mix(${grow}.zw, ${grow}.xy, step(edge, vec2(0.0)));

      gl_Position = pxToClip(
        a_position + u_nodeTransform.xy * edgeOffset.x + u_nodeTransform.zw * edgeOffset.y
      );

      v_boxUv = (a_nodeCoords - 0.5) * u_dimensions + screenSpace + edgeOffset;
      v_textureCoords = a_textureCoords +
        (screenSpace + edgeOffset) / u_dimensions * (u_uvRect.zw - u_uvRect.xy);`;
