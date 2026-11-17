import { PRECISION } from '../glsl.js';

/**
 * The SDF text program (spec 10.3), compiled the first time a glyph is
 * emitted (ShaderRegistry.program). Per vertex: the world position, the
 * glyph's UV in the atlas (float, as 1.10's), the node's premultiplied
 * colour and the distance range at the text's size (`a_extra`). Glyphs of
 * every size and alpha share the program and batch per atlas and clip.
 * The UV is highp, which every vertex stage has: a mediump (binary16) UV
 * near 1.0 is off by up to half a texel of a 1024-wide atlas.
 */
export const sdfVertex = (viewport: string): string =>
  PRECISION +
  'attribute vec2 a_position;attribute highp vec2 a_textureCoords;attribute vec4 a_color;attribute float a_extra;\n' +
  viewport +
  'varying vec4 v_color;varying vec2 v_textureCoords;varying float v_range;\n' +
  'void main(){v_color=a_color;v_textureCoords=a_textureCoords;' +
  'v_range=a_extra*PIXEL_RATIO;gl_Position=pxToClip(a_position);}';

/**
 * 1.10's SDF fragment shader: the median of the three channels (one for
 * SSDF, whose channels are equal) as a signed distance in screen pixels,
 * coverage a one-pixel ramp; no derivatives, no branch. The colour is
 * premultiplied already (world alpha folded in), so the output is the
 * colour times the coverage, where 1.10 premultiplied a straight colour by
 * it here.
 */
export const SDF_FRAGMENT =
  PRECISION +
  'uniform sampler2D u_texture;varying vec4 v_color;varying vec2 v_textureCoords;varying float v_range;\n' +
  'float median(float r,float g,float b){return clamp(b,min(r,g),max(r,g));}\n' +
  'void main(){vec3 s=texture2D(u_texture,v_textureCoords).rgb;' +
  'float d=v_range*(median(s.r,s.g,s.b)-0.5);' +
  'gl_FragColor=v_color*clamp(d+0.5,0.0,1.0);}';
