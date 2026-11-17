/**
 * Clip records: a logical rect plus its device-pixel scissor box (bottom-left
 * origin), derived once when the rect is written. Record 0 is "no clip".
 * `owner` holds the node id that allocated each record (-1 when free), so a
 * node can tell its own record from the one it shares with its parent.
 *
 * `alloc()` may grow the store, which replaces every typed array; never
 * cache one of this class's typed-array fields across a call to `alloc`.
 */
export declare class ClipStore {
    capacity: number;
    x: Float64Array;
    y: Float64Array;
    w: Float64Array;
    h: Float64Array;
    sx: Int32Array;
    sy: Int32Array;
    sw: Int32Array;
    sh: Int32Array;
    valid: Uint8Array;
    owner: Int32Array;
    private freeHead;
    private nextFree;
    constructor(capacity?: number);
    private resize;
    /** Take a record for node `owner`; it starts invalid until `set`. */
    alloc(owner: number): number;
    free(id: number): void;
    /** Write a logical rect and derive its scissor box. Marks the record valid. */
    set(id: number, x: number, y: number, w: number, h: number, pixelRatio: number, canvasH: number): void;
    invalidate(id: number): void;
    /**
     * Replace record `id` with its intersection with record `other` (both must
     * be valid). A non-overlapping pair becomes the empty rect, still valid,
     * exactly as 1.10's intersectRect.
     */
    intersect(id: number, other: number, pixelRatio: number, canvasH: number): void;
    private updateScissor;
}
