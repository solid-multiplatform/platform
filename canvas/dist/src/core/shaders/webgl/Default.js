import { viewportGlsl } from '../utils.js';
/**
 * The default vertex shader, plus per-shader extras. `declarations` adds
 * uniforms/varyings; `assignments` writes them in main(), where the
 * attributes (`a_nodeCoords`, `a_textureCoords`, ...) are in scope.
 *
 * Use it to interpolate a value that is linear across the quad (a pixel
 * position, a gradient coordinate) instead of deriving it on every fragment:
 * interpolation of an affine function is exact.
 *
 * Returns a vertex source function: the viewport (pixel ratio, canvas size)
 * is compiled in, so it needs the renderer.
 */
export const defaultVertex = (declarations, assignments) => (renderer) => `
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

    varying vec4 v_color;
    varying vec2 v_textureCoords;
${declarations}

    void main() {
      v_color = a_color;
      v_textureCoords = a_textureCoords;
${assignments}

      gl_Position = pxToClip(a_position);
    }
  `;
export const Default = {
    vertex: defaultVertex('    varying vec2 v_nodeCoords;', '      v_nodeCoords = a_nodeCoords;'),
    fragment: `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    uniform sampler2D u_texture;

    varying vec4 v_color;
    varying vec2 v_textureCoords;

    void main() {
      gl_FragColor = v_color * texture2D(u_texture, v_textureCoords);
    }
  `,
};
//# sourceMappingURL=Default.js.map