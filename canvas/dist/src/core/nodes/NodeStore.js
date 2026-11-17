import { DIRTY_ALPHA, DIRTY_CHILD, DIRTY_CLIP, DIRTY_COLOR, DIRTY_INHERITED, DIRTY_LOCAL, DIRTY_RENDERABLE, DIRTY_SHADER, NULL, ST_PRELOAD_QUEUED, } from './NodeFlags.js';
import { DIR_INHERIT, F_ALPHA, F_H, F_MOUNT_X, F_MOUNT_Y, F_PIVOT_X, F_PIVOT_Y, F_ROTATION, F_SCALE_X, F_SCALE_Y, F_STRIDE, F_TEX_H, F_TEX_W, F_W, F_WORLD_ALPHA, F_WTX, F_WTY, F_X, F_Y, F_Z_INDEX, I_CLIP, I_COLOR_BL, I_COLOR_BR, I_COLOR_TL, I_COLOR_TR, I_DIRECTION, I_DIRTY, I_FIRST_CHILD, I_LAST_CHILD, I_NEXT_FREE, I_OWNER_NEXT, I_OWNER_PREV, I_PARENT, I_PLACEHOLDER_COLOR, I_SHADER, I_SOURCE_TEXTURE, I_STATE, I_STRIDE, I_TEXTURE, I_UID, I_UV0, I_UV1, I_UV_X1, I_UV_X2, I_UV_Y1, I_UV_Y2, } from './NodeLayout.js';
const INITIAL_DIRTY = DIRTY_LOCAL |
    DIRTY_ALPHA |
    DIRTY_COLOR |
    DIRTY_CLIP |
    DIRTY_RENDERABLE |
    DIRTY_INHERITED;
