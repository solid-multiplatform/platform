import type { NodeStore } from '../nodes/NodeStore.js';
export declare const TX_IDLE = 0;
export declare const TX_QUEUED = 1;
export declare const TX_LOADING = 2;
export declare const TX_DECODED = 3;
export declare const TX_UPLOADED = 4;
export declare const TX_FAILED = 5;
export declare const TX_FREED = 6;
export declare const KIND_IMAGE = 0;
export declare const KIND_COLOR = 1;
export declare const KIND_NOISE = 2;
/** A SubTexture: no pixels of its own, a region of its `parent` record. */
export declare const KIND_SUB = 3;
/** Never evicted (textureOptions.preventCleanup, Texture.preventCleanup). */
export declare const F_PREVENT_CLEANUP = 1;
/** The decoded data is straight alpha: WebGL premultiplies on upload. */
export declare const F_GL_PREMULTIPLY = 2;
/**
 * Backoff for a failed load (spec 9.3): the n-th retry starts 2^(n - 1)
 * frame periods after the n-th failure (17, 33, 67, 133 and 267 ms for the
 * default 5 retries, about half a second in all), at most 2^10 (about 17 s,
 * far below setTimeout's 2^31 ms limit). Timed, not counted in frames: the
 * loop sleeps when nothing changes, so a frame count could stall.
 */
export declare const retryDelay: (failures: number) => number;
/** Release a decoded image's native memory now rather than at some future GC. */
export declare function closeData(data: unknown): void;
/**
 * Texture records in typed arrays indexed by record id (spec 9.1). Id 0 is
 * GlBackend's white texture and is never handed out, so a record id is also
 * the op texture id the scene pass emits. A record carries its state, size,
 * reference and want counts, the owner list of the nodes that asked for it,
 * and, while it loads, its decoded data. The cache maps a key (an image's
 * src and options) to its record, so one source loads once.
 *
 * Loading and uploading are driven from outside: the loader takes records
 * from `nextQueued()` and reports `decoded()` or `failed()`, the uploader
 * takes them from `nextDecoded()` and reports `uploaded()`. Every per-frame
 * call (want, unwant, promote, the queues) is typed-array work with no
 * allocation and no string lookups.
 */
