import { NULL } from '../nodes/NodeFlags.js';
import { I_OWNER_NEXT, I_OWNER_PREV, I_STRIDE } from '../nodes/NodeLayout.js';
// Record states (spec 9.1): idle -> queued -> loading -> decoded -> uploaded,
// plus failed and freed; freed -> queued on demand.
export const TX_IDLE = 0;
export const TX_QUEUED = 1;
export const TX_LOADING = 2;
export const TX_DECODED = 3;
export const TX_UPLOADED = 4;
export const TX_FAILED = 5;
export const TX_FREED = 6;
// Record kinds: where the pixels come from.
export const KIND_IMAGE = 0;
export const KIND_COLOR = 1;
export const KIND_NOISE = 2;
/** A SubTexture: no pixels of its own, a region of its `parent` record. */
export const KIND_SUB = 3;
// Record flags.
/** Never evicted (textureOptions.preventCleanup, Texture.preventCleanup). */
export const F_PREVENT_CLEANUP = 1;
/** The decoded data is straight alpha: WebGL premultiplies on upload. */
export const F_GL_PREMULTIPLY = 2;
/** In the viewport queue; for a colour or noise record, in the generated queue. */
const F_VIEW_QUEUED = 4;
const F_MARGIN_QUEUED = 8;
/** Counted in `pending`: queued, loading, decoded, or failed with a retry to come. */
const F_PENDING = 16;
/** Its last load came from the viewport queue, so a retry goes back there. */
const F_VIEW_LOAD = 32;
const F_LRU = 64;
const F_ORPHAN = 128;
/**
 * Backoff for a failed load (spec 9.3): the n-th retry starts 2^(n - 1)
 * frame periods after the n-th failure (17, 33, 67, 133 and 267 ms for the
 * default 5 retries, about half a second in all), at most 2^10 (about 17 s,
 * far below setTimeout's 2^31 ms limit). Timed, not counted in frames: the
 * loop sleeps when nothing changes, so a frame count could stall.
 */
