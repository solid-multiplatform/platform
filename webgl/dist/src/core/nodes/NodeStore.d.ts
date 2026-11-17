/**
 * Equal, NaN equal to NaN, so that a size or a text box compared with the
 * one stored settles (a font size of 0 lays out a NaN width).
 */
export declare const same: (a: number, b: number) => boolean;
/**
 * Storage for every node: one interleaved record per node in each of two
 * buffers (`f64`, and `i32` / `u32` / `f32` over one buffer; the layout is
 * in NodeLayout.ts), an array each for the sibling links (`prev`, `next`),
 * plus side arrays for object references. See roadmap
 * section 4.1, which had an array per field: creating a node and visiting
 * it then touched about fifty arrays, and the store spent most of a node's
 * creation on their memory traffic.
 *
 * Any `alloc()` may grow the store, which replaces every typed array and
 * increments `generation`; never hold a typed array across a call that can
 * allocate without re-reading it when `generation` changed. A record
 * offset (`id * F_STRIDE`, `id * I_STRIDE`) survives growth.
 *
 * Derived world state (`wa`..`wty`, the bounds, `worldAlpha`) is Float64,
 * not Float32: at Float32 precision, scissor boxes land a device pixel off
 * 1.10 in a measurable share of cases, quarter turns fail to cancel
 * exactly to zero, and alpha comparisons against a Float32 read never
 * match. The extra 44 bytes per node buys bit-exact parity with 1.10's
 * arithmetic.
 */
export declare class NodeStore {
    capacity: number;
    liveCount: number;
    /** Bumped at the end of every `resize()` (the constructor's included). */
    generation: number;
    /**
     * Props and derived world state, F_STRIDE slots per node (NodeLayout.ts):
     * node `id`'s F_X is `f64[id * F_STRIDE + F_X]`.
     */
    f64: Float64Array;
    /**
     * Links, ids, colours, the UV rect and flag words: three views of one
     * buffer, I_STRIDE words per node (NodeLayout.ts). Each field is read
     * through the view its constant names.
     */
    i32: Int32Array;
    u32: Uint32Array;
    f32: Float32Array;
    /**
     * The sibling links, NULL-terminated, one slot per node: node `id`'s
     * previous sibling is `prev[id]`. Kept out of the `i32` record because a
     * pass along a sibling list (the scene pass pushing a parent's children,
     * Node.children, destroy) reads only this field of each sibling, and each
     * read waits on the one before: in the record that is one cache line per
     * sibling, missed one after another once the records have left the cache.
     */
    prev: Int32Array;
    next: Int32Array;
    handles: (object | null)[];
    shaderRefs: (object | null)[];
    textureRefs: (object | null)[];
    srcs: (string | null)[];
    textureOptions: (object | null)[];
    clipMargins: (number[] | null)[];
    extras: (object | null)[];
    data: (object | null)[];
    animations: (object | null)[];
    /**
     * The node's params block (ShaderRegistry.pack): immutable and shared by
     * reference with every node of the same type, props and size. Null for
     * Default.
     */
    params: (Float32Array | null)[];
    /**
     * A text node's TextState (TextNode.ts): its text props, its layout and
     * TextNodes' bookkeeping; null for every other node.
     */
    texts: (object | null)[];
    /**
     * Node.children's array: built on the first read after the node's child
     * list changes and shared by every read until the next change. Every
     * writer of the child links drops it (insertAfter, unlink, free); null
     * until read.
     */
    childArrays: (object[] | null)[];
    /**
     * Nodes whose preload state or texture source changed while preloading,
     * for TextureNodes.drainPreloads (spec 9.2: preload is a want outside the
     * walk, which never visits a node under a culled ancestor). Guarded by
     * ST_PRELOAD_QUEUED so a node is listed once.
     */
    preloads: Int32Array<ArrayBuffer>;
    preloadCount: number;
    /** True once any node has pending dirty bits; the scene pass clears it. */
    anyDirty: boolean;
    /** Called on the false -> true transition of `anyDirty`. */
    onDirty: (() => void) | null;
    /**
     * markDirty calls since the scene pass zeroed it at the start of its last
     * walk, less the ones TextureNodes takes back: the texture size a leaf in
     * the margin takes in the walk, which its next visit applies (spec 6.1).
     */
    writes: number;
    /**
     * While true (the scene pass sets it for the length of a walk), `free`
     * quarantines slots instead of returning them to the free list, until
     * `endDeferFree`. A slot freed during a walk (still on its stack, being
     * visited, or about to be swept) is then never handed to a node created in
     * the same walk, so `uid === 0` stays a complete "destroyed" test.
     */
    deferFree: boolean;
    private freeHead;
    private nextUid;
    /** Quarantined slots, newest first, linked through `nextFree`. */
    private quarantineHead;
    private quarantineTail;
    constructor(capacity?: number);
    private resize;
    alloc(): number;
    /**
     * List `id` for TextureNodes.drainPreloads, once (ST_PRELOAD_QUEUED). The
     * texture input setters call it for a node with preload set.
     */
    queuePreload(id: number): void;
    /**
     * Return `id` to the free list (to the quarantine while `deferFree` is
     * set). Preconditions: `id` is already unlinked from its parent, or is
     * being freed as part of a whole subtree teardown where the parent's own
     * links are being discarded too; never free the same id twice; never free
     * NULL.
     */
    free(id: number): void;
    /**
     * Clear `deferFree` and put the quarantined slots at the head of the free
     * list, newest first, as if each had been freed without the quarantine.
     */
    endDeferFree(): void;
    /**
     * OR `bits` into the node, set DIRTY_CHILD on every ancestor until one
     * already has it, and raise `anyDirty`. Amortized O(1).
     *
     * DIRTY_CHILD is advisory: the walk stops at the first ancestor that
     * already has it, and the scene pass keeps it on culled nodes while
     * clearing it on visible ones, so an ancestor of a dirty node may lack
     * it. Never use it to skip visiting or updating a subtree.
     */
    markDirty(id: number, bits: number): void;
    /**
     * Append `child` (which must be unlinked) under `parent`, keeping siblings
     * sorted by zIndex (stable: equal zIndex goes after existing siblings).
     */
    appendChild(parent: number, child: number): void;
    /**
     * Insert `child` (which must be unlinked) under `parent` before `before`,
     * one of its children (NULL appends, as appendChild). Siblings stay
     * sorted by zIndex: where `before`'s zIndex is not the child's, the child
     * goes to the nearest place that keeps them sorted.
     */
    insertBefore(parent: number, child: number, before: number): void;
    private insertAfter;
    /** Detach `child` from its parent's sibling list. No-op when unparented. */
    unlink(child: number): void;
    /**
     * The writer of w/h besides the w and h setters (autosize): stores them
     * and raises DIRTY_LOCAL | DIRTY_SHADER, as every w/h change must. A
     * text's layout, which runs in the visit of the node it sizes, writes
     * through applySizeInVisit instead.
     */
    applySize(id: number, w: number, h: number): void;
    /**
     * A size a scene pass hook writes for the node being visited (phase 5's
     * text layout, which runs before the visit composes the node): stores
     * w and h and returns the bits a size change raises, DIRTY_LOCAL |
     * DIRTY_SHADER (0 when unchanged, NaN equal to NaN), for the visit to
     * take at once. Not markDirty: the parent chain and the walk's write
     * count stay untouched, so the new size is composed and drawn in this
     * walk without a re-walk. Every other writer uses applySize.
     */
    applySizeInVisit(id: number, w: number, h: number): number;
    /** Change a node's zIndex and re-insert it among its siblings. */
    setZIndex(child: number, z: number): void;
}
