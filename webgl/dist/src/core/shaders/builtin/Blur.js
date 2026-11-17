import { PRECISION, defaultVertex } from '../glsl.js';
/**
 * A single-pass 3x3 Gaussian approximation (1.10 Blur): nine texture
 * fetches, no render target. Row 0: the tap offset in texture space.
 */
export const Blur = {
    props: { amount: 4 },
    vertex: (ctx) => defaultVertex(ctx.viewport, '', ''),
    fragment: PRECISION +
        'uniform sampler2D u_texture;uniform vec4 u_params[1];varying vec4 v_color;varying vec2 v_textureCoords;\n' +
        'void main(){vec2 px=u_params[0].xy;' +
        'vec4 c=texture2D(u_texture,v_textureCoords)*0.25;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(px.x,0.0))*0.125;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(-px.x,0.0))*0.125;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(0.0,px.y))*0.125;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(0.0,-px.y))*0.125;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(px.x,px.y))*0.0625;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(-px.x,-px.y))*0.0625;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(px.x,-px.y))*0.0625;' +
        'c+=texture2D(u_texture,v_textureCoords+vec2(-px.x,px.y))*0.0625;' +
        'gl_FragColor=c*v_color;}',
    pack(props, w, h, u) {
        u.row(0, props.amount / w, props.amount / h, 0, 0);
    },
};
//# sourceMappingURL=Blur.js.map