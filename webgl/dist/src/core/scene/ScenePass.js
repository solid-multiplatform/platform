import { premultiplyColorABGR } from '../../common/color.js';
import { EMIT_BOUNDS_EVENTS } from '../../common/flags.js';
import { composeWorld } from './transform.js';
import { DIRTY_ALPHA, DIRTY_CHILD, DIRTY_CLIP, DIRTY_COLOR, DIRTY_DIRECTION, DIRTY_INHERITED, DIRTY_LAYOUT, DIRTY_LOCAL, DIRTY_RENDERABLE, DIRTY_SHADER, DIRTY_TEXTURE, INH_ALL, INH_ALPHA, INH_CLIP, INH_DIRECTION, INH_TRANSFORM, NULL, ST_ALPHA_CULLED, ST_CHILDREN_STALE, ST_CLIPS, ST_CONTENT_READY, ST_DEFER_SHADER, ST_DEFER_TEXTURE, ST_DEFERRED, ST_HAS_COLOR, ST_HIDDEN, ST_IGNORE_PARENT_ALPHA, ST_PER_OP, ST_PLACEHOLDER, ST_RENDERABLE, ST_RTL, ST_TEXT, ST_TEXT_READY, ST_VIS_MASK, ST_VIS_SHIFT, ST_WORLD_TRANSLATE, VIS_IN_BOUNDS, VIS_IN_VIEWPORT, VIS_INIT, VIS_OUT, withVisibility, } from '../nodes/NodeFlags.js';
import { DIR_INHERIT, DIR_RTL, F_ALPHA, F_BX0, F_BX1, F_BY0, F_BY1, F_H, F_STRIDE, F_W, F_WA, F_WB, F_WC, F_WD, F_WORLD_ALPHA, F_WTX, F_WTY, F_Z_INDEX, I_CLIP, I_COLOR_BL, I_COLOR_BR, I_COLOR_TL, I_COLOR_TR, I_DIRECTION, I_DIRTY, I_LAST_CHILD, I_PARENT, I_PLACEHOLDER_COLOR, I_PM_BL, I_PM_BR, I_PM_TL, I_PM_TR, I_SHADER, I_STATE, I_STRIDE, I_TEXTURE, I_UID, I_UV_X1, I_UV_X2, I_UV_Y1, I_UV_Y2, } from '../nodes/NodeLayout.js';
export function nullHooks() {
    return {
        resolveTexture() { },
        packShader() { },
        layoutText() {
            return -1;
        },
        emitText() { },
        onVisibility() { },
        onHidden() {
            return false;
        },
        onShown() { },
        perOpMatch() {
            return true;
        },
        onRenderable() { },
    };
}
/**
 * One iterative depth-first walk per frame: update dirty nodes, cull, emit.
 * See spec section 6.
 *
 * Hooks may write to any node, create nodes (growing the store, which
 * replaces every typed array) and destroy nodes. So every store array is
 * read through `this.nodes` after a hook call, never through a local held
 * across one, and a node's `dirty` and `state` words are never assigned
 * back from values read before a hook ran. Slots freed during a walk are
 * quarantined until it ends (`NodeStore.deferFree`), so `uid === 0` tells
 * a destroyed node apart even when a hook creates nodes after destroying.
 */
