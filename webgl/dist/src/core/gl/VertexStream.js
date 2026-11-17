/**
 * A vertex is six words: x, y, u, v, the premultiplied colour and
 * `a_extra` (roadmap section 4.4). `writeQuad` (scene/emit.ts) lays a quad
 * out, and two writers store the same twenty-four words inline,
 * ScenePass.emit and TextEmitter.emitText (a call boxes its doubles until
 * V8 inlines it); `GlBackend.point` reads them, its attribute offsets 0, 8,
 * 16 and 20 bytes. A layout change touches all four, and the tests pin both
 * inline writers against `writeQuad`.
 *
 * u and v are floats. 1.8.0 to 2.0.7 sent them as normalized UNSIGNED_SHORT
 * (glyphs unnormalized), and a UPC Horizon box drew every image as a single
 * colour that way; floats fixed it there (1.10.2-0).
 */
export const WORDS_PER_VERTEX = 6;
export const WORDS_PER_QUAD = 24;
export const BYTES_PER_VERTEX = 24;
// One quad short of the Uint16 index ceiling (spec 7.2): a WebGL2 context
// always treats index 65535 as primitive-restart for UNSIGNED_SHORT
// (WebGL 2.0 spec 5.18), even when restart is not requested, so quad
// 16383's last vertex (index 65535 at the full 16384) would silently drop
// its second triangle under forceWebGL2.
export const MAX_QUADS = 16383;
/**
 * The frame's vertex data: one ArrayBuffer with Float32 and Uint32 views,
 * rebuilt every drawn frame and uploaded with one bufferData. Vertex layout is
 * documented in roadmap section 4.4.
 */
export class VertexStream {
    /**
     * `capacityQuads` must be an integer in [1, MAX_QUADS]. Not clamped here
     * (no input validation, per CLAUDE.md): the owner is responsible for
     * staying within range (phase 1c will).
     */
    constructor(capacityQuads) {
        /** Next free word; only ever advances by WORDS_PER_QUAD, so quadCount is always an integer. */
        this.cursor = 0;
        this.capacityQuads = capacityQuads;
        this.buffer = new ArrayBuffer(capacityQuads * WORDS_PER_QUAD * 4);
        this.f32 = new Float32Array(this.buffer);
        this.u32 = new Uint32Array(this.buffer);
    }
    get quadCount() {
        return this.cursor / WORDS_PER_QUAD;
    }
    get isFull() {
        return this.cursor >= this.f32.length;
    }
    reset() {
        this.cursor = 0;
    }
}
//# sourceMappingURL=VertexStream.js.map