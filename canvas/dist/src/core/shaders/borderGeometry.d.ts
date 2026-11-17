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
 * Compute the outer/inner border boxes for a node.
 *
 * Allocates a fresh result (and fresh radius arrays): callers store it in a
 * value collection that is shared by reference and must never be mutated.
 * Only runs on a value-key miss, never per frame.
 *
 * @param radius - node corner radius, already factored to the node size
 * @param borderW - raw border widths [top, right, bottom, left]
 */
export declare const computeBorderGeometry: (w: number, h: number, radius: Vec4, borderW: Vec4, align: number, gap: number) => BorderGeometry;
/**
 * Quad growth for one side with room for anti-aliasing: shaders centre the
 * AA ramp on the true box edge, so it reaches half a device pixel past a box
 * that extends past the node. `edgeWidth` is one device pixel in logical px.
 */
export declare const growWithAa: (grow: number, edgeWidth: number) => number;
/**
 * Vertex-stage declarations for a shader whose quad grows past the node: the
 * two per-draw system uniforms it needs besides its own growth, written by
 * `WebGlShaderProgram.bindRenderOp`.
 */
export declare const growUniformsGlsl = "\n    // The node's world transform without translation: xy is its local x axis\n    // in world px, zw its local y axis\n    uniform vec4 u_nodeTransform;\n    // The quad's texture coords at node coords (0, 0) (xy) and (1, 1) (zw)\n    uniform vec4 u_uvRect;";
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
export declare const growQuadGlsl: (grow: string) => string;
