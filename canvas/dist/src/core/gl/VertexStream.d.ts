/**
 * A vertex is five words: x, y, the packed UV, the premultiplied colour and
 * `a_extra` (roadmap section 4.4). `writeQuad` (scene/emit.ts) lays a quad
 * out, and two writers store the same twenty words inline, ScenePass.emit
 * and TextEmitter.emitText (a call boxes its doubles until V8 inlines it);
 * `GlBackend.point` reads them, its attribute offsets 0, 8, 12 and 16
 * bytes. A layout change touches all four, and the tests pin both inline
 * writers against `writeQuad`.
 */
export declare const WORDS_PER_VERTEX = 5;
export declare const WORDS_PER_QUAD = 20;
export declare const BYTES_PER_VERTEX = 20;
export declare const MAX_QUADS = 16383;
/**
 * The frame's vertex data: one ArrayBuffer with Float32 and Uint32 views,
 * rebuilt every drawn frame and uploaded with one bufferData. Vertex layout is
 * documented in roadmap section 4.4.
 */
export declare class VertexStream {
    readonly buffer: ArrayBuffer;
    readonly f32: Float32Array;
    readonly u32: Uint32Array;
    readonly capacityQuads: number;
    /** Next free word; only ever advances by WORDS_PER_QUAD, so quadCount is always an integer. */
    cursor: number;
    /**
     * `capacityQuads` must be an integer in [1, MAX_QUADS]. Not clamped here
     * (no input validation, per CLAUDE.md): the owner is responsible for
     * staying within range (phase 1c will).
     */
    constructor(capacityQuads: number);
    get quadCount(): number;
    get isFull(): boolean;
    reset(): void;
}