/** The unit square's packed UV corners: `uv0` and `uv1` without a texture. */
export const UV_TL = 0; // u = 0, v = 0 packed as (v << 16) | u
export const UV_BR = 0xffffffff; // u = 65535, v = 65535
const WHITE = 0xffffffff;
function growF64(a, n) {
    const b = new Float64Array(n);
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
function growSide(a, n) {
    for (let i = a.length; i < n; i++) {
        a.push(null);
    }
}
/**
 * Equal, NaN equal to NaN, so that a size or a text box compared with the
 * one stored settles (a font size of 0 lays out a NaN width).
 */
export const same = (a, b) => a === b || (Number.isNaN(a) === true && Number.isNaN(b) === true);
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
export class NodeStore {
    constructor(capacity = 1024) {
        this.capacity = 0;
        this.liveCount = 0;
        /** Bumped at the end of every `resize()` (the constructor's included). */
        this.generation = 0;
        // side arrays, one slot per node, null when unused
        this.handles = [];
        this.shaderRefs = [];
        this.textureRefs = [];
        this.srcs = [];
        this.textureOptions = [];
        this.clipMargins = [];
        this.extras = [];
        this.data = [];
        this.animations = [];
        /**
         * The node's params block (ShaderRegistry.pack): immutable and shared by
         * reference with every node of the same type, props and size. Null for
         * Default.
         */
        this.params = [];
        /**
         * A text node's TextState (TextNode.ts): its text props, its layout and
         * TextNodes' bookkeeping; null for every other node.
         */
        this.texts = [];
        /**
         * Node.children's array: built on the first read after the node's child
         * list changes and shared by every read until the next change. Every
         * writer of the child links drops it (insertAfter, unlink, free); null
         * until read.
         */
        this.childArrays = [];
        /**
         * Nodes whose preload state or texture source changed while preloading,
         * for TextureNodes.drainPreloads (spec 9.2: preload is a want outside the
         * walk, which never visits a node under a culled ancestor). Guarded by
         * ST_PRELOAD_QUEUED so a node is listed once.
         */
        this.preloads = new Int32Array(16);
        this.preloadCount = 0;
        /** True once any node has pending dirty bits; the scene pass clears it. */
        this.anyDirty = false;
        /** Called on the false -> true transition of `anyDirty`. */
        this.onDirty = null;
        /**
         * markDirty calls since the scene pass zeroed it at the start of its last
         * walk, less the ones TextureNodes takes back: the texture size a leaf in
         * the margin takes in the walk, which its next visit applies (spec 6.1).
         */
        this.writes = 0;
        /**
         * While true (the scene pass sets it for the length of a walk), `free`
         * quarantines slots instead of returning them to the free list, until
         * `endDeferFree`. A slot freed during a walk (still on its stack, being
         * visited, or about to be swept) is then never handed to a node created in
         * the same walk, so `uid === 0` stays a complete "destroyed" test.
         */
        this.deferFree = false;
        this.freeHead = NULL;
        this.nextUid = 1;
        /** Quarantined slots, newest first, linked through `nextFree`. */
        this.quarantineHead = NULL;
        this.quarantineTail = NULL;
        this.resize(capacity < 1 ? 1 : capacity);
    }
    resize(capacity) {
        const old = this.capacity;
        this.f64 = growF64(this.f64, capacity * F_STRIDE);
        const buffer = new ArrayBuffer(capacity * I_STRIDE * 4);
        const i32 = new Int32Array(buffer);
        if (this.i32 !== undefined)
            i32.set(this.i32);
        this.i32 = i32;
        this.u32 = new Uint32Array(buffer);
        this.f32 = new Float32Array(buffer);
        this.prev = growI32(this.prev, capacity);
        this.next = growI32(this.next, capacity);
        growSide(this.handles, capacity);
        growSide(this.shaderRefs, capacity);
        growSide(this.textureRefs, capacity);
        growSide(this.srcs, capacity);
        growSide(this.textureOptions, capacity);
        growSide(this.clipMargins, capacity);
        growSide(this.extras, capacity);
        growSide(this.data, capacity);
        growSide(this.animations, capacity);
        growSide(this.params, capacity);
        growSide(this.texts, capacity);
        growSide(this.childArrays, capacity);
        // Link the new slots into the free list in ascending order, then the
        // previous free list after them.
        for (let i = old; i < capacity - 1; i++) {
            i32[i * I_STRIDE + I_NEXT_FREE] = i + 1;
        }
        i32[(capacity - 1) * I_STRIDE + I_NEXT_FREE] = this.freeHead;
        this.freeHead = old;
        this.capacity = capacity;
        this.generation++;
    }
    alloc() {
        if (this.freeHead === NULL) {
            this.resize(this.capacity * 2);
        }
        const id = this.freeHead;
        const i32 = this.i32;
        const u32 = this.u32;
        const f32 = this.f32;
        const o = id * I_STRIDE;
        this.freeHead = i32[o + I_NEXT_FREE];
        this.liveCount++;
        u32[o + I_DIRTY] = INITIAL_DIRTY;
        u32[o + I_STATE] = 0;
        i32[o + I_UID] = this.nextUid++;
        i32[o + I_PARENT] = NULL;
        i32[o + I_FIRST_CHILD] = NULL;
        i32[o + I_LAST_CHILD] = NULL;
        this.prev[id] = NULL;
        this.next[id] = NULL;
        i32[o + I_CLIP] = 0;
        // Not reset: I_PM_TL..I_PM_BR (see the f64 record below).
        u32[o + I_UV0] = UV_TL;
        u32[o + I_UV1] = UV_BR;
        i32[o + I_SHADER] = 0;
        i32[o + I_TEXTURE] = NULL;
        u32[o + I_COLOR_TL] = WHITE;
        u32[o + I_COLOR_TR] = WHITE;
        u32[o + I_COLOR_BL] = WHITE;
        u32[o + I_COLOR_BR] = WHITE;
        u32[o + I_PLACEHOLDER_COLOR] = 0;
        i32[o + I_SOURCE_TEXTURE] = NULL;
        i32[o + I_OWNER_NEXT] = NULL;
        i32[o + I_OWNER_PREV] = NULL;
        i32[o + I_DIRECTION] = DIR_INHERIT;
        f32[o + I_UV_X1] = 0;
        f32[o + I_UV_Y1] = 0;
        f32[o + I_UV_X2] = 1;
        f32[o + I_UV_Y2] = 1;
        const f = this.f64;
        const p = id * F_STRIDE;
        f[p + F_W] = 0;
        f[p + F_H] = 0;
        // Not reset: F_WA..F_WD, F_BX0..F_BY1 and the premultiplied colours
        // (I_PM_TL..I_PM_BR), 12 of the stores a node's creation paid for. The
        // scene pass writes them before any read:
        // INITIAL_DIRTY carries DIRTY_LOCAL, so a node's first visit runs
        // composeWorld (the matrix, written while ST_WORLD_TRANSLATE is still
        // clear in the reset state, and the bounds) and DIRTY_COLOR (the
        // premultiplied colors) before culling or emitting it, and nothing
        // outside the pass reads them. The derived fields that are kept below
        // have readers before that visit: worldAlpha is the previous value the
        // alpha step compares against (and the texture wants read), wtx/wty
        // feed the absX/absY getters, texW/texH the contain check.
        f[p + F_WTX] = 0;
        f[p + F_WTY] = 0;
        f[p + F_WORLD_ALPHA] = 1;
        f[p + F_Z_INDEX] = 0;
        f[p + F_TEX_W] = 0;
        f[p + F_TEX_H] = 0;
        f[p + F_X] = 0;
        f[p + F_Y] = 0;
        f[p + F_ALPHA] = 1;
        f[p + F_SCALE_X] = 1;
        f[p + F_SCALE_Y] = 1;
        f[p + F_ROTATION] = 0;
        f[p + F_MOUNT_X] = 0;
        f[p + F_MOUNT_Y] = 0;
        f[p + F_PIVOT_X] = 0.5;
        f[p + F_PIVOT_Y] = 0.5;
        return id;
    }
    /**
     * List `id` for TextureNodes.drainPreloads, once (ST_PRELOAD_QUEUED). The
     * texture input setters call it for a node with preload set.
     */
    queuePreload(id) {
        const state = this.u32[id * I_STRIDE + I_STATE];
        if ((state & ST_PRELOAD_QUEUED) !== 0) {
            return;
        }
        this.u32[id * I_STRIDE + I_STATE] = state | ST_PRELOAD_QUEUED;
        const n = this.preloadCount;
        if (n === this.preloads.length) {
            const grown = new Int32Array(n * 2);
            grown.set(this.preloads);
            this.preloads = grown;
        }
        this.preloads[n] = id;
        this.preloadCount = n + 1;
    }
    /**
     * Return `id` to the free list (to the quarantine while `deferFree` is
     * set). Preconditions: `id` is already unlinked from its parent, or is
     * being freed as part of a whole subtree teardown where the parent's own
     * links are being discarded too; never free the same id twice; never free
     * NULL.
     */
    free(id) {
        const i32 = this.i32;
        const u32 = this.u32;
        const o = id * I_STRIDE;
        i32[o + I_UID] = 0;
        u32[o + I_DIRTY] = 0;
        u32[o + I_STATE] = 0;
        i32[o + I_PARENT] = NULL;
        i32[o + I_FIRST_CHILD] = NULL;
        i32[o + I_LAST_CHILD] = NULL;
        this.prev[id] = NULL;
        this.next[id] = NULL;
        this.handles[id] = null;
        this.shaderRefs[id] = null;
        this.textureRefs[id] = null;
        this.srcs[id] = null;
        this.textureOptions[id] = null;
        this.clipMargins[id] = null;
        this.extras[id] = null;
        this.data[id] = null;
        this.animations[id] = null;
        this.params[id] = null;
        this.texts[id] = null;
        this.childArrays[id] = null;
        this.liveCount--;
        if (this.deferFree === true) {
            if (this.quarantineHead === NULL) {
                this.quarantineTail = id;
            }
            i32[o + I_NEXT_FREE] = this.quarantineHead;
            this.quarantineHead = id;
            return;
        }
        i32[o + I_NEXT_FREE] = this.freeHead;
        this.freeHead = id;
    }
    /**
     * Clear `deferFree` and put the quarantined slots at the head of the free
     * list, newest first, as if each had been freed without the quarantine.
     */
    endDeferFree() {
        this.deferFree = false;
        const head = this.quarantineHead;
        if (head === NULL) {
            return;
        }
        this.i32[this.quarantineTail * I_STRIDE + I_NEXT_FREE] = this.freeHead;
        this.freeHead = head;
        this.quarantineHead = NULL;
        this.quarantineTail = NULL;
    }
    /**
     * OR `bits` into the node, set DIRTY_CHILD on every ancestor until one
     * already has it, and raise `anyDirty`. Amortized O(1).
     *
     * DIRTY_CHILD is advisory: the walk stops at the first ancestor that
     * already has it, and the scene pass keeps it on culled nodes while
     * clearing it on visible ones, so an ancestor of a dirty node may lack
     * it. Never use it to skip visiting or updating a subtree.
     */
    markDirty(id, bits) {
        if (id === NULL) {
            return;
        }
        const u32 = this.u32;
        const i32 = this.i32;
        const o = id * I_STRIDE;
        u32[o + I_DIRTY] = u32[o + I_DIRTY] | bits;
        this.writes++;
        let p = i32[o + I_PARENT];
        while (p !== NULL) {
            const q = p * I_STRIDE;
            const d = u32[q + I_DIRTY];
            if ((d & DIRTY_CHILD) !== 0) {
                break;
            }
            u32[q + I_DIRTY] = d | DIRTY_CHILD;
            p = i32[q + I_PARENT];
        }
        if (this.anyDirty === false) {
            this.anyDirty = true;
            const onDirty = this.onDirty;
            if (onDirty !== null) {
                onDirty();
            }
        }
    }
    /**
     * Append `child` (which must be unlinked) under `parent`, keeping siblings
     * sorted by zIndex (stable: equal zIndex goes after existing siblings).
     */
    appendChild(parent, child) {
        const f64 = this.f64;
        const prev = this.prev;
        const z = f64[child * F_STRIDE + F_Z_INDEX];
        let after = this.i32[parent * I_STRIDE + I_LAST_CHILD];
        while (after !== NULL && f64[after * F_STRIDE + F_Z_INDEX] > z) {
            after = prev[after];
        }
        this.insertAfter(parent, child, after);
    }
    /**
     * Insert `child` (which must be unlinked) under `parent` before `before`,
     * one of its children (NULL appends, as appendChild). Siblings stay
     * sorted by zIndex: where `before`'s zIndex is not the child's, the child
     * goes to the nearest place that keeps them sorted.
     */
    insertBefore(parent, child, before) {
        if (before === NULL) {
            this.appendChild(parent, child);
            return;
        }
        const f64 = this.f64;
        const prev = this.prev;
        const next = this.next;
        const z = f64[child * F_STRIDE + F_Z_INDEX];
        let after = prev[before];
        while (after !== NULL && f64[after * F_STRIDE + F_Z_INDEX] > z) {
            after = prev[after];
        }
        let following = after === NULL
            ? this.i32[parent * I_STRIDE + I_FIRST_CHILD]
            : next[after];
        while (following !== NULL && f64[following * F_STRIDE + F_Z_INDEX] < z) {
            after = following;
            following = next[following];
        }
        this.insertAfter(parent, child, after);
    }
    insertAfter(parent, child, after) {
        this.childArrays[parent] = null;
        const i32 = this.i32;
        const prevs = this.prev;
        const nexts = this.next;
        const p = parent * I_STRIDE;
        i32[child * I_STRIDE + I_PARENT] = parent;
        prevs[child] = after;
        const next = after === NULL ? i32[p + I_FIRST_CHILD] : nexts[after];
        nexts[child] = next;
        if (after === NULL) {
            i32[p + I_FIRST_CHILD] = child;
        }
        else {
            nexts[after] = child;
        }
        if (next === NULL) {
            i32[p + I_LAST_CHILD] = child;
        }
        else {
            prevs[next] = child;
        }
    }
    /** Detach `child` from its parent's sibling list. No-op when unparented. */
    unlink(child) {
        const i32 = this.i32;
        const c = child * I_STRIDE;
        const parent = i32[c + I_PARENT];
        if (parent === NULL) {
            return;
        }
        this.childArrays[parent] = null;
        const prevs = this.prev;
        const nexts = this.next;
        const p = parent * I_STRIDE;
        const prev = prevs[child];
        const next = nexts[child];
        if (prev === NULL) {
            i32[p + I_FIRST_CHILD] = next;
        }
        else {
            nexts[prev] = next;
        }
        if (next === NULL) {
            i32[p + I_LAST_CHILD] = prev;
        }
        else {
            prevs[next] = prev;
        }
        i32[c + I_PARENT] = NULL;
        prevs[child] = NULL;
        nexts[child] = NULL;
    }
    /**
     * The writer of w/h besides the w and h setters (autosize): stores them
     * and raises DIRTY_LOCAL | DIRTY_SHADER, as every w/h change must. A
     * text's layout, which runs in the visit of the node it sizes, writes
     * through applySizeInVisit instead.
     */
    applySize(id, w, h) {
        const f64 = this.f64;
        const o = id * F_STRIDE;
        if (f64[o + F_W] === w && f64[o + F_H] === h) {
            return;
        }
        f64[o + F_W] = w;
        f64[o + F_H] = h;
        this.markDirty(id, DIRTY_LOCAL | DIRTY_SHADER);
    }
    /**
     * A size a scene pass hook writes for the node being visited (phase 5's
     * text layout, which runs before the visit composes the node): stores
     * w and h and returns the bits a size change raises, DIRTY_LOCAL |
     * DIRTY_SHADER (0 when unchanged, NaN equal to NaN), for the visit to
     * take at once. Not markDirty: the parent chain and the walk's write
     * count stay untouched, so the new size is composed and drawn in this
     * walk without a re-walk. Every other writer uses applySize.
     */
    applySizeInVisit(id, w, h) {
        const f64 = this.f64;
        const o = id * F_STRIDE;
        if (same(f64[o + F_W], w) === true && same(f64[o + F_H], h) === true) {
            return 0;
        }
        f64[o + F_W] = w;
        f64[o + F_H] = h;
        return DIRTY_LOCAL | DIRTY_SHADER;
    }
    /** Change a node's zIndex and re-insert it among its siblings. */
    setZIndex(child, z) {
        if (Number.isFinite(z) === false) {
            z = 0;
        }
        const zi = child * F_STRIDE + F_Z_INDEX;
        if (this.f64[zi] === z) {
            return;
        }
        const parent = this.i32[child * I_STRIDE + I_PARENT];
        if (parent === NULL) {
            this.f64[zi] = z;
            return;
        }
        this.unlink(child);
        this.f64[zi] = z;
        this.appendChild(parent, child);
        // Draw order changed: a frame is needed even though no state bit is dirty.
        this.markDirty(child, 0);
    }
}
//# sourceMappingURL=NodeStore.js.map