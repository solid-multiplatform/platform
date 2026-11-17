import { PRECISION, defaultVertex } from '../glsl.js';
/**
 * Largest value a fade ramp may reach across the node: the ramps are
 * varyings, binary16 on Mali-400 (65504), and interpolating an inf is NaN.
 */
const MAX_RAMP = 60000;
/** 1 / fade, or 0 for an edge without one (the vertex shader then saturates it). */
const fadeRecip = (fade, size) => fade > 0 ? 1 / Math.max(fade, size / MAX_RAMP) : 0;
/**
 * Multiplies the node's alpha by a linear ramp inward from each edge with a
 * fade (1.10 EdgeFade). Row 0: node size; row 1: the four reciprocals.
 */
export const EdgeFade = {
    props: { left: 0, top: 0, right: 0, bottom: 0 },
    vertex: (ctx) => defaultVertex(ctx.viewport, 'uniform vec4 u_params[2];varying vec4 v_fade;', 'vec2 px=a_nodeCoords*u_params[0].xy;' +
        'v_fade=vec4(px,u_params[0].xy-px)*u_params[1]+step(u_params[1],vec4(0.0));'),
    fragment: PRECISION +
        'uniform sampler2D u_texture;varying vec4 v_color;varying vec2 v_textureCoords;varying vec4 v_fade;\n' +
        'void main(){vec4 color=v_color*texture2D(u_texture,v_textureCoords);' +
        'vec4 f=clamp(v_fade,0.0,1.0);gl_FragColor=color*(f.x*f.y*f.z*f.w);}',
    pack(props, w, h, u) {
        u.row(0, w, h, 0, 0);
        u.row(1, fadeRecip(props.left, w), fadeRecip(props.top, h), fadeRecip(props.right, w), fadeRecip(props.bottom, h));
    },
};
//# sourceMappingURL=EdgeFade.js.map