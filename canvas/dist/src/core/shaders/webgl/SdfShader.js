import { viewportGlsl } from '../utils.js';
/**
 * SdfShader supports multi-channel and single-channel signed distance field textures.
 *
 * @remarks
 * All per-glyph data (position, color, distance range) is provided via vertex
 * attributes so that multiple text nodes sharing the same font atlas can be
 * batched into a single draw call. Two node-level values ride the render op
 * as system uniforms instead, so animating them never rewrites vertex data:
 * u_translate (pure translation from the cache base) and u_alpha (world
 * alpha). Ops merge only when both match across nodes; see
 * WebGlRenderer.finalizeSdfBatch.
 *
 * This Shader is used by the {@link SdfTextRenderer}. Do not use this Shader
 * directly. Instead create a Text Node and assign a SDF font family to it.
 */
export const Sdf = {
    vertex: (renderer) => `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    // Pre-transformed world-pixel position
    attribute vec2 a_position;
    attribute vec2 a_textureCoords;
    // Per-vertex color (RGBA, unsigned byte, normalized)
    attribute vec4 a_color;
    // Per-vertex SDF distance range
    attribute float a_distRange;

    ${viewportGlsl(renderer)}
    // Per-render-op translation, written by WebGlShaderProgram.bindRenderOp
    // (a reserved system uniform).
    // Cached glyph vertices stay at their cache-base position; a text node
    // that moved by pure translation carries the delta here instead of
    // rewriting every vertex on the CPU, which keeps the shared SDF buffer
    // byte-stable so its per-frame upload can be skipped.
    uniform vec2 u_translate;
    // Per-render-op world alpha (system uniform, see bindRenderOp). Kept out
    // of the packed vertex colors for the same reason as u_translate: an
    // alpha fade must not dirty the cached vertex bytes. Applied here rather
    // than in the fragment shader because a vertex is cheaper than a
    // fragment and v_color.a interpolates linearly.
    uniform float u_alpha;

    varying vec2 v_texcoord;
    varying float v_scaledDistRange;
    varying vec4 v_color;

    void main() {
      // a_position is world pixel space at the node's cache base
      gl_Position = pxToClip(a_position + u_translate);
      v_texcoord = a_textureCoords;
      v_scaledDistRange = a_distRange * PIXEL_RATIO;
      // a_color.a is the node color's own alpha; the fragment shader folds
      // v_color.a into opacity, which also scales rgb, so this one multiply
      // applies the world alpha completely.
      v_color = vec4(a_color.rgb, a_color.a * u_alpha);
    }
  `,
    fragment: `
    # ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    # else
    precision mediump float;
    # endif

    uniform sampler2D u_texture;

    varying vec2 v_texcoord;
    varying float v_scaledDistRange;
    varying vec4 v_color;

    float median(float r, float g, float b) {
        return clamp(b, min(r, g), max(r, g));
    }

    void main() {
        vec3 s = texture2D(u_texture, v_texcoord).rgb;
        float sigDist = v_scaledDistRange * (median(s.r, s.g, s.b) - 0.5);
        float opacity = clamp(sigDist + 0.5, 0.0, 1.0) * v_color.a;

        // Premultiply RGB by final opacity
        gl_FragColor = vec4(v_color.rgb * opacity, opacity);
    }
  `,
};
//# sourceMappingURL=SdfShader.js.map