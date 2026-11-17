/** Four values: [top-left, top-right, bottom-right, bottom-left] or [top, right, bottom, left]. */
export type Vec4 = [number, number, number, number];
/** A number, or an array of 1 to 4 numbers, as four (1.10 validateArrayLength4, copied). */
export declare const toVec4: (value: unknown) => Vec4;
/**
 * Corner radii scaled down so that adjacent corners never overlap on a
 * `w` x `h` node (1.10 calcFactoredRadiusArray); a new array.
 */
export declare function factorRadius(radius: Vec4, w: number, h: number): Vec4;
/**
 * The border boxes of the Border, RoundedWithBorder and
 * RoundedWithBorderAndShadow shaders (1.10 computeBorderGeometry, ported):
 * functions of the props and the node size only, computed in `pack`. Boxes
 * follow the shaders' SDF convention: coordinates relative to the node
 * centre, a box centred at `centre - uv`.
 */
export interface BorderGeometry {
    /** Any border width is non-zero; false draws as plain Rounded. */
    hasBorder: boolean;
    /** The gap is non-zero; false lets the shader skip the node SDF. */
    hasGap: boolean;
    /** The outer box reaches the node edge on either axis: a shadow hugs it, not the node. */
    shadowOnOuter: boolean;
    outerUvX: number;
    outerUvY: number;
    outerHalfW: number;
    outerHalfH: number;
    innerUvX: number;
    innerUvY: number;
    innerHalfW: number;
    innerHalfH: number;
    outerRadius: Vec4;
    innerRadius: Vec4;
    /** How far the outer box reaches past each node edge, never below 0: the quad growth. */
    growL: number;
    growT: number;
    growR: number;
    growB: number;
}
/**
 * The outer and inner border boxes of a `w` x `h` node. `radius` is
 * already factored to the node; `borderW` holds the raw widths [top,
 * right, bottom, left]. Allocates its result: it runs on a params block
 * cache miss only.
 */
export declare function computeBorderGeometry(w: number, h: number, radius: Vec4, borderW: Vec4, align: number, gap: number): BorderGeometry;
/**
 * Quad growth for one side with room for anti-aliasing: the AA ramp is
 * centred on the true box edge, so it reaches half a device pixel past it.
 * `edgeWidth` is one device pixel in logical px.
 */
export declare const growWithAa: (grow: number, edgeWidth: number) => number;
/** The vertex-stage uniforms of a growing quad: per-op system uniforms (Program.perOp). */
export declare const growUniformsGlsl = "uniform vec4 u_nodeTransform;uniform vec4 u_uvRect;\n";
/**
 * The vertex `main()` body of a quad that grows past its node (1.10
 * growQuadGlsl, the same arithmetic). `grow` is a vec4 expression: the
 * growth past each side (left, top, right, bottom) in local px; `size` a
 * vec2 expression, the node size; both are parenthesized where they are
 * used, so a compound expression keeps its meaning. Writes gl_Position,
 * v_boxUv (local px from the node centre) and v_textureCoords. The growth
 * reaches world space through `u_nodeTransform`, so the SDF space stays 1:1
 * with the node under scale and rotation, and the texture coordinates
 * extend at the node's UV rate (`u_uvRect`), so crops, sub-textures and
 * flips sample the texels an ungrown quad would. `screenSpace`, one
 * clip-space unit (about 0.001 px), is kept from 1.10, which kept it for
 * identical output.
 */
export declare const growQuadGlsl: (grow: string, size: string) => string;
