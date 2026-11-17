/**
 * Batched draw ops in parallel arrays, reset every frame. An op is a run of
 * consecutive quads drawn with one program, one params block, one texture and
 * one clip record. See roadmap section 4.4.
 */
export declare class OpList {
    program: Int32Array;
    texture: Int32Array;
    clip: Int32Array;
    node: Int32Array;
    start: Int32Array;
    count: Int32Array;
    params: (Float32Array | null)[];
    length: number;
    constructor(capacity?: number);
    /**
     * Add quad `quad` (its index in the VertexStream) drawn with the given keys.
     * Extends the last op when every key matches, `perOpMatch` is true and
     * `quad` directly follows the op's last quad. Quads and glyphs land in this
     * one list in stream order (text is deferred in the scene pass, spec 7.3),
     * so the adjacency test only guards against a writer that skips a quad.
     */
    add(program: number, params: Float32Array | null, texture: number, clip: number, node: number, quad: number, perOpMatch: boolean): void;
    /**
     * Add `count` consecutive quads from `quad` drawn with the same keys (a
     * text node's glyphs, which no per-op uniform splits), extending the
     * last op as add() would.
     */
    addRun(program: number, params: Float32Array | null, texture: number, clip: number, node: number, quad: number, count: number): void;
    reset(): void;
    private grow;
}