export declare class TextureStore {
    capacity: number;
    state: Uint8Array;
    kind: Uint8Array;
    flags: Uint8Array;
    /** Pixel size, once decoded (a SubTexture: its region's size). */
    w: Float64Array;
    h: Float64Array;
    /** The base UV rect's right and bottom edges: 1, or less for a block-padded compressed texture. */
    u2: Float64Array;
    v2: Float64Array;
    /**
     * References, not nodes: each node holds one on its source and one on
     * what it shows (two when they are this record), and a SubTexture one on
     * its parent.
     */
    refCount: Int32Array;
    /**
     * Wants, not nodes: the same two from each node in bounds and not hidden,
     * and one from each preloading node (spec 9.2).
     */
    wantCount: Int32Array;
    retryCount: Int32Array;
    maxRetryCount: Int32Array;
    /**
     * Bumped by every scheduled retry, so a stale timer finds it changed;
     * never reset, so a timer outliving its record cannot match the next
     * record in the slot either.
     */
    retryToken: Int32Array;
    /** GPU bytes while uploaded (1.10's estimate), else 0. */
    bytes: Float64Array;
    /** `time` at creation: the cleanup grace period counts from it. */
    createdAt: Float64Array;
    /**
     * Bumped when the record in the slot is removed (destroy), never reset: a
     * handle bound to an older generation knows its record is gone.
     */
    gen: Int32Array;
    /**
     * The LRU (spec 9.5): uploaded records nobody wants, least recently
     * wanted first (each joins at the tail when its last want ends).
     */
    lruPrev: Int32Array;
    lruNext: Int32Array;
    lruHead: number;
    /** Records nothing references (refCount 0), oldest first. */
    orphanPrev: Int32Array;
    orphanNext: Int32Array;
    orphanHead: number;
    /** A SubTexture's parent record; NULL otherwise. */
    parent: Int32Array;
    /** First node of the owner list (linked through the nodes' I_OWNER_NEXT / I_OWNER_PREV). */
    ownerHead: Int32Array;
    /** The source descriptor (ImageTexture or SubTexture props, a color, a size). */
    props: (object | null)[];
    /** Cache key, null for a record that is not cached. */
    keys: (string | null)[];
    /** Decoded data on its way to the GPU. */
    data: unknown[];
    errors: (Error | null)[];
    /** SubTexture records of a parent record, created on demand. */
    subs: (number[] | null)[];
    /** The public Texture handle, created on demand (Texture.ts). */
    handles: (object | null)[];
    readonly cache: Map<string, number>;
    /**
     * Records still on their way: queued, loading, decoded and waiting for
     * upload, or failed with a retry to come. The examples harness settles on
     * 0 (with no frame requested).
     */
    pending: number;
    /** Default maxRetryCount for records whose props do not set one. */
    maxRetries: number;
    /** Uploaded records and their bytes (memoryInfo, memUsed). */
    loadedCount: number;
    loadedBytes: number;
    /** Of those, the ones wanted (1.10's "renderable"). */
    wantedCount: number;
    wantedBytes: number;
    /**
     * Drawn frames (the Renderer counts them): a frame drawn since an idle
     * maintenance ends that idle period (MemoryManager).
     */
    frame: number;
    /** The clock (the Renderer: platform.now): memory cleanup reads it. */
    now: () => number;
    /**
     * The time a new record is stamped with (createdAt): the drawn frame's
     * (the Renderer writes it), so a walk creating records reads no clock; an
     * app's createTexture takes the clock (Texture.ts).
     */
    time: number;
    /** Deletes GL textures (the GL backend); null headless. */
    sink: {
        deleteTexture(id: number): void;
    } | null;
    /** A record finished uploading: TextureNodes moves its owners onto it. */
    onUploaded: (rec: number) => void;
    /** A load failed: `final` when no retry follows. */
    onFailed: (rec: number, final: boolean) => void;
    /** Memory cleanup freed an uploaded record (spec 9.5): its owners must reload it. */
    onFreed: (rec: number) => void;
    /**
     * A decoded record someone wants waits for room (doNotExceedCriticalThreshold):
     * its owners let go of the old image they still show (spec 9.4).
     */
    onHeld: (rec: number) => void;
    /**
     * A record was queued outside a frame (a retry; a font's atlas,
     * FontRegistry): the loader can start it now.
     */
    onQueued: () => void;
    /**
     * Runs a retry `ms` from now (the Renderer: platform.setTimeout). Null
     * (headless): every failure is final.
     */
    schedule: ((callback: () => void, ms: number) => void) | null;
    /** Decoded pixels arrived: a frame must run so that the uploader runs after its draw. */
    requestFrame: () => void;
    readonly nodes: NodeStore;
    private readonly viewQueue;
    private readonly marginQueue;
    /** Colour and noise records: generated, no fetch to put in order. */
    private readonly generatedQueue;
    private readonly uploadQueue;
    private nextFree;
    private freeHead;
    constructor(nodes: NodeStore);
    private resize;
    /**
     * A new idle record of `kind` for `props`, cached under `key` when one is
     * given. A SubTexture's record holds a reference on its parent.
     */
    create(kind: number, props: object, key: string | null, parent?: number): number;
    /** The record whose pixels `rec` shows: its parent for a SubTexture. */
    pixelsOf(rec: number): number;
    ref(rec: number): void;
    unref(rec: number): void;
    /**
     * One more want. The first want of an idle or freed record queues it,
     * in the viewport queue when the wanting node is in the viewport; a
     * viewport want on a record queued for the margin promotes it.
     */
    want(rec: number, viewport: boolean): void;
    unwant(rec: number): void;
    /**
     * preventCleanup on `rec` (spec 9.5): never freed while set, so kept out
     * of the LRU, which then holds only what a cleanup may free.
     */
    setPreventCleanup(rec: number, on: boolean): void;
    /** An uploaded record nobody wants joins the LRU, unless it is never freed. */
    private enterLru;
    /** A node wanting `rec` entered the viewport: load it ahead of the margin. */
    promote(rec: number): void;
    private enqueue;
    /**
     * The next colour or noise record to generate, now LOADING: no fetch, so
     * the loader makes it at once, behind no probe and no in-flight slot
     * (1.10). A record nobody wants any more is cancelled here (back to idle)
     * and skipped. NULL when none is queued.
     */
    nextGenerated(): number;
    /**
     * The next image record to load, now LOADING: viewport records first,
     * then the margin, each first come first served. A record nobody wants
     * any more is cancelled here (back to idle) and skipped. NULL when nothing
     * is queued.
     */
    nextQueued(): number;
    /**
     * A load finished: `data` is `w` x `h` pixels, straight alpha when
     * `glPremultiply` (WebGL premultiplies it on upload). A record nobody
     * wants by now is closed and returns to idle (spec 9.3); it reloads, from
     * the HTTP cache, if wanted again.
     */
    decoded(rec: number, data: unknown, w: number, h: number, glPremultiply: boolean): void;
    /**
     * A load failed with `error`. Until `maxRetryCount` retries have run, it
     * is tried again after retryDelay (spec 9.3); then it fails for good.
     */
    failed(rec: number, error: Error): void;
    /**
     * A decoded record the GPU cannot take (a compressed format with no
     * extension on this device): failed for good, no retry.
     */
    uploadFailed(rec: number, error: Error): void;
    /** Failed with no retry to come. */
    failedForGood(rec: number): boolean;
    /**
     * A retry is due: queued again if still wanted (in the queue its load
     * came from), otherwise idle (the next want queues it, its failures still
     * counted). Either way the error goes: 1.10 kept one only while failed.
     */
    private retry;
    /**
     * The next decoded record to upload, in arrival order, left in the queue.
     * A record nobody wants any more is closed, returned to idle and dropped
     * (spec 3: never upload what no node wants). NULL when none is waiting.
     */
    peekDecoded(): number;
    /**
     * Close the decoded records nobody wants any more and return them to
     * idle, keeping the others in arrival order: while uploads are held for
     * room (doNotExceedCriticalThreshold), none reaches peekDecoded to be
     * dropped there, and its pixels would stay at the ceiling the setting
     * protects. The ones kept are held (onHeld): a node mid-switch to one
     * lets go of the old image it still shows, which may be the only room a
     * cleanup can find for it. Returns how many still wait for upload.
     */
    releaseUnwantedDecoded(): number;
    /** peekDecoded, removed from the queue. */
    nextDecoded(): number;
    /** Send the record peekDecoded returned to the back of the queue. */
    rotateDecoded(): void;
    /** Decoded records waiting for upload. */
    get decodedCount(): number;
    /**
     * `rec`'s data reached the GPU, taking `bytes` of it: its owners draw it
     * from the next frame. Only wanted records are uploaded.
     */
    uploaded(rec: number, bytes: number): void;
    /**
     * Memory cleanup (spec 9.5): delete an unwanted record's GL texture and
     * keep the record, which reloads, from the HTTP cache, when wanted again.
     */
    free(rec: number): void;
    /**
     * Remove an orphan for good: its GL texture, cache entry and slot. A
     * handle that outlives it (id NULL, or a generation that changed) gets a
     * new record when used again (Texture.ts reviveTexture). Never a record
     * in flight.
     */
    destroy(rec: number): void;
    /** Delete `rec`'s GL texture (if uploaded) and stop counting its bytes. */
    private dropGpu;
    /** Append `rec` to the LRU (F_LRU) or the orphan list (F_ORPHAN). */
    private listAppend;
    private listRemove;
    /** Add node `id` to `rec`'s owner list. */
    addOwner(rec: number, id: number): void;
    /** Remove node `id` from `rec`'s owner list. */
    removeOwner(rec: number, id: number): void;
    /** Move `rec` to `state`, keeping `pending` in step. */
    private setPending;
}
