/** A number, or an array of 1 to 4 numbers, as four (1.10 validateArrayLength4, copied). */
export const toVec4 = (value) => {
    if (Array.isArray(value) === false) {
        const v = value;
        return [v, v, v, v];
    }
    const a = value;
    if (a.length === 4) {
        return [a[0], a[1], a[2], a[3]];
    }
    if (a.length === 3) {
        return [a[0], a[1], a[2], a[0]];
    }
    if (a.length === 2) {
        return [a[0], a[1], a[0], a[1]];
    }
    // The first value everywhere; an empty array reads as 0.
    const first = a[0];
    const v = first === undefined ? 0 : first;
    return [v, v, v, v];
};
/**
 * Corner radii scaled down so that adjacent corners never overlap on a
 * `w` x `h` node (1.10 calcFactoredRadiusArray); a new array.
 */
export function factorRadius(radius, w, h) {
    const factor = Math.min(Math.min(Math.min(w / Math.max(w, radius[0] + radius[1]), w / Math.max(w, radius[2] + radius[3])), Math.min(h / Math.max(h, radius[0] + radius[3]), h / Math.max(h, radius[1] + radius[2]))), 1);
    return [
        radius[0] * factor,
        radius[1] * factor,
        radius[2] * factor,
        radius[3] * factor,
    ];
}
/**
 * The width remap the border shaders always applied: 1 and above is kept,
 * (0, 1) shrinks toward 0, and 0 becomes -1, so a side without a border
 * pulls the outer box a pixel inside the node edge (hiding its AA fringe).
 */
const adjustWidth = (w) => w - 1 + Math.min(Math.max(w, -1), 1);
/**
 * The outer and inner border boxes of a `w` x `h` node. `radius` is
 * already factored to the node; `borderW` holds the raw widths [top,
 * right, bottom, left]. Allocates its result: it runs on a params block
 * cache miss only.
 */
export function computeBorderGeometry(w, h, radius, borderW, align, gap) {
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const hasBorder = Math.abs(borderW[0]) +
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
    // A gap only opens on sides that carry a border.
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
    return {
        hasBorder,
        hasGap: Math.abs(gap) >= 0.0001,
        shadowOnOuter: outerHalfW >= halfW || outerHalfH >= halfH,
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
}
/**
 * Quad growth for one side with room for anti-aliasing: the AA ramp is
 * centred on the true box edge, so it reaches half a device pixel past it.
 * `edgeWidth` is one device pixel in logical px.
 */
export const growWithAa = (grow, edgeWidth) => grow > 0 ? grow + edgeWidth : 0;
/** The vertex-stage uniforms of a growing quad: per-op system uniforms (Program.perOp). */
export const growUniformsGlsl = 'uniform vec4 u_nodeTransform;uniform vec4 u_uvRect;\n';
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
export const growQuadGlsl = (grow, size) => 'vec2 screenSpace=vec2(2.0/RESOLUTION.x,-2.0/RESOLUTION.y);' +
    'vec2 edge=clamp(a_nodeCoords*2.0-vec2(1.0),-1.0,1.0);' +
    `vec2 edgeOffset=edge*mix((${grow}).zw,(${grow}).xy,step(edge,vec2(0.0)));` +
    'gl_Position=pxToClip(a_position+u_nodeTransform.xy*edgeOffset.x+u_nodeTransform.zw*edgeOffset.y);' +
    `v_boxUv=(a_nodeCoords-0.5)*(${size})+screenSpace+edgeOffset;` +
    `v_textureCoords=a_textureCoords+(screenSpace+edgeOffset)/(${size})*(u_uvRect.zw-u_uvRect.xy);\n`;
//# sourceMappingURL=borderGeometry.js.map