import { PRECISION } from '../glsl.js';
/**
 * Program 0's fragment shader (1.10 Default): the texture, the 1x1 white
 * one for a plain rect, tinted by the premultiplied vertex colour. Its
 * vertex shader is `defaultVertex` with no extras.
 */
export const DEFAULT_FRAGMENT = PRECISION +
    'uniform sampler2D u_texture;varying vec4 v_color;varying vec2 v_textureCoords;\n' +
    'void main(){gl_FragColor=v_color*texture2D(u_texture,v_textureCoords);}';
//# sourceMappingURL=Default.js.map