export const retryDelay = (failures) => (1000 / 60) * (1 << Math.min(failures - 1, 10));
/** A queue of record ids: an Int32Array ring that doubles when full. */
class IdQueue {
    constructor() {
        this.ids = new Int32Array(64);
        this.head = 0;
        this.count = 0;
    }
    push(id) {
        let ids = this.ids;
        if (this.count === ids.length) {
            const grown = new Int32Array(ids.length * 2);
            for (let i = 0; i < this.count; i++) {
                grown[i] = ids[(this.head + i) % ids.length];
            }
            this.ids = ids = grown;
            this.head = 0;
        }
        ids[(this.head + this.count) % ids.length] = id;
        this.count++;
    }
    /** The oldest id, left in place; only when count > 0. */
    first() {
        return this.ids[this.head];
    }
    /** The oldest id, removed; only when count > 0. */
    shift() {
        const id = this.ids[this.head];
        this.head = (this.head + 1) % this.ids.length;
        this.count--;
        return id;
    }
}
function growU8(a, n) {
    const b = new Uint8Array(n);
    if (a !== undefined)
        b.set(a);
    return b;
}
function growI32(a, n) {
    const b = new Int32Array(n);
    if (a !== undefined)
        b.set(a);
    return b;
}
function growF64(a, n) {
    const b = new Float64Array(n);
    if (a !== undefined)
        b.set(a);
    return b;
}
function growSide(a, n) {
    for (let i = a.length; i < n; i++) {
        a.push(null);
    }
}
/** Release a decoded image's native memory now rather than at some future GC. */
export function closeData(data) {
    if (data !== null &&
        typeof data === 'object' &&
        typeof data.close === 'function') {
        data.close();
    }
}
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
export class TextureStore {
    constructor(nodes) {
        this.capacity = 0;
        this.lruHead = NULL;
        this.orphanHead = NULL;
        /** The source descriptor (ImageTexture or SubTexture props, a color, a size). */
        this.props = [];
        /** Cache key, null for a record that is not cached. */
        this.keys = [];
        /** Decoded data on its way to the GPU. */
        this.data = [];
        this.errors = [];
        /** SubTexture records of a parent record, created on demand. */
        this.subs = [];
        /** The public Texture handle, created on demand (Texture.ts). */
        this.handles = [];
        this.cache = new Map();
        /**
         * Records still on their way: queued, loading, decoded and waiting for
         * upload, or failed with a retry to come. The examples harness settles on
         * 0 (with no frame requested).
         */
        this.pending = 0;
        /** Default maxRetryCount for records whose props do not set one. */
        this.maxRetries = 5;
        /** Uploaded records and their bytes (memoryInfo, memUsed). */
        this.loadedCount = 0;
        this.loadedBytes = 0;
        /** Of those, the ones wanted (1.10's "renderable"). */
        this.wantedCount = 0;
        this.wantedBytes = 0;
        /**
         * Drawn frames (the Renderer counts them): a frame drawn since an idle
         * maintenance ends that idle period (MemoryManager).
         */
        this.frame = 0;
        /** The clock (the Renderer: platform.now): memory cleanup reads it. */
        this.now = () => 0;
        /**
         * The time a new record is stamped with (createdAt): the drawn frame's
         * (the Renderer writes it), so a walk creating records reads no clock; an
         * app's createTexture takes the clock (Texture.ts).
         */
        this.time = 0;
        /** Deletes GL textures (the GL backend); null headless. */
        this.sink = null;
        /** A record finished uploading: TextureNodes moves its owners onto it. */
        this.onUploaded = () => { };
        /** A load failed: `final` when no retry follows. */
        this.onFailed = () => { };
        /** Memory cleanup freed an uploaded record (spec 9.5): its owners must reload it. */
        this.onFreed = () => { };
        /**
         * A decoded record someone wants waits for room (doNotExceedCriticalThreshold):
         * its owners let go of the old image they still show (spec 9.4).
         */
        this.onHeld = () => { };
        /**
         * A record was queued outside a frame (a retry; a font's atlas,
         * FontRegistry): the loader can start it now.
         */
        this.onQueued = () => { };
        /**
         * Runs a retry `ms` from now (the Renderer: platform.setTimeout). Null
         * (headless): every failure is final.
         */
        this.schedule = null;
        /** Decoded pixels arrived: a frame must run so that the uploader runs after its draw. */
        this.requestFrame = () => { };
        this.viewQueue = new IdQueue();
        this.marginQueue = new IdQueue();
        /** Colour and noise records: generated, no fetch to put in order. */
        this.generatedQueue = new IdQueue();
        this.uploadQueue = new IdQueue();
        this.freeHead = NULL;
        this.nodes = nodes;
        this.resize(64);
        // Id 0 is the white texture: take it out of the free list for good.
        this.freeHead = this.nextFree[0];
    }
    resize(capacity) {
        const old = this.capacity;
        this.state = growU8(this.state, capacity);
        this.kind = growU8(this.kind, capacity);
        this.flags = growU8(this.flags, capacity);
        this.w = growF64(this.w, capacity);
        this.h = growF64(this.h, capacity);
        this.u2 = growF64(this.u2, capacity);
        this.v2 = growF64(this.v2, capacity);
        this.refCount = growI32(this.refCount, capacity);
        this.wantCount = growI32(this.wantCount, capacity);
        this.retryCount = growI32(this.retryCount, capacity);
        this.maxRetryCount = growI32(this.maxRetryCount, capacity);
        this.retryToken = growI32(this.retryToken, capacity);
        this.bytes = growF64(this.bytes, capacity);
        this.createdAt = growF64(this.createdAt, capacity);
        this.gen = growI32(this.gen, capacity);
        this.lruPrev = growI32(this.lruPrev, capacity);
        this.lruNext = growI32(this.lruNext, capacity);
        this.orphanPrev = growI32(this.orphanPrev, capacity);
        this.orphanNext = growI32(this.orphanNext, capacity);
        this.parent = growI32(this.parent, capacity);
        this.ownerHead = growI32(this.ownerHead, capacity);
        this.nextFree = growI32(this.nextFree, capacity);
        growSide(this.props, capacity);
        growSide(this.keys, capacity);
        growSide(this.data, capacity);
        growSide(this.errors, capacity);
        growSide(this.subs, capacity);
        growSide(this.handles, capacity);
        for (let i = old; i < capacity - 1; i++) {
            this.nextFree[i] = i + 1;
        }
        this.nextFree[capacity - 1] = this.freeHead;
        this.freeHead = old;
        this.capacity = capacity;
    }
    /**
     * A new idle record of `kind` for `props`, cached under `key` when one is
     * given. A SubTexture's record holds a reference on its parent.
     */
    create(kind, props, key, parent = NULL) {
        if (this.freeHead === NULL) {
            this.resize(this.capacity * 2);
        }
        const rec = this.freeHead;
        this.freeHead = this.nextFree[rec];
        this.state[rec] = TX_IDLE;
        this.kind[rec] = kind;
        this.flags[rec] = 0;
        this.w[rec] = 0;
        this.h[rec] = 0;
        this.u2[rec] = 1;
        this.v2[rec] = 1;
        this.refCount[rec] = 0;
        this.wantCount[rec] = 0;
        this.retryCount[rec] = 0;
        this.bytes[rec] = 0;
        this.createdAt[rec] = this.time;
        const max = props.maxRetryCount;
        this.maxRetryCount[rec] = max === undefined ? this.maxRetries : max;
        this.parent[rec] = parent;
        this.ownerHead[rec] = NULL;
        this.props[rec] = props;
        this.keys[rec] = key;
        this.handles[rec] = null;
        // Nothing references it yet: an orphan until a node or a SubTexture does.
        this.listAppend(rec, F_ORPHAN);
        if (key !== null) {
            this.cache.set(key, rec);
        }
        if (parent !== NULL) {
            this.ref(parent);
            let subs = this.subs[parent];
            if (subs === null) {
                subs = this.subs[parent] = [];
            }
            subs.push(rec);
        }
        return rec;
    }
    /** The record whose pixels `rec` shows: its parent for a SubTexture. */
    pixelsOf(rec) {
        return this.kind[rec] === KIND_SUB ? this.parent[rec] : rec;
    }
    ref(rec) {
        const n = this.refCount[rec] + 1;
        this.refCount[rec] = n;
        if (n === 1) {
            this.listRemove(rec, F_ORPHAN);
        }
    }
    unref(rec) {
        const n = this.refCount[rec] - 1;
        this.refCount[rec] = n;
        if (n === 0) {
            this.listAppend(rec, F_ORPHAN);
        }
    }
    /**
     * One more want. The first want of an idle or freed record queues it,
     * in the viewport queue when the wanting node is in the viewport; a
     * viewport want on a record queued for the margin promotes it.
     */
    want(rec, viewport) {
        const n = this.wantCount[rec] + 1;
        this.wantCount[rec] = n;
        const state = this.state[rec];
        if (n === 1 && state === TX_UPLOADED) {
            this.listRemove(rec, F_LRU);
            this.wantedCount++;
            this.wantedBytes += this.bytes[rec];
        }
        if (state === TX_IDLE || state === TX_FREED) {
            this.setPending(rec, TX_QUEUED, true);
            this.enqueue(rec, viewport);
        }
        else if (state === TX_QUEUED && viewport === true) {
            this.enqueue(rec, true);
        }
    }
    unwant(rec) {
        const n = this.wantCount[rec] - 1;
        this.wantCount[rec] = n;
        if (n === 0 && this.state[rec] === TX_UPLOADED) {
            this.wantedCount--;
            this.wantedBytes -= this.bytes[rec];
            this.enterLru(rec);
        }
    }
    /**
     * preventCleanup on `rec` (spec 9.5): never freed while set, so kept out
     * of the LRU, which then holds only what a cleanup may free.
     */
    setPreventCleanup(rec, on) {
        const flags = this.flags[rec];
        if (on === true) {
            this.flags[rec] = flags | F_PREVENT_CLEANUP;
            this.listRemove(rec, F_LRU);
            return;
        }
        if ((flags & F_PREVENT_CLEANUP) === 0) {
            return;
        }
        this.flags[rec] = flags & ~F_PREVENT_CLEANUP;
        if (this.wantCount[rec] === 0 && this.state[rec] === TX_UPLOADED) {
            this.enterLru(rec);
        }
    }
    /** An uploaded record nobody wants joins the LRU, unless it is never freed. */
    enterLru(rec) {
        if (this.kind[rec] === KIND_COLOR ||
            (this.flags[rec] & F_PREVENT_CLEANUP) !== 0) {
            return;
        }
        this.listAppend(rec, F_LRU);
    }
    /** A node wanting `rec` entered the viewport: load it ahead of the margin. */
    promote(rec) {
        if (this.state[rec] === TX_QUEUED) {
            this.enqueue(rec, true);
        }
    }
    enqueue(rec, viewport) {
        const flags = this.flags[rec];
        // Generated pixels wait for no fetch: no viewport order to keep.
        if (this.kind[rec] !== KIND_IMAGE) {
            if ((flags & F_VIEW_QUEUED) === 0) {
                this.flags[rec] = flags | F_VIEW_QUEUED;
                this.generatedQueue.push(rec);
            }
            return;
        }
        if (viewport === true) {
            if ((flags & F_VIEW_QUEUED) === 0) {
                this.flags[rec] = flags | F_VIEW_QUEUED;
                this.viewQueue.push(rec);
            }
        }
        else if ((flags & F_MARGIN_QUEUED) === 0) {
            this.flags[rec] = flags | F_MARGIN_QUEUED;
            this.marginQueue.push(rec);
        }
    }
    /**
     * The next colour or noise record to generate, now LOADING: no fetch, so
     * the loader makes it at once, behind no probe and no in-flight slot
     * (1.10). A record nobody wants any more is cancelled here (back to idle)
     * and skipped. NULL when none is queued.
     */
    nextGenerated() {
        const queue = this.generatedQueue;
        while (queue.count > 0) {
            const rec = queue.shift();
            this.flags[rec] = this.flags[rec] & ~F_VIEW_QUEUED;
            if (this.state[rec] !== TX_QUEUED) {
                continue;
            }
            if (this.wantCount[rec] === 0) {
                this.setPending(rec, TX_IDLE, false);
                continue;
            }
            this.state[rec] = TX_LOADING;
            return rec;
        }
        return NULL;
    }
    /**
     * The next image record to load, now LOADING: viewport records first,
     * then the margin, each first come first served. A record nobody wants
     * any more is cancelled here (back to idle) and skipped. NULL when nothing
     * is queued.
     */
    nextQueued() {
        for (;;) {
            let rec;
            let view = false;
            if (this.viewQueue.count > 0) {
                rec = this.viewQueue.shift();
                this.flags[rec] = this.flags[rec] & ~F_VIEW_QUEUED;
                view = true;
            }
            else if (this.marginQueue.count > 0) {
                rec = this.marginQueue.shift();
                this.flags[rec] = this.flags[rec] & ~F_MARGIN_QUEUED;
            }
            else {
                return NULL;
            }
            // Already taken through the other queue, or cancelled earlier.
            if (this.state[rec] !== TX_QUEUED) {
                continue;
            }
            if (this.wantCount[rec] === 0) {
                this.setPending(rec, TX_IDLE, false);
                continue;
            }
            this.state[rec] = TX_LOADING;
            const flags = this.flags[rec];
            this.flags[rec] =
                view === true ? flags | F_VIEW_LOAD : flags & ~F_VIEW_LOAD;
            return rec;
        }
    }
    /**
     * A load finished: `data` is `w` x `h` pixels, straight alpha when
     * `glPremultiply` (WebGL premultiplies it on upload). A record nobody
     * wants by now is closed and returns to idle (spec 9.3); it reloads, from
     * the HTTP cache, if wanted again.
     */
    decoded(rec, data, w, h, glPremultiply) {
        if (this.state[rec] !== TX_LOADING) {
            closeData(data);
            return;
        }
        this.w[rec] = w;
        this.h[rec] = h;
        if (this.wantCount[rec] === 0) {
            closeData(data);
            this.setPending(rec, TX_IDLE, false);
            return;
        }
        this.data[rec] = data;
        const flags = this.flags[rec] & ~F_GL_PREMULTIPLY;
        this.flags[rec] = glPremultiply === true ? flags | F_GL_PREMULTIPLY : flags;
        this.state[rec] = TX_DECODED;
        this.uploadQueue.push(rec);
        this.requestFrame();
    }
    /**
     * A load failed with `error`. Until `maxRetryCount` retries have run, it
     * is tried again after retryDelay (spec 9.3); then it fails for good.
     */
    failed(rec, error) {
        if (this.state[rec] !== TX_LOADING) {
            return;
        }
        this.errors[rec] = error;
        const failures = this.retryCount[rec] + 1;
        this.retryCount[rec] = failures;
        const schedule = this.schedule;
        if (failures <= this.maxRetryCount[rec] && schedule !== null) {
            this.setPending(rec, TX_FAILED, true);
            const token = this.retryToken[rec] + 1;
            this.retryToken[rec] = token;
            schedule(() => {
                this.retry(rec, token);
            }, retryDelay(failures));
            this.onFailed(rec, false);
            return;
        }
        this.setPending(rec, TX_FAILED, false);
        this.onFailed(rec, true);
    }
    /**
     * A decoded record the GPU cannot take (a compressed format with no
     * extension on this device): failed for good, no retry.
     */
    uploadFailed(rec, error) {
        closeData(this.data[rec]);
        this.data[rec] = null;
        this.errors[rec] = error;
        this.setPending(rec, TX_FAILED, false);
        this.onFailed(rec, true);
    }
    /** Failed with no retry to come. */
    failedForGood(rec) {
        return (this.state[rec] === TX_FAILED && (this.flags[rec] & F_PENDING) === 0);
    }
    /**
     * A retry is due: queued again if still wanted (in the queue its load
     * came from), otherwise idle (the next want queues it, its failures still
     * counted). Either way the error goes: 1.10 kept one only while failed.
     */
    retry(rec, token) {
        if (this.retryToken[rec] !== token || this.state[rec] !== TX_FAILED) {
            return;
        }
        this.errors[rec] = null;
        if (this.wantCount[rec] === 0) {
            this.setPending(rec, TX_IDLE, false);
            return;
        }
        this.state[rec] = TX_QUEUED;
        this.enqueue(rec, (this.flags[rec] & F_VIEW_LOAD) !== 0);
        this.onQueued();
    }
    /**
     * The next decoded record to upload, in arrival order, left in the queue.
     * A record nobody wants any more is closed, returned to idle and dropped
     * (spec 3: never upload what no node wants). NULL when none is waiting.
     */
    peekDecoded() {
        const queue = this.uploadQueue;
        while (queue.count > 0) {
            const rec = queue.first();
            if (this.state[rec] !== TX_DECODED) {
                queue.shift();
                continue;
            }
            if (this.wantCount[rec] === 0) {
                queue.shift();
                closeData(this.data[rec]);
                this.data[rec] = null;
                this.setPending(rec, TX_IDLE, false);
                continue;
            }
            return rec;
        }
        return NULL;
    }
    /**
     * Close the decoded records nobody wants any more and return them to
     * idle, keeping the others in arrival order: while uploads are held for
     * room (doNotExceedCriticalThreshold), none reaches peekDecoded to be
     * dropped there, and its pixels would stay at the ceiling the setting
     * protects. The ones kept are held (onHeld): a node mid-switch to one
     * lets go of the old image it still shows, which may be the only room a
     * cleanup can find for it. Returns how many still wait for upload.
     */
    releaseUnwantedDecoded() {
        const queue = this.uploadQueue;
        for (let n = queue.count; n > 0; n--) {
            const rec = queue.shift();
            if (this.state[rec] !== TX_DECODED) {
                continue;
            }
            if (this.wantCount[rec] === 0) {
                closeData(this.data[rec]);
                this.data[rec] = null;
                this.setPending(rec, TX_IDLE, false);
                continue;
            }
            this.onHeld(rec);
            queue.push(rec);
        }
        return queue.count;
    }
    /** peekDecoded, removed from the queue. */
    nextDecoded() {
        const rec = this.peekDecoded();
        if (rec !== NULL) {
            this.uploadQueue.shift();
        }
        return rec;
    }
    /** Send the record peekDecoded returned to the back of the queue. */
    rotateDecoded() {
        const queue = this.uploadQueue;
        queue.push(queue.shift());
    }
    /** Decoded records waiting for upload. */
    get decodedCount() {
        return this.uploadQueue.count;
    }
    /**
     * `rec`'s data reached the GPU, taking `bytes` of it: its owners draw it
     * from the next frame. Only wanted records are uploaded.
     */
    uploaded(rec, bytes) {
        closeData(this.data[rec]);
        this.data[rec] = null;
        this.bytes[rec] = bytes;
        this.loadedCount++;
        this.loadedBytes += bytes;
        this.wantedCount++;
        this.wantedBytes += bytes;
        this.setPending(rec, TX_UPLOADED, false);
        this.onUploaded(rec);
    }
    /**
     * Memory cleanup (spec 9.5): delete an unwanted record's GL texture and
     * keep the record, which reloads, from the HTTP cache, when wanted again.
     */
    free(rec) {
        this.dropGpu(rec);
        this.state[rec] = TX_FREED;
        this.onFreed(rec);
    }
    /**
     * Remove an orphan for good: its GL texture, cache entry and slot. A
     * handle that outlives it (id NULL, or a generation that changed) gets a
     * new record when used again (Texture.ts reviveTexture). Never a record
     * in flight.
     */
    destroy(rec) {
        this.dropGpu(rec);
        this.listRemove(rec, F_ORPHAN);
        const key = this.keys[rec];
        if (key !== null && this.cache.get(key) === rec) {
            this.cache.delete(key);
        }
        closeData(this.data[rec]);
        const parent = this.parent[rec];
        if (parent !== NULL) {
            const subs = this.subs[parent];
            subs.splice(subs.indexOf(rec), 1);
            this.unref(parent);
        }
        const handle = this.handles[rec];
        if (handle !== null) {
            handle.id = NULL;
        }
        this.data[rec] = null;
        this.props[rec] = null;
        this.keys[rec] = null;
        this.errors[rec] = null;
        this.subs[rec] = null;
        this.handles[rec] = null;
        this.state[rec] = TX_IDLE;
        this.flags[rec] = 0;
        this.retryToken[rec] = this.retryToken[rec] + 1;
        this.gen[rec] = this.gen[rec] + 1;
        this.nextFree[rec] = this.freeHead;
        this.freeHead = rec;
    }
    /** Delete `rec`'s GL texture (if uploaded) and stop counting its bytes. */
    dropGpu(rec) {
        if (this.state[rec] !== TX_UPLOADED) {
            return;
        }
        if (this.sink !== null) {
            this.sink.deleteTexture(rec);
        }
        const bytes = this.bytes[rec];
        this.loadedCount--;
        this.loadedBytes -= bytes;
        if (this.wantCount[rec] > 0) {
            this.wantedCount--;
            this.wantedBytes -= bytes;
        }
        this.bytes[rec] = 0;
        this.listRemove(rec, F_LRU);
    }
    /** Append `rec` to the LRU (F_LRU) or the orphan list (F_ORPHAN). */
    listAppend(rec, list) {
        const flags = this.flags[rec];
        if ((flags & list) !== 0) {
            return;
        }
        this.flags[rec] = flags | list;
        const lru = list === F_LRU;
        const prev = lru === true ? this.lruPrev : this.orphanPrev;
        const next = lru === true ? this.lruNext : this.orphanNext;
        const head = lru === true ? this.lruHead : this.orphanHead;
        next[rec] = NULL;
        if (head === NULL) {
            prev[rec] = rec; // a one-entry list: its own tail
            if (lru === true) {
                this.lruHead = rec;
            }
            else {
                this.orphanHead = rec;
            }
            return;
        }
        // The head's prev is the tail (a circular back link).
        const tail = prev[head];
        next[tail] = rec;
        prev[rec] = tail;
        prev[head] = rec;
    }
    listRemove(rec, list) {
        const flags = this.flags[rec];
        if ((flags & list) === 0) {
            return;
        }
        this.flags[rec] = flags & ~list;
        const lru = list === F_LRU;
        const prev = lru === true ? this.lruPrev : this.orphanPrev;
        const next = lru === true ? this.lruNext : this.orphanNext;
        const head = lru === true ? this.lruHead : this.orphanHead;
        const after = next[rec];
        if (rec === head) {
            if (after !== NULL) {
                prev[after] = prev[rec]; // the new head keeps the tail link
            }
            if (lru === true) {
                this.lruHead = after;
            }
            else {
                this.orphanHead = after;
            }
            return;
        }
        const before = prev[rec];
        next[before] = after;
        if (after === NULL) {
            prev[head] = before; // rec was the tail
        }
        else {
            prev[after] = before;
        }
    }
    /** Add node `id` to `rec`'s owner list. */
    addOwner(rec, id) {
        const s = this.nodes;
        const head = this.ownerHead[rec];
        s.i32[id * I_STRIDE + I_OWNER_PREV] = NULL;
        s.i32[id * I_STRIDE + I_OWNER_NEXT] = head;
        if (head !== NULL) {
            s.i32[head * I_STRIDE + I_OWNER_PREV] = id;
        }
        this.ownerHead[rec] = id;
    }
    /** Remove node `id` from `rec`'s owner list. */
    removeOwner(rec, id) {
        const s = this.nodes;
        const prev = s.i32[id * I_STRIDE + I_OWNER_PREV];
        const next = s.i32[id * I_STRIDE + I_OWNER_NEXT];
        if (prev === NULL) {
            this.ownerHead[rec] = next;
        }
        else {
            s.i32[prev * I_STRIDE + I_OWNER_NEXT] = next;
        }
        if (next !== NULL) {
            s.i32[next * I_STRIDE + I_OWNER_PREV] = prev;
        }
        s.i32[id * I_STRIDE + I_OWNER_PREV] = NULL;
        s.i32[id * I_STRIDE + I_OWNER_NEXT] = NULL;
    }
    /** Move `rec` to `state`, keeping `pending` in step. */
    setPending(rec, state, pending) {
        this.state[rec] = state;
        const flags = this.flags[rec];
        const was = (flags & F_PENDING) !== 0;
        if (pending === was) {
            return;
        }
        this.flags[rec] = pending === true ? flags | F_PENDING : flags & ~F_PENDING;
        this.pending += pending === true ? 1 : -1;
    }
}
//# sourceMappingURL=TextureStore.js.map