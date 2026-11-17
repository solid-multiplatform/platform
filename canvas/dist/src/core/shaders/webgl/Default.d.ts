import type { WebGlRenderer } from '../../renderers/webgl/WebGlRenderer.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
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
export declare const defaultVertex: (declarations: string, assignments: string) => (renderer: WebGlRenderer) => string;
export declare const Default: WebGlShaderType;
