import { computeBorderGeometry, factorRadius, growQuadGlsl, growUniformsGlsl, growWithAa, toVec4, } from '../borderGeometry.js';
import { PRECISION, edgeWidthDefine, paramsGlsl, rampScale, rgbaRow, } from '../glsl.js';
/**
 * The six rounded, border and shadow types (spec 8.3): one GLSL source,
 * specialized per type by `#define`s (HAS_RADIUS, HAS_BORDER, HAS_FILL,
 * HAS_SHADOW, SHADOW_MODEL), each a program of its own with the 1.10
 * arithmetic, so the output matches 1.10 pixel for pixel for opaque
 * content at world alpha 1. World alpha applies once (spec 14.8): the
 * node's colour carries it in v_color, and `u_alpha` scales only the
 * colours the shader brings (border, fill, shadow), where 1.10 scaled the
 * whole result again; and RoundedWithShadow and Shadow composite the node
 * over its shadow, where 1.10 weighted the node's colour by its own alpha a
 * second time (`min(colour alpha, coverage)`, the same for opaque content).
 * Rounded is the lightest: no system uniform and no quad growth, so its
 * nodes batch whatever their alpha and transform.
 */
/** A vec4 prop: a number or a short array normalizes to four values. */
const vec4Prop = (def) => ({
    default: def,
    resolve: (value) => (value !== undefined ? toVec4(value) : def.slice()),
});
/** An alias of one element of a vec4 prop (1.10 `top-left`, `shadow-x`, ...). */
const elementOf = (prop, i) => ({
    default: 0,
    set(value, props) {
        props[prop][i] = value;
    },
    get: (props) => props[prop][i],
});
/** Border alignment: a number, or 'inside' (0), 'center' (0.5), 'outside' (1, the default). */
const alignProp = {
    default: 1,
    resolve(value) {
        if (isNaN(value) === false) {
            return value;
        }
        if (value === 'inside') {
            return 0;
        }
        if (value === 'center') {
            return 0.5;
        }
        return 1;
    },
};
const radiusProps = () => ({
    radius: vec4Prop([0, 0, 0, 0]),
    'top-left': elementOf('radius', 0),
    'top-right': elementOf('radius', 1),
    'bottom-right': elementOf('radius', 2),
    'bottom-left': elementOf('radius', 3),
});
const borderProps = (pf) => ({
    [pf + 'w']: vec4Prop([0, 0, 0, 0]),
    [pf + 'color']: 0xffffffff,
    [pf + 'align']: alignProp,
    [pf + 'gap']: 0,
    [pf + 'top']: elementOf(pf + 'w', 0),
    [pf + 'right']: elementOf(pf + 'w', 1),
    [pf + 'bottom']: elementOf(pf + 'w', 2),
    [pf + 'left']: elementOf(pf + 'w', 3),
});
const shadowProps = (pf) => ({
    [pf + 'color']: 0x000000ff,
    [pf + 'projection']: vec4Prop([0, 0, 5, 5]),
    [pf + 'x']: elementOf(pf + 'projection', 0),
    [pf + 'y']: elementOf(pf + 'projection', 1),
    [pf + 'blur']: elementOf(pf + 'projection', 2),
    [pf + 'spread']: elementOf(pf + 'projection', 3),
});
const vec4Row = (u, i, v) => {
    u.row(i, v[0], v[1], v[2], v[3]);
};
/**
 * The shared source. The type's defines name its rows and pick its paths:
 * HAS_RADIUS (rounded corners: a radius select per quadrant), HAS_BORDER
 * (an outer and an inner box, with uniform-driven exits for no border and
 * no gap), HAS_FILL (RoundedWithBorder's gap colour), HAS_SHADOW with
 * SHADOW_MODEL 0 (RoundedWithShadow, Shadow: the shadow box is
 * interpolated, and the node's premultiplied colour is composited over
 * the shadow, whose colour stays straight RGBA as in 1.10) or 1
 * (RoundedWithBorderAndShadow: the shadow box is offset per fragment, and
 * the node mixes over its shadow by coverage, as in 1.10, so a translucent
 * node hides the shadow under it where RoundedWithShadow shows it).
 * The uniform branches skip whole SDF evaluations for the same condition
 * across the draw call (CLAUDE.md: keep them); everything per fragment is
 * arithmetic.
 *
 * Whether the quad grows past the node by U_GROW (every type but Rounded)
 * is chosen here rather than by a define, so that Rounded's sources never
 * name the per-op uniforms the others need (u_nodeTransform, u_uvRect,
 * u_alpha): a program is per-op by the uniforms it names. The colours a
 * shader brings read world alpha as ALPHA, which only a growing type
 * defines.
 */
