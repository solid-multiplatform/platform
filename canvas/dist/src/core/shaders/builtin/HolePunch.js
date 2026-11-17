import { factorRadius, toVec4 } from '../borderGeometry.js';
import { PRECISION, defaultVertex, edgeWidthDefine } from '../glsl.js';
/**
 * Cuts a rounded rectangle out of the node (1.10 HolePunch). Row 0: node
 * size (xy) and hole position (zw); row 1: hole half size; row 2: radius.
 * The hole takes the node's colour away by its coverage alone,
 * `color * (1 - coverage)` (as `mix`, 1.10's arithmetic), so a translucent
 * node's hole is empty; 1.10 weighted the coverage by the colour's alpha
 * again (`min(colour alpha, coverage)`), the same for opaque content.
 */
export const HolePunch = {
    props: {
        x: 0,
        y: 0,
        w: 50,
        h: 50,
        radius: {
            default: [0, 0, 0, 0],
            resolve: (value) => value !== undefined ? toVec4(value) : [0, 0, 0, 0],
        },
    },
    vertex: (ctx) => defaultVertex(ctx.viewport, 'uniform vec4 u_params[3];varying vec2 v_hole;', 'v_hole=(a_textureCoords*u_params[0].xy-u_params[0].zw)-u_params[1].xy;'),
    fragment: (ctx) => PRECISION +
        edgeWidthDefine(ctx.pixelRatio) +
        'uniform sampler2D u_texture;uniform vec4 u_params[3];' +
        'varying vec4 v_color;varying vec2 v_textureCoords;varying vec2 v_hole;\n' +
        'void main(){vec4 color=texture2D(u_texture,v_textureCoords)*v_color;vec2 p=v_hole;' +
        'vec2 stepVal=step(vec2(0.0),p);vec4 r4=u_params[2];' +
        'float r=mix(mix(r4.x,r4.y,stepVal.x),mix(r4.w,r4.z,stepVal.x),stepVal.y);' +
        'p=abs(p)-u_params[1].xy+r;' +
        // 1.10's edge, kept for parity: `+2.0` puts the hole's edge 2 px inside
        // its box, and the AA is one device pixel, like every other SDF shader,
        // but a linear ramp from dist 0 to EDGE_WIDTH, 50% at its middle, where
        // the others centre theirs on the edge (`0.5 - d * INV_EDGE_WIDTH`).
        'float dist=min(max(p.x,p.y),0.0)+length(max(p,0.0))-r+2.0;' +
        'float roundedAlpha=clamp(1.0-dist*INV_EDGE_WIDTH,0.0,1.0);' +
        'gl_FragColor=mix(color,vec4(0.0),roundedAlpha);}',
    pack(props, w, h, u) {
        u.row(0, w, h, props.x, props.y);
        u.row(1, props.w * 0.5, props.h * 0.5, 0, 0);
        const r = factorRadius(props.radius, props.w, props.h);
        u.row(2, r[0], r[1], r[2], r[3]);
    },
};
//# sourceMappingURL=HolePunch.js.map