export class ScenePass {
    constructor(nodes, clips, view, stream, ops, hooks, flush, textures = null) {
        this.visited = 0;
        this.updated = 0;
        this.emitted = 0;
        /**
         * The text nodes the walk emitted (queued and flushed), counted per
         * flush: `emitted` counts them too, once each.
         */
        this.textEmitted = 0;
        this.stack = new Int32Array(1024);
        this.maskStack = new Uint32Array(1024);
        this.sweepStack = new Int32Array(1024);
        /** Text nodes queued by this walk, in walk order (spec 7.3). */
        this.pendingText = new Int32Array(64);
        this.pendingCount = 0;
        this.textures = textures;
        this.nodes = nodes;
        this.clips = clips;
        this.view = view;
        this.stream = stream;
        this.ops = ops;
        this.hooks = hooks;
        this.flush = flush;
    }
    /**
     * markDirty calls since the current (or last) walk started, including
     * ones made by callbacks after it: `run` zeroes the store's counter.
     * Less the ones TextureNodes takes back: a texture size a leaf in the
     * bounds margin takes in the walk (it is not drawn this frame either
     * way, and its next visit composes it with the size before it can be
     * drawn: spec 6.1).
     */
    get writesDuringPass() {
        return this.nodes.writes;
    }
    /**
     * The quads the last walk wrote, chunks it flushed included, glyph quads
     * not: telemetry's `quads` (1.10 kept glyphs in a buffer of their own and
     * did not count them). Derived from the counters, so no quad pays for it.
     */
    get quads() {
        return this.emitted - this.textEmitted;
    }
    run(root) {
        const s = this.nodes;
        this.visited = 0;
        this.updated = 0;
        this.emitted = 0;
        this.textEmitted = 0;
        // A walk that threw left its queue behind; this walk re-collects.
        this.pendingCount = 0;
        // Counted per walk rather than as a running total, so the counter never
        // grows without bound (and never leaves the Smi range on 32-bit).
        s.writes = 0;
        s.anyDirty = false;
        // A destroyed (or otherwise absent) root has nothing to walk. Every
        // store read at id -1 comes back undefined, not a zero, and undefined
        // fails every comparison classify() makes, so it falls through to
        // "out of bounds" and calls sweepOut; there, its I_LAST_CHILD (a
        // negative index) is also undefined, and undefined !== NULL forever, so the child-push loop
        // never terminates. Bail before touching the stack at all.
        if (root === NULL) {
            return;
        }
        s.deferFree = true;
        let stack = this.stack;
        let masks = this.maskStack;
        stack[0] = root;
        masks[0] = 0;
        let sp = 1;
        while (sp > 0) {
            sp--;
            const id = stack[sp];
            const o = id * I_STRIDE;
            // A hook, or an event it raised, destroyed this node after it was
            // pushed: a freed slot is neither visited nor passed to a hook.
            if (s.i32[o + I_UID] === 0) {
                continue;
            }
            const inherit = masks[sp];
            this.visited++;
            let childMask = this.visit(id, inherit);
            if (childMask < 0) {
                continue;
            }
            // Read after the visit: its hooks may have grown the store.
            let c = s.i32[o + I_LAST_CHILD];
            if (c === NULL) {
                continue;
            }
            // A container with a non-zero zIndex draws its subtree above the text
            // queued before it, as a quad of its own does in emit(), though it may
            // draw nothing itself (a transparent wrapper around a scrim). A
            // container that draws has flushed in emit(), so pendingCount is 0.
            if (this.pendingCount > 0 &&
                s.f64[id * F_STRIDE + F_Z_INDEX] !== 0 &&
                (s.u32[o + I_STATE] & ST_TEXT) === 0) {
                this.flushText();
                // The emitter's hooks can destroy this node or its children, and
                // grow the store.
                if (s.i32[o + I_UID] === 0) {
                    continue;
                }
                c = s.i32[o + I_LAST_CHILD];
                if (c === NULL) {
                    continue;
                }
            }
            // Nothing below calls out, so the views hold until the next visit.
            const u32 = s.u32;
            const state = u32[o + I_STATE];
            if ((state & ST_CHILDREN_STALE) !== 0) {
                childMask = INH_ALL;
                u32[o + I_STATE] = state & ~ST_CHILDREN_STALE;
            }
            const prev = s.prev;
            // Push in reverse so the first child pops first.
            while (c !== NULL) {
                if (sp === stack.length) {
                    this.growStack();
                    stack = this.stack;
                    masks = this.maskStack;
                }
                stack[sp] = c;
                masks[sp] = childMask;
                sp++;
                c = prev[c];
            }
        }
        // Emitted while freed slots are still quarantined, so uid 0 still
        // identifies a node destroyed after it was queued.
        this.flushText();
        s.endDeferFree();
    }
    growStack() {
        const n = this.stack.length * 2;
        const stack = new Int32Array(n);
        stack.set(this.stack);
        const masks = new Uint32Array(n);
        masks.set(this.maskStack);
        this.stack = stack;
        this.maskStack = masks;
    }
    growSweepStack() {
        const stack = new Int32Array(this.sweepStack.length * 2);
        stack.set(this.sweepStack);
        this.sweepStack = stack;
    }
    /**
     * Update one node. Returns the inherit mask for its children, or -1 when
     * the subtree is culled (out of bounds or world alpha zero) or a hook
     * destroyed the node.
     */
    visit(id, inherit) {
        const s = this.nodes;
        const o = id * I_STRIDE;
        const fo = id * F_STRIDE;
        let d = s.u32[o + I_DIRTY];
        let state = s.u32[o + I_STATE];
        if (d === 0 && inherit === 0) {
            const vis = (state & ST_VIS_MASK) >>> ST_VIS_SHIFT;
            if (vis === VIS_OUT || s.f64[fo + F_WORLD_ALPHA] === 0) {
                return -1;
            }
            if ((state & ST_RENDERABLE) !== 0) {
                this.emit(id, state);
            }
            return 0;
        }
        // Taken now: a hook's markDirty on this node lands in the cleared word
        // and is OR-ed with what is still pending at the end, never overwritten.
        s.u32[o + I_DIRTY] = 0;
        this.updated++;
        const parent = s.i32[o + I_PARENT];
        if ((d & DIRTY_INHERITED) !== 0) {
            inherit = INH_ALL;
        }
        let childMask = 0;
        // The resolved layout direction (ST_RTL): the node's own value when
        // set, else the parent's bit. Derived only when the node's rtl was
        // written or an ancestor's bit changed (INH_DIRECTION), so an app that
        // never sets rtl never runs this. A change re-places the children
        // (their x, mount and pivot read this bit in composeWorld) and re-lays
        // a text node out (its alignment reads it), in this same visit. The
        // INH_TRANSFORM it pushes also re-derives this node's own clip record
        // below (updateClip swaps the side margins on this bit): the margins
        // follow a direction change with no DIRTY_CLIP of their own.
        if ((d & DIRTY_DIRECTION) !== 0 || (inherit & INH_DIRECTION) !== 0) {
            const own = s.i32[o + I_DIRECTION];
            let rtl;
            if (own === DIR_INHERIT) {
                rtl =
                    parent !== NULL &&
                        (s.u32[parent * I_STRIDE + I_STATE] & ST_RTL) !== 0;
            }
            else {
                rtl = own === DIR_RTL;
            }
            if (rtl !== ((state & ST_RTL) !== 0)) {
                state ^= ST_RTL;
                s.u32[o + I_STATE] = state;
                childMask |= INH_DIRECTION | INH_TRANSFORM;
                if ((state & ST_TEXT) !== 0) {
                    d |= DIRTY_LAYOUT;
                }
            }
        }
        let pending = 0;
        let parked = 0;
        // A text node lays out first: a new size or block offset is composed,
        // culled and drawn in this visit, so a layout costs no re-walk and the
        // text is drawn in the walk that laid it out, a frame's last included.
        if ((d & DIRTY_LAYOUT) !== 0) {
            const raised = this.hooks.layoutText(id);
            if (s.i32[o + I_UID] === 0) {
                return -1;
            }
            if (raised < 0) {
                pending |= DIRTY_LAYOUT;
            }
            else {
                d |= raised | DIRTY_RENDERABLE;
            }
            state = s.u32[o + I_STATE];
        }
        // Size is a renderability input, and every w/h write raises
        // DIRTY_LOCAL | DIRTY_SHADER (1.10 bridged RecalcUniforms to
        // IsRenderable the same way).
        if ((d & DIRTY_SHADER) !== 0) {
            d |= DIRTY_RENDERABLE;
        }
        let needVis = false;
        if ((d & DIRTY_LOCAL) !== 0 || (inherit & INH_TRANSFORM) !== 0) {
            composeWorld(s, id, parent);
            state = s.u32[o + I_STATE];
            childMask |= INH_TRANSFORM;
            needVis = true;
        }
        if ((d & DIRTY_ALPHA) !== 0 || (inherit & INH_ALPHA) !== 0) {
            const a = s.f64[fo + F_ALPHA];
            let wa = parent === NULL || (state & ST_IGNORE_PARENT_ALPHA) !== 0
                ? a
                : s.f64[parent * F_STRIDE + F_WORLD_ALPHA] * a;
            // Clamped to [0, 1]: eased alpha overshoots (back easings), and both
            // the zero tests below and premultiply assume the range (out of it,
            // the premultiplied bytes wrap).
            if (wa < 0) {
                wa = 0;
            }
            else if (wa > 1) {
                wa = 1;
            }
            const prev = s.f64[fo + F_WORLD_ALPHA];
            if (wa !== prev) {
                s.f64[fo + F_WORLD_ALPHA] = wa;
                childMask |= INH_ALPHA;
                d |= DIRTY_COLOR;
                if ((wa === 0) !== (prev === 0)) {
                    d |= DIRTY_RENDERABLE;
                }
            }
        }
        const clips = (state & ST_CLIPS) !== 0;
        if ((d & DIRTY_CLIP) !== 0 ||
            (inherit & INH_CLIP) !== 0 ||
            (clips === true && (childMask & INH_TRANSFORM) !== 0)) {
            this.updateClip(id, parent, clips);
            childMask |= INH_CLIP;
            needVis = true;
        }
        let vis = (state & ST_VIS_MASK) >>> ST_VIS_SHIFT;
        let next = vis;
        if (needVis === true || vis === VIS_INIT) {
            next = this.classify(id, parent);
        }
        if (next !== vis) {
            // In bounds, a resolve already due reads as parked to the hook, like
            // one parked while the node was out, so that it does not take wants
            // the resolve then moves (a src written in the frame a recycled node
            // comes back); the fold below clears it.
            if (next !== VIS_OUT && (d & DIRTY_TEXTURE) !== 0) {
                state |= ST_DEFER_TEXTURE;
            }
            // Stored before the hook runs, so that the hook reads the new state.
            s.u32[o + I_STATE] = withVisibility(state, next);
            this.hooks.onVisibility(id, vis, next);
            if (next === VIS_OUT && s.i32[o + I_UID] !== 0) {
                this.sweepOut(id);
            }
            if (s.i32[o + I_UID] === 0) {
                return -1;
            }
            state = s.u32[o + I_STATE];
            vis = next;
            d |= DIRTY_RENDERABLE;
            // Back in bounds: the texture and shader work parked while it was out
            // runs now.
            if (next !== VIS_OUT && (state & ST_DEFERRED) !== 0) {
                if ((state & ST_DEFER_TEXTURE) !== 0) {
                    d |= DIRTY_TEXTURE;
                }
                if ((state & ST_DEFER_SHADER) !== 0) {
                    d |= DIRTY_SHADER;
                }
                state &= ~ST_DEFERRED;
                s.u32[o + I_STATE] = state;
            }
        }
        // Shown again after world alpha 0 hid it (its own, or an ancestor's:
        // ST_HIDDEN), the node is told before the texture step, so that a
        // resolve onShown parks (what it showed was freed while it was hidden)
        // runs in this visit: it is never drawn with a texture that is gone. A
        // resolve already due reads as parked to the hook, as on a return into
        // bounds, so that it does not take wants the resolve then moves.
        const hidden = s.f64[fo + F_WORLD_ALPHA] === 0;
        if (hidden === false && (state & (ST_ALPHA_CULLED | ST_HIDDEN)) !== 0) {
            state &= ~(ST_ALPHA_CULLED | ST_HIDDEN);
            // The bounds events took a hidden descendant's renderability away
            // with its `renderable` false: re-derived here, once per showing.
            if (EMIT_BOUNDS_EVENTS === true) {
                d |= DIRTY_RENDERABLE;
            }
            if (vis !== VIS_OUT && (d & DIRTY_TEXTURE) !== 0) {
                state |= ST_DEFER_TEXTURE;
            }
            s.u32[o + I_STATE] = state;
            if (vis !== VIS_OUT) {
                this.hooks.onShown(id);
                if (s.i32[o + I_UID] === 0) {
                    return -1;
                }
                state = s.u32[o + I_STATE];
                if ((state & ST_DEFER_TEXTURE) !== 0) {
                    d |= DIRTY_TEXTURE;
                    state &= ~ST_DEFER_TEXTURE;
                    s.u32[o + I_STATE] = state;
                }
            }
        }
        // Out of bounds, texture and shader work waits: no texture record or
        // fetch before a node is first found in bounds (spec 9.2), and no
        // params block for a node nobody sees (1.10 deferred shader updates
        // too). The work is parked in state bits rather than left in the dirty
        // word, so that a node that stays out stays on the fast path; the
        // transition into bounds above moves it back.
        if ((d & DIRTY_TEXTURE) !== 0) {
            if (vis === VIS_OUT) {
                parked |= ST_DEFER_TEXTURE;
            }
            else {
                // A resolved texture can change content readiness and the
                // placeholder, so colours and renderability follow it. Raised here,
                // not up front, so that parking (the branch above) saves one
                // premultiply instead of running it right before the node is
                // culled.
                d |= DIRTY_COLOR | DIRTY_RENDERABLE;
                this.hooks.resolveTexture(id);
                if (s.i32[o + I_UID] === 0) {
                    return -1;
                }
                state = s.u32[o + I_STATE];
            }
        }
        if ((d & DIRTY_SHADER) !== 0) {
            if (vis === VIS_OUT) {
                parked |= ST_DEFER_SHADER;
            }
            else {
                this.hooks.packShader(id);
                if (s.i32[o + I_UID] === 0) {
                    return -1;
                }
                state = s.u32[o + I_STATE];
            }
        }
        if ((d & DIRTY_COLOR) !== 0) {
            const before = state;
            state = this.premultiply(id, state);
            if (((before ^ state) & (ST_HAS_COLOR | ST_PLACEHOLDER)) !== 0) {
                d |= DIRTY_RENDERABLE;
            }
        }
        if ((d & DIRTY_RENDERABLE) !== 0) {
            const before = state;
            state = this.deriveRenderable(id, state, vis);
            if (EMIT_BOUNDS_EVENTS === true &&
                ((before ^ state) & ST_RENDERABLE) !== 0) {
                s.u32[o + I_STATE] = state;
                this.hooks.onRenderable(id, (state & ST_RENDERABLE) !== 0);
                if (s.i32[o + I_UID] === 0) {
                    return -1;
                }
                state = s.u32[o + I_STATE];
            }
        }
        // Hidden by world alpha 0, where 1.10 released texture ownership: the
        // first culled visit tells the subtree (sweepHidden); the first visit
        // shown again tells the node (above). A static hidden subtree costs
        // nothing.
        if (hidden === true && (state & ST_ALPHA_CULLED) === 0) {
            s.u32[o + I_STATE] = state | parked | ST_ALPHA_CULLED;
            this.sweepHidden(id);
            if (s.i32[o + I_UID] === 0) {
                return -1;
            }
            state = s.u32[o + I_STATE];
        }
        if (vis === VIS_OUT || hidden === true) {
            s.u32[o + I_STATE] = state | parked | ST_CHILDREN_STALE;
            s.u32[o + I_DIRTY] = s.u32[o + I_DIRTY] | (d & DIRTY_CHILD) | pending;
            return -1;
        }
        s.u32[o + I_STATE] = state;
        s.u32[o + I_DIRTY] = s.u32[o + I_DIRTY] | pending;
        if ((state & ST_RENDERABLE) !== 0) {
            this.emit(id, state);
        }
        return childMask;
    }
    /**
     * Node `root` just went out of bounds, so its subtree will not be visited:
     * mark every descendant out of bounds too (renderable cleared) and report
     * each transition, once. A descendant that is already out is not entered:
     * its subtree was swept when it went out. Culling by world alpha 0 does
     * not sweep visibility: it stays as it was until the subtree is shown
     * (1.10 went on deriving it under an alpha-0 ancestor: spec 14, item
     * 96); sweepHidden only tells its nodes they are hidden. When the
     * subtree returns, ST_CHILDREN_STALE on `root` re-derives it.
     */
    sweepOut(root) {
        const s = this.nodes;
        let stack = this.sweepStack;
        stack[0] = root;
        let sp = 1;
        while (sp > 0) {
            sp--;
            const id = stack[sp];
            const o = id * I_STRIDE;
            if (id !== root && this.markOut(id) === false) {
                continue;
            }
            let c = s.i32[o + I_LAST_CHILD];
            while (c !== NULL) {
                if (sp === stack.length) {
                    this.growSweepStack();
                    stack = this.sweepStack;
                }
                stack[sp] = c;
                sp++;
                c = s.prev[c];
            }
        }
    }
    /**
     * Node `root` was just culled by its own world alpha 0, so its subtree
     * will not be visited: tell each node in it that is in bounds that it is
     * hidden (hooks.onHidden), and mark ST_HIDDEN each one that asks for
     * onShown on its next visit shown. Visibility does not change. A subtree
     * out of bounds, or culled by its own alpha 0 already (ST_ALPHA_CULLED),
     * was told before and is not entered; a node told already (ST_HIDDEN:
     * an ancestor culled it, and it has not been shown since) is entered but
     * not told again; a node never classified has no hook state yet, so it
     * is entered but not told.
     */
    sweepHidden(root) {
        const s = this.nodes;
        let stack = this.sweepStack;
        stack[0] = root;
        let sp = 1;
        while (sp > 0) {
            sp--;
            const id = stack[sp];
            const o = id * I_STRIDE;
            // Destroyed by a hook earlier in this sweep.
            if (s.i32[o + I_UID] === 0) {
                continue;
            }
            const state = s.u32[o + I_STATE];
            const vis = (state & ST_VIS_MASK) >>> ST_VIS_SHIFT;
            if (vis === VIS_OUT) {
                continue;
            }
            if (id !== root && (state & ST_ALPHA_CULLED) !== 0) {
                continue;
            }
            if (vis !== VIS_INIT &&
                (state & ST_HIDDEN) === 0 &&
                this.hooks.onHidden(id) === true &&
                s.i32[o + I_UID] !== 0) {
                s.u32[o + I_STATE] = s.u32[o + I_STATE] | ST_HIDDEN;
            }
            let c = s.i32[o + I_LAST_CHILD];
            while (c !== NULL) {
                if (sp === stack.length) {
                    this.growSweepStack();
                    stack = this.sweepStack;
                }
                stack[sp] = c;
                sp++;
                c = s.prev[c];
            }
        }
    }
    /**
     * Sweep one descendant out; false when its subtree needs no sweep. Only
     * the visibility and ST_RENDERABLE change: dirty bits and parked work
     * (ST_DEFERRED) stay for the node's next visit.
     */
    markOut(id) {
        const s = this.nodes;
        const o = id * I_STRIDE;
        // Destroyed by a hook earlier in this sweep.
        if (s.i32[o + I_UID] === 0) {
            return false;
        }
        const state = s.u32[o + I_STATE];
        const prev = (state & ST_VIS_MASK) >>> ST_VIS_SHIFT;
        if (prev === VIS_OUT) {
            return false;
        }
        s.u32[o + I_STATE] = withVisibility(state & ~ST_RENDERABLE, VIS_OUT);
        this.hooks.onVisibility(id, prev, VIS_OUT);
        if (EMIT_BOUNDS_EVENTS === true &&
            (state & ST_RENDERABLE) !== 0 &&
            s.i32[o + I_UID] !== 0) {
            this.hooks.onRenderable(id, false);
        }
        return true;
    }
    updateClip(id, parent, clips) {
        const s = this.nodes;
        const c = this.clips;
        const i32 = s.i32;
        const f64 = s.f64;
        const fo = id * F_STRIDE;
        const ci = id * I_STRIDE + I_CLIP;
        const parentClip = parent === NULL ? 0 : i32[parent * I_STRIDE + I_CLIP];
        const rotated = f64[fo + F_WB] !== 0 || f64[fo + F_WC] !== 0;
        let rec = i32[ci];
        const owned = rec !== 0 && c.owner[rec] === id;
        if (clips === false || rotated === true) {
            // Give the node's own record back: once `clip` points at the
            // parent's record, nothing (releaseNode included) could free it.
            if (owned === true) {
                c.free(rec);
            }
            i32[ci] = parentClip;
            return;
        }
        if (owned === false) {
            rec = c.alloc(id);
            i32[ci] = rec;
        }
        let mT = 0;
        let mR = 0;
        let mB = 0;
        let mL = 0;
        const margins = s.clipMargins[id];
        if (margins !== null) {
            mT = margins[0];
            mB = margins[2];
            // Under the node's own RTL direction the side margins swap with the
            // layout they make room for (a focus ring's overshoot, a rail's
            // lead-in). Read only for a node with margins.
            if ((s.u32[id * I_STRIDE + I_STATE] & ST_RTL) !== 0) {
                mR = margins[3];
                mL = margins[1];
            }
            else {
                mR = margins[1];
                mL = margins[3];
            }
        }
        const view = this.view;
        c.set(rec, f64[fo + F_WTX] - mL, f64[fo + F_WTY] - mT, f64[fo + F_W] * f64[fo + F_WA] + mL + mR, f64[fo + F_H] * f64[fo + F_WD] + mT + mB, view.pixelRatio, view.canvasH);
        if (parentClip !== 0 && c.valid[parentClip] === 1) {
            c.intersect(rec, parentClip, view.pixelRatio, view.canvasH);
        }
    }
    /** 1.10 checkRenderBounds on the store. */
    classify(id, parent) {
        const s = this.nodes;
        const c = this.clips;
        const view = this.view;
        let x1 = 0;
        let y1 = 0;
        let x2 = view.w;
        let y2 = view.h;
        const rec = s.i32[id * I_STRIDE + I_CLIP];
        const f64 = s.f64;
        const fo = id * F_STRIDE;
        if (rec !== 0 && c.valid[rec] === 1) {
            const cx = c.x[rec];
            const cy = c.y[rec];
            if (cx > x1)
                x1 = cx;
            if (cy > y1)
                y1 = cy;
            const cr = cx + c.w[rec];
            const cb = cy + c.h[rec];
            if (cr < x2)
                x2 = cr;
            if (cb < y2)
                y2 = cb;
        }
        const bx0 = f64[fo + F_BX0];
        const by0 = f64[fo + F_BY0];
        const bx1 = f64[fo + F_BX1];
        const by1 = f64[fo + F_BY1];
        if (bx0 <= x2 && bx1 >= x1 && by0 <= y2 && by1 >= y1) {
            return VIS_IN_VIEWPORT;
        }
        const m = view.margin;
        if (bx0 <= x2 + m[1] &&
            bx1 >= x1 - m[3] &&
            by0 <= y2 + m[2] &&
            by1 >= y1 - m[0]) {
            return VIS_IN_BOUNDS;
        }
        if (parent !== NULL && (f64[fo + F_W] === 0 || f64[fo + F_H] === 0)) {
            return ((s.u32[parent * I_STRIDE + I_STATE] & ST_VIS_MASK) >>> ST_VIS_SHIFT);
        }
        return VIS_OUT;
    }
    /** Premultiplied corner colors plus the derived HAS_COLOR / PLACEHOLDER bits. */
    premultiply(id, state) {
        const s = this.nodes;
        const u32 = s.u32;
        const o = id * I_STRIDE;
        const alpha = s.f64[id * F_STRIDE + F_WORLD_ALPHA];
        const tl = u32[o + I_COLOR_TL];
        const tr = u32[o + I_COLOR_TR];
        const bl = u32[o + I_COLOR_BL];
        const br = u32[o + I_COLOR_BR];
        // A text node draws its glyphs in its colour, whatever texture it may
        // have been given (1.10 drew SDF text alone).
        const placeholder = u32[o + I_PLACEHOLDER_COLOR] !== 0 &&
            s.i32[o + I_TEXTURE] !== NULL &&
            (state & (ST_CONTENT_READY | ST_TEXT)) === 0;
        if (placeholder === true) {
            const m = premultiplyColorABGR(u32[o + I_PLACEHOLDER_COLOR], alpha);
            u32[o + I_PM_TL] = m;
            u32[o + I_PM_TR] = m;
            u32[o + I_PM_BL] = m;
            u32[o + I_PM_BR] = m;
            state |= ST_PLACEHOLDER;
        }
        else {
            const m = premultiplyColorABGR(tl, alpha);
            u32[o + I_PM_TL] = m;
            if (tl === tr && tl === bl && tl === br) {
                u32[o + I_PM_TR] = m;
                u32[o + I_PM_BL] = m;
                u32[o + I_PM_BR] = m;
            }
            else {
                u32[o + I_PM_TR] = premultiplyColorABGR(tr, alpha);
                u32[o + I_PM_BL] = premultiplyColorABGR(bl, alpha);
                u32[o + I_PM_BR] = premultiplyColorABGR(br, alpha);
            }
            state &= ~ST_PLACEHOLDER;
        }
        if ((tl | tr | bl | br) !== 0) {
            state |= ST_HAS_COLOR;
        }
        else {
            state &= ~ST_HAS_COLOR;
        }
        return state;
    }
    /**
     * 1.10 updateIsRenderable on the store. Size counts when non-zero, as in
     * 1.10's hasDimensions: a negative width or height still renders.
     */
    deriveRenderable(id, state, vis) {
        const s = this.nodes;
        const fo = id * F_STRIDE;
        let r = false;
        if (vis === VIS_IN_VIEWPORT && s.f64[fo + F_WORLD_ALPHA] > 0) {
            if ((state & ST_TEXT) !== 0) {
                // Its glyphs, whatever texture it may have been given (1.10 drew
                // SDF text alone).
                r = (state & ST_TEXT_READY) !== 0;
            }
            else if (s.i32[id * I_STRIDE + I_TEXTURE] !== NULL) {
                r = (state & (ST_CONTENT_READY | ST_PLACEHOLDER)) !== 0;
            }
            else {
                // A shader makes a node renderable without a colour, as a shader
                // other than the default did in 1.10. One whose program failed to
                // compile, or an object that is no shader of this renderer, draws
                // with Default: on a transparent node, an invisible quad.
                r =
                    ((state & ST_HAS_COLOR) !== 0 || s.shaderRefs[id] !== null) &&
                        s.f64[fo + F_W] !== 0 &&
                        s.f64[fo + F_H] !== 0;
            }
        }
        return r === true ? state | ST_RENDERABLE : state & ~ST_RENDERABLE;
    }
    emit(id, state) {
        const s = this.nodes;
        if ((state & ST_TEXT) !== 0) {
            this.queueText(id);
            this.emitted++;
            return;
        }
        // A non-text quad with a non-zero zIndex draws above the text queued
        // before it (spec 7.3; 1.10 WebGlRenderer.addQuad flushed its deferred
        // text ops the same way).
        const fo = id * F_STRIDE;
        const o = id * I_STRIDE;
        if (this.pendingCount > 0 && s.f64[fo + F_Z_INDEX] !== 0) {
            this.flushText();
            if (s.i32[o + I_UID] === 0) {
                return;
            }
        }
        const stream = this.stream;
        if (stream.isFull === true) {
            this.flush();
        }
        // Read after the flushes above, which reach the renderer.
        const f64 = s.f64;
        const u32 = s.u32;
        const i32 = s.i32;
        const quad = stream.quadCount;
        const w = f64[fo + F_W];
        const h = f64[fo + F_H];
        const tx = f64[fo + F_WTX];
        const ty = f64[fo + F_WTY];
        // Corners: TL (tx, ty), TR (x1, y1), BL (x2, y2), BR (x3, y3).
        let x1;
        let y1;
        let x2;
        let y2;
        let x3;
        let y3;
        if ((state & ST_WORLD_TRANSLATE) !== 0) {
            // Translate-only (wa..wd are 1, 0, 0, 1): additions alone, no matrix
            // loads, and the same values as the general form below.
            x1 = tx + w;
            y1 = ty;
            x2 = tx;
            y2 = ty + h;
            x3 = x1;
            y3 = y2;
        }
        else {
            const a = f64[fo + F_WA];
            const b = f64[fo + F_WB];
            const c = f64[fo + F_WC];
            const d = f64[fo + F_WD];
            x1 = tx + w * a;
            y1 = ty + w * c;
            x2 = tx + h * b;
            y2 = ty + h * d;
            x3 = x1 + h * b;
            y3 = y1 + h * d;
        }
        const f32 = s.f32;
        const u1 = f32[o + I_UV_X1];
        const v1 = f32[o + I_UV_Y1];
        const u2 = f32[o + I_UV_X2];
        const v2 = f32[o + I_UV_Y2];
        // writeQuad's twenty-four words (emit.ts), stored here: V8 boxes the
        // doubles passed to a call until it inlines it.
        const f = stream.f32;
        const u = stream.u32;
        const i = stream.cursor;
        f[i] = tx;
        f[i + 1] = ty;
        f[i + 2] = u1;
        f[i + 3] = v1;
        u[i + 4] = u32[o + I_PM_TL];
        f[i + 5] = 0;
        f[i + 6] = x1;
        f[i + 7] = y1;
        f[i + 8] = u2;
        f[i + 9] = v1;
        u[i + 10] = u32[o + I_PM_TR];
        f[i + 11] = 0;
        f[i + 12] = x2;
        f[i + 13] = y2;
        f[i + 14] = u1;
        f[i + 15] = v2;
        u[i + 16] = u32[o + I_PM_BL];
        f[i + 17] = 0;
        f[i + 18] = x3;
        f[i + 19] = y3;
        f[i + 20] = u2;
        f[i + 21] = v2;
        u[i + 22] = u32[o + I_PM_BR];
        f[i + 23] = 0;
        stream.cursor = i + 24;
        const ops = this.ops;
        const last = ops.length - 1;
        // The program and params block are the shader registry's, packed into
        // the store when the node's shader, a shader prop or its size changed.
        // A placeholder draws with the white texture, though its record may
        // be uploaded (a size change that defers the image to the next walk).
        const program = i32[o + I_SHADER];
        const params = s.params[id];
        const record = i32[o + I_TEXTURE];
        let texture = 0;
        if ((state & ST_PLACEHOLDER) === 0 && record !== NULL) {
            // Read through the store each time: a record created in the walk
            // can grow it, replacing drawId.
            const textures = this.textures;
            texture = textures === null ? record : textures.drawId[record];
        }
        const clip = i32[o + I_CLIP];
        // Only a program with per-op uniforms can split an op whose keys match,
        // so only its quads ask, and only when the keys match the last op's (a
        // quad whose keys differ, the next poster of a rail with a border,
        // starts an op anyway); any other quad batches on the keys alone.
        const match = (state & ST_PER_OP) === 0 ||
            last < 0 ||
            ops.program[last] !== program ||
            ops.params[last] !== params ||
            ops.texture[last] !== texture ||
            ops.clip[last] !== clip ||
            this.hooks.perOpMatch(id, ops.node[last]);
        ops.add(program, params, texture, clip, id, quad, match);
        this.emitted++;
    }
    queueText(id) {
        const n = this.pendingCount;
        if (n === this.pendingText.length) {
            const grown = new Int32Array(n * 2);
            grown.set(this.pendingText);
            this.pendingText = grown;
        }
        this.pendingText[n] = id;
        this.pendingCount = n + 1;
    }
    /**
     * Emit the queued text nodes in queue order and empty the queue. The
     * emitter writes each node's glyphs into the same stream and op list, so
     * consecutive nodes' glyphs merge into one op per atlas and clip. A node
     * destroyed since it was queued is skipped.
     */
    flushText() {
        const s = this.nodes;
        const hooks = this.hooks;
        const queue = this.pendingText;
        const n = this.pendingCount;
        this.pendingCount = 0;
        this.textEmitted += n;
        for (let i = 0; i < n; i++) {
            const id = queue[i];
            if (s.i32[id * I_STRIDE + I_UID] !== 0) {
                hooks.emitText(id);
            }
        }
    }
}
//# sourceMappingURL=ScenePass.js.map