const vertexSource = (grows) => 'attribute vec2 a_position;attribute vec2 a_textureCoords;attribute vec4 a_color;attribute vec2 a_nodeCoords;\n' +
    (grows === true ? growUniformsGlsl : '') +
    'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_boxUv;\n' +
    '#if HAS_SHADOW&&SHADOW_MODEL==0\nvarying vec2 v_shadowBox;\n#endif\n' +
    'void main(){\n' +
    (grows === true
        ? growQuadGlsl('U_GROW', 'U_NODE.xy*2.0')
        : 'v_textureCoords=a_textureCoords;v_boxUv=(a_nodeCoords*2.0-1.0)*U_NODE.xy;gl_Position=pxToClip(a_position);\n') +
    'v_color=a_color;\n' +
    '#if HAS_SHADOW&&SHADOW_MODEL==0\nv_shadowBox=v_boxUv-U_SHADOW.xy;\n#endif\n}';
const fragmentSource = (grows) => 'uniform sampler2D u_texture;\n' +
    (grows === true ? 'uniform float u_alpha;\n#define ALPHA u_alpha\n' : '') +
    'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_boxUv;\n' +
    '#if HAS_SHADOW&&SHADOW_MODEL==0\nvarying vec2 v_shadowBox;\n#endif\n' +
    '#if HAS_RADIUS\n' +
    'float quadRadius(vec2 p,vec4 r){vec2 s=step(vec2(0.0),p);return mix(mix(r.x,r.y,s.x),mix(r.w,r.z,s.x),s.y);}\n' +
    'float box(vec2 p,vec2 s,vec4 r){float rad=quadRadius(p,r);vec2 q=abs(p)-s+rad;return (min(max(q.x,q.y),0.0)+length(max(q,0.0)))-rad;}\n' +
    '#define BOX(p,s,r) box(p,s,r)\n#define SHADOW_RADIUS vec4\n' +
    '#else\n' +
    'float box(vec2 p,vec2 s){vec2 q=abs(p)-s;return min(max(q.x,q.y),0.0)+length(max(q,0.0));}\n' +
    '#define BOX(p,s,r) box(p,s)\n#define SHADOW_RADIUS float\n' +
    '#endif\n' +
    '#if HAS_SHADOW\n' +
    'float shadowBox(vec2 p,vec2 s,SHADOW_RADIUS r){\n#if HAS_RADIUS\nfloat rad=quadRadius(p,r);\n#else\nfloat rad=r;\n#endif\n' +
    'vec2 q=abs(p)-s+rad;float dist=min(max(q.x,q.y),0.0)+length(max(q,0.0))-rad;' +
    'float t=clamp(dist*U_SHADOW_RAMP.x+U_SHADOW_RAMP.y,0.0,1.0);return 1.0-t*t*(3.0-2.0*t);}\n' +
    '#define BASE shadow\n#else\n#define BASE vec4(0.0)\n#endif\n' +
    'void main(){vec4 color=texture2D(u_texture,v_textureCoords)*v_color;\n' +
    '#if HAS_SHADOW\nvec4 shadow=vec4(0.0);' +
    'if(U_SHADOW_COLOR.a>=0.0001){shadow=U_SHADOW_COLOR*ALPHA*shadowBox(SHADOW_P,SHADOW_S,SHADOW_R);}\n#endif\n' +
    '#if HAS_BORDER\n' +
    'if(U_NODE.z<0.5){float nodeAlpha=clamp(0.5-BOX(v_boxUv,U_NODE.xy,U_RADIUS)*INV_EDGE_WIDTH,0.0,1.0);\n' +
    '#if HAS_SHADOW\ngl_FragColor=mix(shadow,color,nodeAlpha);\n#else\ngl_FragColor=color*nodeAlpha;\n#endif\nreturn;}\n' +
    'float outerDist=BOX(v_boxUv+U_OUTER_BOX.xy,U_OUTER_BOX.zw,U_OUTER_RADIUS);' +
    'float innerDist=BOX(v_boxUv+U_INNER_BOX.xy,U_INNER_BOX.zw,U_INNER_RADIUS);' +
    'float innerAlpha=clamp(0.5-innerDist*INV_EDGE_WIDTH,0.0,1.0);' +
    'vec4 border=U_BORDER_COLOR*ALPHA;\n' +
    'if(U_NODE.w<0.5){float outerAlpha=clamp(0.5-outerDist*INV_EDGE_WIDTH,0.0,1.0);' +
    'gl_FragColor=mix(mix(BASE,border,outerAlpha*U_BORDER_COLOR.a),color,innerAlpha);return;}\n' +
    'float nodeAlpha=clamp(0.5-BOX(v_boxUv,U_NODE.xy,U_RADIUS)*INV_EDGE_WIDTH,0.0,1.0);' +
    'float borderAlpha=clamp(0.5-max(-innerDist,outerDist)*INV_EDGE_WIDTH,0.0,1.0);\n' +
    '#if HAS_FILL\nvec4 fill=color*nodeAlpha+U_FILL_COLOR*ALPHA*max(0.0,innerAlpha-nodeAlpha);\n' +
    '#else\nvec4 fill=mix(BASE,color,nodeAlpha);\n#endif\n' +
    'gl_FragColor=mix(fill,border,borderAlpha*U_BORDER_COLOR.a);\n' +
    '#else\n' +
    'float nodeAlpha=clamp(0.5-BOX(v_boxUv,U_NODE.xy,U_RADIUS)*INV_EDGE_WIDTH,0.0,1.0);\n' +
    '#if HAS_SHADOW\ngl_FragColor=mix(shadow,color,nodeAlpha)+shadow*(nodeAlpha*(1.0-color.a));\n#else\ngl_FragColor=color*nodeAlpha;\n#endif\n' +
    '#endif\n}';
