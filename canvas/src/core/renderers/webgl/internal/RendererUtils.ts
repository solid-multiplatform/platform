import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';
import type { TextureCoords } from '../../../textures/Texture.js';

/**
 * Vertices per quad. Two triangles sharing an edge, wound by the shared index
 * buffer (@see createIndexBuffer).
 */
export const VERTICES_PER_QUAD = 4;

/**
 * Quad buffer bytes per vertex — the vertex attribute stride.
 *
 * @remarks
 * Per-vertex layout (see the `quadBufferCollection` attribute descriptors in
 * WebGlRenderer):
 *   offset  0: a_position      2 x FLOAT                    (8 bytes)
 *   offset  8: a_textureCoords 2 x FLOAT                    (8 bytes)
 *   offset 16: a_color         4 x UNSIGNED_BYTE normalized (4 bytes)
 * Every offset and the stride itself are 4-byte aligned; misaligned vertex
 * attributes push Mali/ES2 drivers onto a CPU repack path.
 *
 * Texture coordinates are FLOAT, as through 1.7.x. From 1.8.0 to 1.10.1 they
 * were normalized UNSIGNED_SHORT, and on a UPC Horizon box every image drew
 * as a single colour while text, whose coordinates stayed FLOAT, drew
 * correctly. A driver that mishandles normalized uint16 attributes collapses
 * each quad's coordinates to one texel, which matches.
 *
 * This is the primitive the other quad-size constants derive from: the layout
 * is defined per vertex, so changing it here is the single edit that carries
 * through to {@link BYTES_PER_QUAD} and {@link WORDS_PER_QUAD}.
 */
export const BYTES_PER_VERTEX = 20;

/**
 * Quad buffer bytes per quad.
 */
export const BYTES_PER_QUAD = BYTES_PER_VERTEX * VERTICES_PER_QUAD;

/**
 * 32-bit words per quad — {@link BYTES_PER_QUAD} expressed in the unit
 * `curBufferIdx` is counted in.
 *
 * @remarks
 * Divides by the word size, NOT by {@link VERTICES_PER_QUAD}: a vertex is 5
 * words and a quad is 4 vertices, so the two divisors give different answers.
 */
export const WORDS_PER_QUAD = BYTES_PER_QUAD / Uint32Array.BYTES_PER_ELEMENT;

/**
 * Allocate texture coordinates.
 *
 * @remarks
 * Cold path only — texture creation and `getTextureCoords`. Writers that need
 * coordinates other than the unit square allocate through this rather than
 * mutating the shared {@link UNIT_TEXTURE_COORDS}.
 */
export function createTextureCoords(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): TextureCoords {
  return { x1, y1, x2, y2 };
}

/**
 * The unit square — what every texture starts at, and what the overwhelming
 * majority use for their whole life.
 *
 * @remarks
 * Shared by reference rather than allocated per texture. Typed `Readonly`
 * because it is shared — mutating it in place would corrupt every texture at
 * once. A writer that needs different coordinates allocates its own via
 * {@link createTextureCoords} (see the compressed-texture branch in
 * `WebGlCtxTexture`).
 */
export const UNIT_TEXTURE_COORDS: Readonly<TextureCoords> =
  /* @__PURE__ */ createTextureCoords(0, 0, 1, 1);

/**
 * Hard ceiling on the number of quads a single vertex buffer can address.
 *
 * @remarks
 * 4 vertices per quad and element indices are Uint16, so the largest vertex id
 * is 65535 — i.e. 16384 quads (16384 * 4 = 65536). Lifting this needs
 * `OES_element_index_uint`, absent on the Mali 400-class floor, so it is a
 * fixed constant rather than a budget.
 */
export const MAX_QUADS = 16384;

/**
 * Largest useful `quadBufferSize`, in bytes.
 *
 * @remarks
 * Bytes past this point can be written but never drawn — their quads fall
 * outside {@link MAX_QUADS}. Allocations are clamped to it so the CPU-side
 * buffer and the index buffer describe the same capacity.
 */
export const MAX_QUAD_BUFFER_SIZE = MAX_QUADS * BYTES_PER_QUAD;

/**
 * Allocate the shared quad index buffer.
 *
 * @remarks
 * Always built at {@link MAX_QUADS}: the index buffer is shared by the main
 * quad buffer and the SDF glyph buffer, each of which indexes it from its own
 * quad 0, so it must cover whichever of the two runs longest regardless of
 * either one's byte budget. At 6 indices per quad that is a one-time 192 KB
 * static allocation.
 *
 * @param glw
 */
export function createIndexBuffer(
  glw: WebGlContextWrapper,
): WebGLBuffer | null {
  const indices = new Uint16Array(MAX_QUADS * 6);

  // i walks the index slot (6 per quad), j the vertex base (4 per quad). The
  // bound must be MAX_QUADS * 6 to fill every slot — stopping at MAX_QUADS left
  // ~5/6 of the buffer zeroed, collapsing every quad past ~MAX_QUADS/6 into a
  // degenerate triangle (the cause of tail geometry silently disappearing).
  for (let i = 0, j = 0; i < MAX_QUADS * 6; i += 6, j += 4) {
    indices[i] = j;
    indices[i + 1] = j + 1;
    indices[i + 2] = j + 2;
    indices[i + 3] = j + 2;
    indices[i + 4] = j + 1;
    indices[i + 5] = j + 3;
  }

  const buffer = glw.createBuffer();
  glw.elementArrayBufferData(buffer, indices, glw.STATIC_DRAW);
  return buffer;
}

/**
 * Checks if an object is of type HTMLImageElement.
 * This is used because we cant check for HTMLImageElement directly when the
 * renderer is running in a seperate web worker context.
 *
 * @param obj
 * @returns
 */
export function isHTMLImageElement(obj: unknown): obj is HTMLImageElement {
  return (
    obj !== null &&
    ((typeof obj === 'object' &&
      obj.constructor &&
      obj.constructor.name === 'HTMLImageElement') ||
      (typeof HTMLImageElement !== 'undefined' &&
        obj instanceof HTMLImageElement))
  );
}

export interface WebGlColor {
  raw: number;
  normalized: [number, number, number, number];
}