/** Feature flags of a box type. */
const GROWS = 1;
const RADIUS = 2;
const BORDER = 4;
const FILL = 8;
const SHADOW = 16;
const MODEL_B = 32;
/** `#define NAME 1` when `bit` is set, else `0`. */
const flag = (name, bit) => `#define ${name} ${bit === 0 ? 0 : 1}\n`;
/**
 * A box type's program: its feature flags (GLSL ES 1.0 rejects an undefined
 * name in `#if`, so every flag is defined, 0 or 1), extra defines and rows
 * ahead of the shared source. GROWS picks the growing quad (see above).
 */
const boxType = (flags, extra, rows, props, pack) => {
    const grows = (flags & GROWS) !== 0;
    const vertex = vertexSource(grows);
    const fragment = fragmentSource(grows);
    const defines = flag('HAS_RADIUS', flags & RADIUS) +
        flag('HAS_BORDER', flags & BORDER) +
        flag('HAS_FILL', flags & FILL) +
        flag('HAS_SHADOW', flags & SHADOW) +
        flag('SHADOW_MODEL', flags & MODEL_B);
    const head = (ctx) => PRECISION + defines + extra + ctx.viewport + paramsGlsl(rows);
    return {
        props: props,
        vertex: (ctx) => head(ctx) + vertex,
        fragment: (ctx) => head(ctx) + edgeWidthDefine(ctx.pixelRatio) + fragment,
        pack,
    };
};
export const Rounded = boxType(RADIUS, '', ['U_RADIUS', 'U_NODE'], radiusProps(), (props, w, h, u) => {
    vec4Row(u, 0, factorRadius(props.radius, w, h));
    u.row(1, w * 0.5, h * 0.5, 0, 0);
});
/** Rows 0 to 3 of every border type (1.10's border update); the caller writes U_GROW. */
const packBorder = (u, w, h, radius, props, pf) => {
    const g = computeBorderGeometry(w, h, radius, props[pf + 'w'], props[pf + 'align'], props[pf + 'gap']);
    rgbaRow(u, 0, props[pf + 'color']);
    u.row(1, w * 0.5, h * 0.5, g.hasBorder === true ? 1 : 0, g.hasGap === true ? 1 : 0);
    u.row(2, g.outerUvX, g.outerUvY, g.outerHalfW, g.outerHalfH);
    u.row(3, g.innerUvX, g.innerUvY, g.innerHalfW, g.innerHalfH);
    return g;
};
/** U_GROW of a border without a shadow: the outer box's reach, plus the AA margin. */
const growRow = (u, g) => {
    const ew = 1 / u.pixelRatio;
    u.row(4, growWithAa(g.growL, ew), growWithAa(g.growT, ew), growWithAa(g.growR, ew), growWithAa(g.growB, ew));
};
const NO_RADIUS = [0, 0, 0, 0];
export const Border = boxType(GROWS | BORDER, '', ['U_BORDER_COLOR', 'U_NODE', 'U_OUTER_BOX', 'U_INNER_BOX', 'U_GROW'], borderProps(''), (props, w, h, u) => {
    const g = packBorder(u, w, h, NO_RADIUS, props, '');
    growRow(u, g);
    // No border: the fragment shader's early exit reads no world alpha.
    if (g.hasBorder === false) {
        u.alphaUnused();
    }
});
export const RoundedWithBorder = boxType(GROWS | RADIUS | BORDER | FILL, '', [
    'U_BORDER_COLOR',
    'U_NODE',
    'U_OUTER_BOX',
    'U_INNER_BOX',
    'U_GROW',
    'U_FILL_COLOR',
    'U_RADIUS',
    'U_OUTER_RADIUS',
    'U_INNER_RADIUS',
], {
    ...radiusProps(),
    ...borderProps('border-'),
    // A colour without 'color' in its name: flagged so animations blend it.
    'border-fill': { default: 0x00000000, color: true },
}, (props, w, h, u) => {
    const values = props;
    const radius = factorRadius(values.radius, w, h);
    const g = packBorder(u, w, h, radius, values, 'border-');
    growRow(u, g);
    // No border: the early exit reads no world alpha (the gap fill is drawn
    // only with a border).
    if (g.hasBorder === false) {
        u.alphaUnused();
    }
    rgbaRow(u, 5, values['border-fill']);
    vec4Row(u, 6, radius);
    vec4Row(u, 7, g.outerRadius);
    vec4Row(u, 8, g.innerRadius);
});
/** RoundedWithShadow and Shadow (1.10's shadow model): the node grown by spread. */
const packShadow = (u, w, h, shadow, color) => {
    const blur = shadow[2];
    const spread = shadow[3];
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    rgbaRow(u, 0, color);
    vec4Row(u, 1, shadow);
    u.row(2, halfW, halfH, halfW + spread, halfH + spread);
    // Fade: smoothstep(-blur, blur + 0.001, dist) as a multiply-add.
    const fade = rampScale(-blur, blur + 0.001);
    u.row(3, fade, blur * fade, 0, 0);
    // Growth: the shadow box is the node grown by spread, its fade runs blur
    // past that, and the offset shifts it; none for a transparent shadow,
    // which the fragment shader skips, reading no world alpha.
    const reach = spread + blur;
    const sx = shadow[0];
    const sy = shadow[1];
    if ((color & 0xff) === 0) {
        u.row(4, 0, 0, 0, 0);
        u.alphaUnused();
    }
    else {
        u.row(4, Math.max(0, reach - sx), Math.max(0, reach - sy), Math.max(0, reach + sx), Math.max(0, reach + sy));
    }
};
const SHADOW_A_ROWS = [
    'U_SHADOW_COLOR',
    'U_SHADOW',
    'U_NODE',
    'U_SHADOW_RAMP',
    'U_GROW',
];
export const RoundedWithShadow = boxType(GROWS | RADIUS | SHADOW, '#define SHADOW_P v_shadowBox\n#define SHADOW_S U_NODE.zw\n#define SHADOW_R U_SHADOW_RADIUS\n', SHADOW_A_ROWS.concat(['U_RADIUS', 'U_SHADOW_RADIUS']), { ...radiusProps(), ...shadowProps('shadow-') }, (props, w, h, u) => {
    const values = props;
    const shadow = values['shadow-projection'];
    const radius = factorRadius(values.radius, w, h);
    packShadow(u, w, h, shadow, values['shadow-color']);
    vec4Row(u, 5, radius);
    const spread = shadow[3];
    u.row(6, Math.max(0, radius[0] + spread), Math.max(0, radius[1] + spread), Math.max(0, radius[2] + spread), Math.max(0, radius[3] + spread));
});
export const Shadow = boxType(GROWS | SHADOW, '#define SHADOW_P v_shadowBox\n#define SHADOW_S U_NODE.zw\n#define SHADOW_R max(0.0,U_SHADOW.w)\n', SHADOW_A_ROWS, shadowProps(''), (props, w, h, u) => {
    const values = props;
    packShadow(u, w, h, values.projection, values.color);
});
export const RoundedWithBorderAndShadow = boxType(GROWS | RADIUS | BORDER | SHADOW | MODEL_B, '#define SHADOW_P v_boxUv+U_SHADOW_BOX.xy\n#define SHADOW_S U_SHADOW_BOX.zw\n#define SHADOW_R U_SHADOW_RADIUS\n', [
    'U_BORDER_COLOR',
    'U_NODE',
    'U_OUTER_BOX',
    'U_INNER_BOX',
    'U_GROW',
    'U_SHADOW_COLOR',
    'U_SHADOW_RAMP',
    'U_RADIUS',
    'U_OUTER_RADIUS',
    'U_INNER_RADIUS',
    'U_SHADOW_BOX',
    'U_SHADOW_RADIUS',
], { ...radiusProps(), ...borderProps('border-'), ...shadowProps('shadow-') }, (props, w, h, u) => {
    const values = props;
    const ew = 1 / u.pixelRatio;
    const radius = factorRadius(values.radius, w, h);
    const g = packBorder(u, w, h, radius, values, 'border-');
    const shadow = values['shadow-projection'];
    const color = values['shadow-color'];
    rgbaRow(u, 5, color);
    vec4Row(u, 7, radius);
    vec4Row(u, 8, g.outerRadius);
    vec4Row(u, 9, g.innerRadius);
    // The shadow hugs the outer border box when the border grows the quad
    // past the node on either axis, otherwise the node box.
    const outer = g.shadowOnOuter;
    const blur = shadow[2];
    const spread = shadow[3];
    const shadowRadius = outer === true ? g.outerRadius : radius;
    u.row(10, (outer === true ? g.outerUvX : 0) - shadow[0], (outer === true ? g.outerUvY : 0) - shadow[1], (outer === true ? g.outerHalfW : w * 0.5) + spread, (outer === true ? g.outerHalfH : h * 0.5) + spread);
    u.row(11, shadowRadius[0] + blur, shadowRadius[1] + blur, shadowRadius[2] + blur, shadowRadius[3] + blur);
    // Fade: smoothstep(-spread, spread + blur, dist) as a multiply-add.
    const fade = rampScale(-spread, spread + blur);
    u.row(6, fade, spread * fade, 0, 0);
    const borderL = growWithAa(g.growL, ew);
    const borderT = growWithAa(g.growT, ew);
    const borderR = growWithAa(g.growR, ew);
    const borderB = growWithAa(g.growB, ew);
    // A transparent shadow (alpha 0, e.g. the idle state of a shadow that
    // animates in on focus) adds no growth: the fragment shader skips it.
    // Without a border either, nothing it draws reads world alpha.
    if ((color & 0xff) === 0) {
        u.row(4, borderL, borderT, borderR, borderB);
        if (g.hasBorder === false) {
            u.alphaUnused();
        }
        return;
    }
    // A visible shadow reaches 2 * spread + blur past its base box, shifted
    // by the offset; never below 0.
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const reach = spread * 2 + blur;
    const sx = shadow[0];
    const sy = shadow[1];
    const baseL = outer === true ? g.outerHalfW + g.outerUvX - halfW : 0;
    const baseT = outer === true ? g.outerHalfH + g.outerUvY - halfH : 0;
    const baseR = outer === true ? g.outerHalfW - g.outerUvX - halfW : 0;
    const baseB = outer === true ? g.outerHalfH - g.outerUvY - halfH : 0;
    u.row(4, Math.max(0, borderL, baseL + reach - sx), Math.max(0, borderT, baseT + reach - sy), Math.max(0, borderR, baseR + reach + sx), Math.max(0, borderB, baseB + reach + sy));
});
//# sourceMappingURL=Box.js.map