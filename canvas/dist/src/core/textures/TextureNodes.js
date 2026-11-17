import { UV_BR, UV_TL } from '../nodes/NodeStore.js';
import { DIRTY_LOCAL, DIRTY_TEXTURE, NULL, ST_AUTOSIZE, ST_AUTOSIZE_DUE, ST_CONTAIN, ST_CONTENT_READY, ST_DEFER_TEXTURE, ST_HIDDEN, ST_PRELOAD, ST_PRELOAD_QUEUED, ST_PRELOAD_WANT, ST_SRC, ST_TEXT, ST_WANT, VIS_IN_BOUNDS, VIS_IN_VIEWPORT, visibilityOf, } from '../nodes/NodeFlags.js';
import { KIND_IMAGE, KIND_SUB, TX_FAILED, TX_FREED, TX_UPLOADED, } from './TextureStore.js';
import { imageKey, textureRecord, } from './Texture.js';
import { packUv, resolveUvRect } from './uvRect.js';
import { F_H, F_STRIDE, F_TEX_H, F_TEX_W, F_W, F_WORLD_ALPHA, I_FIRST_CHILD, I_OWNER_NEXT, I_SOURCE_TEXTURE, I_STATE, I_STRIDE, I_TEXTURE, I_UID, I_UV0, I_UV1, I_UV_X1, I_UV_X2, I_UV_Y1, I_UV_Y2, } from '../nodes/NodeLayout.js';
/**
 * The node side of the texture system: the scene pass hooks
 * (resolveTexture, onVisibility, and the resize part of packShader), node
 * release, the preload drain, and what a record's arrival or failure does
 * to the nodes in its owner list.
 *
 * Per node: `sourceTexture` is the record its source resolved to and
 * `texture` the record whose pixels it draws (NodeStore). ST_WANT means
 * the node counts one want on each (it is in bounds, the margin included,
 * and not hidden by world alpha 0: ST_HIDDEN, or its own world alpha 0;
 * except a node moved into a subtree already culled by alpha, which keeps
 * its wants until that ancestor is shown, as no sweep tells it: spec 14,
 * item 34); ST_PRELOAD_WANT one more on its source's pixels while
 * `textureOptions.preload` is set, hidden or not.
 */
export class TextureNodes {
    constructor(store, events) {
        this.rect = new Float64Array(4);
        /** The size `measure` found. */
        this.dimW = 0;
        this.dimH = 0;
        this.store = store;
        this.nodes = store.nodes;
        this.events = events;
        store.onUploaded = (rec) => this.notify(rec, true);
        store.onFreed = (rec) => this.freed(rec);
        store.onHeld = (rec) => this.held(rec);
        store.onFailed = (rec, final) => {
            if (final === true) {
                this.notify(rec, false);
            }
            else {
                this.failedHandles(rec);
            }
        };
    }
    /**
     * PassHooks.resolveTexture: DIRTY_TEXTURE on a node in bounds. Resolves
     * the source to a record (creating it the first time: spec 9.2, no record
     * before a node is in bounds), takes the node's wants, and derives what
     * it shows: size, UVs and ST_CONTENT_READY.
     */
    resolveTexture(id) {
        const s = this.nodes;
        const src = this.sourceOf(id);
        if (src !== s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]) {
            this.switchSource(id, src);
        }
        // On the first visit in bounds onVisibility ran before the node had a
        // record, so the first want is counted here (unless it is hidden).
        const state = s.u32[id * I_STRIDE + I_STATE];
        if (src !== NULL && (state & ST_WANT) === 0 && this.shown(id, state)) {
            this.addWants(id, visibilityOf(state) === VIS_IN_VIEWPORT);
        }
        this.refresh(id);
    }
    /**
     * PassHooks.onVisibility: wants follow the bounds (spec 9.2). Entering
     * the viewport promotes a queued load ahead of the margin.
     */
    onVisibility(id, prev, next) {
        const s = this.nodes;
        const store = this.store;
        const wasIn = prev >= VIS_IN_BOUNDS;
        const isIn = next >= VIS_IN_BOUNDS;
        const state = s.u32[id * I_STRIDE + I_STATE];
        if (wasIn === isIn) {
            const src = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
            if (next === VIS_IN_VIEWPORT && (state & ST_WANT) !== 0 && src !== NULL) {
                store.promote(store.pixelsOf(src));
            }
            return;
        }
        if (isIn === false) {
            if ((state & ST_WANT) !== 0) {
                this.dropWants(id);
            }
            return;
        }
        if (s.i32[id * I_STRIDE + I_SOURCE_TEXTURE] === NULL) {
            return;
        }
        // Before the wants: an old image freed while it was away is not wanted
        // again.
        this.back(id);
        // A resolve due in this visit (ST_DEFER_TEXTURE: parked while it was
        // away, or due already, as the pass hands it over) counts the wants of
        // the source it resolves to (resolveTexture): wanting the old one first
        // could queue a load only to cancel it.
        if ((state & (ST_WANT | ST_DEFER_TEXTURE)) === 0 && this.shown(id, state)) {
            this.addWants(id, next === VIS_IN_VIEWPORT);
        }
    }
    /**
     * PassHooks.onHidden: node `id`, in bounds, is hidden by world alpha 0
     * (its own or an ancestor's), so its visibility wants go, as 1.10
     * released texture ownership at world alpha 0; preload wants stay. It
     * asks for onShown when it has a source to want again.
     */
    onHidden(id) {
        const s = this.nodes;
        if ((s.u32[id * I_STRIDE + I_STATE] & ST_WANT) !== 0) {
            this.dropWants(id);
        }
        return s.i32[id * I_STRIDE + I_SOURCE_TEXTURE] !== NULL;
    }
    /**
     * PassHooks.onShown: node `id`, in bounds, is shown again: it wants its
     * pixels back, after the check for what was freed while it was hidden.
     * A resolve due in this visit (ST_DEFER_TEXTURE, as the pass hands it
     * over) takes the wants of the source it resolves to instead, as on a
     * return into bounds.
     */
    onShown(id) {
        const s = this.nodes;
        const state = s.u32[id * I_STRIDE + I_STATE];
        if ((state & ST_WANT) !== 0 ||
            s.i32[id * I_STRIDE + I_SOURCE_TEXTURE] === NULL) {
            return;
        }
        this.back(id);
        if ((state & ST_DEFER_TEXTURE) === 0) {
            this.addWants(id, visibilityOf(state) === VIS_IN_VIEWPORT);
        }
    }
    /**
     * Node `id` is back in bounds, or shown again, without its wants: what it
     * showed may have been freed meanwhile (a cleanup frees what nobody
     * wants). Mid-switch it then shows its source's pixels: it is in its
     * source's owner list, not the old image's, so a reload of the old image
     * would mark no node and draw nowhere. A node that was drawn with a
     * texture that is gone resolves again in this visit (ST_DEFER_TEXTURE,
     * which the pass folds into DIRTY_TEXTURE before its texture step), so it
     * is never emitted with a record that has no GL texture.
     */
    back(id) {
        const s = this.nodes;
        const store = this.store;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        if (shown === NULL || store.state[shown] === TX_UPLOADED) {
            return;
        }
        const pixels = store.pixelsOf(s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]);
        if (shown !== pixels) {
            this.show(id, pixels);
        }
        const state = s.u32[id * I_STRIDE + I_STATE];
        if ((state & ST_CONTENT_READY) !== 0) {
            s.u32[id * I_STRIDE + I_STATE] = state | ST_DEFER_TEXTURE;
        }
    }
    /**
     * The texture part of PassHooks.packShader (DIRTY_SHADER, which every
     * w/h change raises): a cover crop depends on the node's size. Contain
     * needs nothing here: composeWorld recomputes it.
     */
    onResize(id) {
        const s = this.nodes;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        if (shown === NULL) {
            return;
        }
        const options = s.textureOptions[id];
        if (options === null) {
            return;
        }
        const mode = options.resizeMode;
        if (mode === undefined || mode === null || mode.type !== 'cover') {
            return;
        }
        if (this.store.state[shown] === TX_UPLOADED) {
            this.packShown(id);
        }
    }
    /**
     * RendererCore.createTexture made SubTexture record `rec`: on a parent
     * already uploaded, failed or freed, its handle's event is queued now and
     * delivered after the frame's draw or from a zero-delay timer, as 1.10
     * told a new SubTexture in a microtask (a listener added in the same task
     * hears it; `loading` is no event in v2).
     */
    subTextureCreated(rec) {
        const store = this.store;
        const handle = store.handles[rec];
        const parent = store.parent[rec];
        const state = store.state[parent];
        if (state === TX_UPLOADED) {
            this.measure(rec);
            this.events.queue(handle, 'loaded', { w: this.dimW, h: this.dimH });
        }
        else if (state === TX_FAILED) {
            this.events.queue(handle, 'failed', store.errors[parent]);
        }
        else if (state === TX_FREED) {
            this.events.queue(handle, 'freed', null);
        }
    }
    /** RendererCore.releaseNode: a destroyed node lets go of its records. */
    release(id) {
        this.switchSource(id, NULL);
        const s = this.nodes;
        s.u32[id * I_STRIDE + I_STATE] =
            s.u32[id * I_STRIDE + I_STATE] & ~(ST_WANT | ST_PRELOAD_WANT);
    }
    /**
     * Preload (spec 9.2) for the nodes NodeStore.queuePreload listed: resolve
     * the source and hold a permanent want while preload is set, wherever the
     * node is. Runs before the walk (RendererCore.update).
     */
    drainPreloads() {
        const s = this.nodes;
        const store = this.store;
        // The live count, and the list read each time (queuePreload may grow
        // it): a node listed while the drain runs is drained in this pass, not
        // dropped with ST_PRELOAD_QUEUED still set and never listed again.
        for (let i = 0; i < s.preloadCount; i++) {
            const id = s.preloads[i];
            s.u32[id * I_STRIDE + I_STATE] =
                s.u32[id * I_STRIDE + I_STATE] & ~ST_PRELOAD_QUEUED;
            if (s.i32[id * I_STRIDE + I_UID] === 0) {
                continue;
            }
            const state = s.u32[id * I_STRIDE + I_STATE];
            if ((state & ST_PRELOAD) !== 0) {
                const src = this.sourceOf(id);
                if (src !== s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]) {
                    this.switchSource(id, src);
                    this.sizeCacheHit(id, src);
                }
                if (src !== NULL &&
                    (s.u32[id * I_STRIDE + I_STATE] & ST_PRELOAD_WANT) === 0) {
                    s.u32[id * I_STRIDE + I_STATE] =
                        s.u32[id * I_STRIDE + I_STATE] | ST_PRELOAD_WANT;
                    store.want(store.pixelsOf(src), false);
                }
            }
            else if ((state & ST_PRELOAD_WANT) !== 0) {
                s.u32[id * I_STRIDE + I_STATE] = state & ~ST_PRELOAD_WANT;
                const src = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
                if (src !== NULL) {
                    store.unwant(store.pixelsOf(src));
                }
            }
        }
        s.preloadCount = 0;
    }
    /**
     * The drain switched node `id` to source `src`: an uploaded record taken
     * at once (a cache hit) sizes the node now, wherever it is, as a load
     * does (notifyOwners): its loaded event, delivered after the draw, reads
     * the size (1.10), and before the walk the sizes cost no re-walk.
     */
    sizeCacheHit(id, src) {
        const store = this.store;
        const shown = this.nodes.i32[id * I_STRIDE + I_TEXTURE];
        if (src === NULL ||
            shown !== store.pixelsOf(src) ||
            store.state[shown] !== TX_UPLOADED) {
            return;
        }
        this.applyTexSize(id);
        this.applyAutosize(id);
    }
    /**
     * The record node `id`'s source resolves to, or NULL: the assigned
     * texture's record, or the image record for its src and crop (looked up
     * in the cache, created on first use).
     */
    sourceOf(id) {
        const s = this.nodes;
        if ((s.u32[id * I_STRIDE + I_STATE] & ST_SRC) === 0) {
            const ref = s.textureRefs[id];
            return ref === null ? NULL : textureRecord(this.store, ref);
        }
        const src = s.srcs[id];
        const e = s.extras[id];
        const sx = e === null ? null : e.srcX ?? null;
        const sy = e === null ? null : e.srcY ?? null;
        const sw = e === null ? null : e.srcWidth ?? null;
        const sh = e === null ? null : e.srcHeight ?? null;
        const type = e === null ? null : e.imageType ?? null;
        const store = this.store;
        const current = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
        if (current !== NULL && store.kind[current] === KIND_IMAGE) {
            const p = store.props[current];
            // A texture assigned before the src can name the same src with other
            // options: it is this src's record only with the defaults.
            if (p.src === src &&
                p.premultiplyAlpha !== false &&
                (p.key === undefined || p.key === null || p.key === '') &&
                (p.sx ?? null) === sx &&
                (p.sy ?? null) === sy &&
                (p.sw ?? null) === sw &&
                (p.sh ?? null) === sh &&
                (p.type ?? null) === type) {
                return current;
            }
        }
        const key = imageKey(src, null, true, sx, sy, sw, sh);
        if (key !== null) {
            const cached = store.cache.get(key);
            if (cached !== undefined) {
                return cached;
            }
        }
        // Complete, in createTexture's shape: a handle made for this record
        // later reads these.
        const props = {
            src,
            premultiplyAlpha: true,
            key: null,
            type,
            w: s.f64[id * F_STRIDE + F_W],
            h: s.f64[id * F_STRIDE + F_H],
            sx,
            sy,
            sw,
            sh,
            maxRetryCount: store.maxRetries,
        };
        return store.create(KIND_IMAGE, props, key);
    }
    /**
     * Point node `id`'s source at `rec`. Its wants move with it. The old
     * image stays on screen until the new one is uploaded (spec 9.4), unless
     * nothing was showing or the new one is already there or failed. A node
     * whose textureOptions ask for preventCleanup marks the record and its
     * pixels (a SubTexture's sheet) when it takes them.
     */
    switchSource(id, rec) {
        const s = this.nodes;
        const store = this.store;
        const state = s.u32[id * I_STRIDE + I_STATE];
        const wants = (state & ST_WANT) !== 0;
        const preload = (state & ST_PRELOAD_WANT) !== 0;
        const old = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
        if (old !== NULL) {
            store.removeOwner(old, id);
            store.unref(old);
            const pixels = store.pixelsOf(old);
            if (wants === true) {
                store.unwant(pixels);
            }
            if (preload === true) {
                store.unwant(pixels);
            }
        }
        s.i32[id * I_STRIDE + I_SOURCE_TEXTURE] = rec;
        if (rec === NULL) {
            this.show(id, NULL);
            return;
        }
        store.addOwner(rec, id);
        store.ref(rec);
        const pixels = store.pixelsOf(rec);
        const options = s.textureOptions[id];
        if (options !== null && options.preventCleanup === true) {
            // Sticky: a node without the option leaves it set (1.10 let the last
            // node to take the texture decide, spec 14); the handle clears it.
            store.setPreventCleanup(rec, true);
            if (pixels !== rec) {
                store.setPreventCleanup(pixels, true);
            }
        }
        if (wants === true) {
            store.want(pixels, visibilityOf(state) === VIS_IN_VIEWPORT);
        }
        if (preload === true) {
            store.want(pixels, false);
        }
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        const uploaded = store.state[pixels] === TX_UPLOADED;
        const failed = store.failedForGood(pixels);
        if (shown !== NULL &&
            shown !== pixels &&
            store.state[shown] === TX_UPLOADED &&
            uploaded === false &&
            failed === false) {
            return;
        }
        this.show(id, pixels);
        // Already there (a cache hit): its loaded or failed event is this
        // node's, and autosize applies as on a load (1.10).
        if (uploaded === true) {
            s.u32[id * I_STRIDE + I_STATE] =
                s.u32[id * I_STRIDE + I_STATE] | ST_AUTOSIZE_DUE;
            this.loaded(id, rec);
        }
        else if (failed === true) {
            this.failedNode(id, pixels);
        }
    }
    /** Draw `rec`'s pixels on node `id` (its wants and references follow). */
    show(id, rec) {
        const s = this.nodes;
        const store = this.store;
        const old = s.i32[id * I_STRIDE + I_TEXTURE];
        if (old === rec) {
            return;
        }
        const state = s.u32[id * I_STRIDE + I_STATE];
        const wants = (state & ST_WANT) !== 0;
        if (old !== NULL) {
            store.unref(old);
            if (wants === true) {
                store.unwant(old);
            }
        }
        s.i32[id * I_STRIDE + I_TEXTURE] = rec;
        if (rec !== NULL) {
            store.ref(rec);
            if (wants === true) {
                store.want(rec, visibilityOf(state) === VIS_IN_VIEWPORT);
            }
        }
    }
    /**
     * Not hidden by world alpha 0: a node the pass is visiting has a current
     * world alpha, and a node an alpha-0 ancestor hid holds ST_HIDDEN until
     * its first visit shown (onShown then takes the wants).
     */
    shown(id, state) {
        return ((state & ST_HIDDEN) === 0 &&
            this.nodes.f64[id * F_STRIDE + F_WORLD_ALPHA] !== 0);
    }
    addWants(id, viewport) {
        const s = this.nodes;
        const store = this.store;
        s.u32[id * I_STRIDE + I_STATE] = s.u32[id * I_STRIDE + I_STATE] | ST_WANT;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        if (shown !== NULL) {
            store.want(shown, viewport);
        }
        const src = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
        if (src !== NULL) {
            store.want(store.pixelsOf(src), viewport);
        }
    }
    dropWants(id) {
        const s = this.nodes;
        const store = this.store;
        s.u32[id * I_STRIDE + I_STATE] = s.u32[id * I_STRIDE + I_STATE] & ~ST_WANT;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        if (shown !== NULL) {
            store.unwant(shown);
        }
        const src = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
        if (src !== NULL) {
            store.unwant(store.pixelsOf(src));
        }
    }
    /**
     * Derive what node `id` shows: its texture size (contain, and autosize
     * when due), its UVs, and ST_CONTENT_READY. In the walk, a size change
     * that moves or resizes the node defers ST_CONTENT_READY to the next walk
     * (a re-walk of the same frame, or the next frame after a chunk flush),
     * so that the image is never drawn with the previous transform.
     */
    refresh(id) {
        const s = this.nodes;
        const store = this.store;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        const writes = s.writes;
        if (shown === NULL || store.state[shown] !== TX_UPLOADED) {
            s.u32[id * I_STRIDE + I_STATE] =
                s.u32[id * I_STRIDE + I_STATE] & ~ST_CONTENT_READY;
            const sizeless = shown === NULL || store.w[shown] === 0;
            if (sizeless === true) {
                // No texture, or a record that never loaded (failed: the node's
                // placeholder; or still loading): the unit square, as 1.10 used its
                // default texture coords until a texture loaded, so that a shader
                // drawing from them (a gradient, a hole) covers the node and a
                // growing program's u_uvRect equals that of every other node
                // without one, not the crop of an image shown before.
                s.u32[id * I_STRIDE + I_UV0] = UV_TL;
                s.u32[id * I_STRIDE + I_UV1] = UV_BR;
                s.f32[id * I_STRIDE + I_UV_X1] = 0;
                s.f32[id * I_STRIDE + I_UV_Y1] = 0;
                s.f32[id * I_STRIDE + I_UV_X2] = 1;
                s.f32[id * I_STRIDE + I_UV_Y2] = 1;
            }
            // Nothing shown, or a record that never loaded: no size either.
            if (sizeless === true && s.f64[id * F_STRIDE + F_TEX_W] !== 0) {
                s.f64[id * F_STRIDE + F_TEX_W] = 0;
                s.f64[id * F_STRIDE + F_TEX_H] = 0;
                if ((s.u32[id * I_STRIDE + I_STATE] & ST_CONTAIN) !== 0) {
                    s.markDirty(id, DIRTY_LOCAL);
                    this.sizedInWalk(id, writes);
                }
            }
            return;
        }
        // Sizes follow the source once its pixels are shown; mid-switch the old
        // image keeps the ones it had.
        if (store.pixelsOf(s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]) === shown) {
            const contain = this.applyTexSize(id);
            const autosize = this.applyAutosize(id);
            if (contain === true || autosize === true) {
                s.u32[id * I_STRIDE + I_STATE] =
                    s.u32[id * I_STRIDE + I_STATE] & ~ST_CONTENT_READY;
                s.markDirty(id, DIRTY_TEXTURE);
                this.sizedInWalk(id, writes);
                return;
            }
        }
        this.packShown(id);
        s.u32[id * I_STRIDE + I_STATE] =
            s.u32[id * I_STRIDE + I_STATE] | ST_CONTENT_READY;
    }
    /**
     * Node `id` took a size in the walk that moves or resizes it: its writes
     * make RendererCore walk again, so that a node in the viewport draws in
     * this frame. A leaf in the margin is not drawn this frame either way:
     * its writes (made since `s.writes` read `writes`) are taken back from
     * the walk's count, and its next visit, in the next frame (the writes
     * request it), composes it with the size before it can be drawn. On the
     * scroll path that saves a walk for each cached image brought into the
     * margin; a margin node the new size brings into the viewport draws from
     * that next frame, as after a load. A node with children keeps the
     * re-walk: a child can reach into the viewport.
     */
    sizedInWalk(id, writes) {
        const s = this.nodes;
        if (visibilityOf(s.u32[id * I_STRIDE + I_STATE]) !== VIS_IN_VIEWPORT &&
            s.i32[id * I_STRIDE + I_FIRST_CHILD] === NULL) {
            s.writes = writes;
        }
    }
    /**
     * Store the size node `id`'s source shows at; true when that changed its
     * transform (contain).
     */
    applyTexSize(id) {
        const s = this.nodes;
        this.measure(s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]);
        const w = this.dimW;
        const h = this.dimH;
        if (s.f64[id * F_STRIDE + F_TEX_W] === w &&
            s.f64[id * F_STRIDE + F_TEX_H] === h) {
            return false;
        }
        s.f64[id * F_STRIDE + F_TEX_W] = w;
        s.f64[id * F_STRIDE + F_TEX_H] = h;
        if ((s.u32[id * I_STRIDE + I_STATE] & ST_CONTAIN) === 0) {
            return false;
        }
        s.markDirty(id, DIRTY_LOCAL);
        return true;
    }
    /**
     * Size node `id` to its source when autosize is due (turned on, or a
     * texture taken: a load or a cache hit), as 1.10 did on those only, so
     * a w/h written since stays; true when its size changed. A text node's
     * size is its layout's: autosize does nothing on one (1.10).
     */
    applyAutosize(id) {
        const s = this.nodes;
        const state = s.u32[id * I_STRIDE + I_STATE];
        if ((state & ST_AUTOSIZE_DUE) === 0) {
            return false;
        }
        s.u32[id * I_STRIDE + I_STATE] = state & ~ST_AUTOSIZE_DUE;
        if ((state & (ST_AUTOSIZE | ST_TEXT)) !== ST_AUTOSIZE) {
            return false;
        }
        this.measure(s.i32[id * I_STRIDE + I_SOURCE_TEXTURE]);
        const w = this.dimW;
        const h = this.dimH;
        if (s.f64[id * F_STRIDE + F_W] === w && s.f64[id * F_STRIDE + F_H] === h) {
            return false;
        }
        s.applySize(id, w, h);
        return true;
    }
    /** The size a record shows at (a SubTexture: its region) into dimW / dimH. */
    measure(rec) {
        const store = this.store;
        if (store.kind[rec] === KIND_SUB) {
            const region = store.props[rec];
            this.dimW = region.w;
            this.dimH = region.h;
            return;
        }
        this.dimW = store.w[rec];
        this.dimH = store.h[rec];
    }
    /**
     * Pack node `id`'s UVs for the uploaded image it shows: its source's
     * region and size or, mid-switch, the old image's own size. A sprite
     * sheet shown mid-switch keeps the UVs it had: the region it showed is
     * not known any more.
     */
    packShown(id) {
        const s = this.nodes;
        const store = this.store;
        const src = s.i32[id * I_STRIDE + I_SOURCE_TEXTURE];
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        if (store.pixelsOf(src) === shown) {
            this.packUv(id, src);
        }
        else if (store.subs[shown] === null) {
            this.packUv(id, shown);
        }
    }
    /** Pack node `id`'s UVs for the image it shows at `rec`'s region and size. */
    packUv(id, rec) {
        const s = this.nodes;
        const store = this.store;
        const shown = s.i32[id * I_STRIDE + I_TEXTURE];
        const sub = store.kind[rec] === KIND_SUB ? store.props[rec] : null;
        this.measure(rec);
        resolveUvRect(this.rect, 0, 0, store.u2[shown], store.v2[shown], sub, store.w[shown], store.h[shown], s.textureOptions[id], s.f64[id * F_STRIDE + F_W], s.f64[id * F_STRIDE + F_H], this.dimW, this.dimH);
        const rect = this.rect;
        const o = id * I_STRIDE;
        packUv(s.u32, o + I_UV0, o + I_UV1, rect);
        const f32 = s.f32;
        f32[o + I_UV_X1] = rect[0];
        f32[o + I_UV_Y1] = rect[1];
        f32[o + I_UV_X2] = rect[2];
        f32[o + I_UV_Y2] = rect[3];
    }
    /**
     * Record `rec` uploaded (`ok`) or failed for good: every node asking for
     * it, directly or through a SubTexture, switches to it, takes its size
     * and resolves again next frame (the pixels draw from the frame after
     * the upload); its handles and the nodes get their events.
     */
    notify(rec, ok) {
        const store = this.store;
        this.notifyOwners(rec, rec, ok);
        const subs = store.subs[rec];
        if (subs !== null) {
            for (let i = 0; i < subs.length; i++) {
                this.notifyOwners(subs[i], rec, ok);
            }
        }
    }
    /**
     * Memory cleanup freed `rec` (spec 9.5): its owners resolve again (it
     * reloads when one is next in bounds), and they and its handle hear
     * `freed` (1.10).
     */
    freed(rec) {
        const store = this.store;
        this.freedOwners(rec);
        const subs = store.subs[rec];
        if (subs !== null) {
            for (let i = 0; i < subs.length; i++) {
                this.freedOwners(subs[i]);
            }
        }
    }
    freedOwners(listRec) {
        const s = this.nodes;
        const store = this.store;
        const handle = store.handles[listRec];
        if (handle !== null) {
            this.events.queue(handle, 'freed', null);
        }
        let id = store.ownerHead[listRec];
        while (id !== NULL) {
            // A backstop: an owner of a freed record is away (out of bounds or
            // hidden, as a cleanup frees only what nobody wants), and back()
            // parks its resolve when it returns. Kept, conservatively, with the
            // frame it requests, as 1.10 requested a render on freed.
            s.markDirty(id, DIRTY_TEXTURE);
            const node = s.handles[id];
            if (node.hasListener('freed') === true) {
                this.events.queue(node, 'freed', { type: 'texture' });
            }
            id = s.i32[id * I_STRIDE + I_OWNER_NEXT];
        }
    }
    /**
     * Decoded `rec` waits for room (doNotExceedCriticalThreshold): the nodes
     * asking for it, directly or through a SubTexture, stop showing the old
     * image they kept mid-switch (spec 9.4). Shown, it stays wanted, and its
     * bytes may be the only room a cleanup can make for `rec`, so the new
     * image would wait behind the one it replaces for good. Such a node shows
     * `rec`'s pixels, as back() does: its placeholder color or nothing until
     * they arrive, as 1.10 did on every swap (never its color, which a node
     * showing no texture at all would draw).
     */
    held(rec) {
        const store = this.store;
        this.releaseShown(rec, rec);
        const subs = store.subs[rec];
        if (subs !== null) {
            for (let i = 0; i < subs.length; i++) {
                this.releaseShown(subs[i], rec);
            }
        }
    }
    releaseShown(listRec, pixels) {
        const s = this.nodes;
        let id = this.store.ownerHead[listRec];
        while (id !== NULL) {
            const shown = s.i32[id * I_STRIDE + I_TEXTURE];
            if (shown !== NULL && shown !== pixels) {
                this.show(id, pixels);
                // Resolves again in its next visit, so it is not drawn with the
                // old image's content flag.
                s.markDirty(id, DIRTY_TEXTURE);
            }
            id = s.i32[id * I_STRIDE + I_OWNER_NEXT];
        }
    }
    /**
     * A failure with a retry to come: the handles hear of it (1.10 emitted
     * `failed` on every attempt); the nodes wait for the outcome.
     */
    failedHandles(rec) {
        const store = this.store;
        const error = store.errors[rec];
        const handle = store.handles[rec];
        if (handle !== null) {
            this.events.queue(handle, 'failed', error);
        }
        const subs = store.subs[rec];
        if (subs !== null) {
            for (let i = 0; i < subs.length; i++) {
                const sub = store.handles[subs[i]];
                if (sub !== null) {
                    this.events.queue(sub, 'failed', error);
                }
            }
        }
    }
    notifyOwners(listRec, pixels, ok) {
        const s = this.nodes;
        const store = this.store;
        const handle = store.handles[listRec];
        if (handle !== null) {
            if (ok === true) {
                this.measure(listRec);
                this.events.queue(handle, 'loaded', { w: this.dimW, h: this.dimH });
            }
            else {
                this.events.queue(handle, 'failed', store.errors[pixels]);
            }
        }
        let id = store.ownerHead[listRec];
        while (id !== NULL) {
            const next = s.i32[id * I_STRIDE + I_OWNER_NEXT];
            this.show(id, pixels);
            s.markDirty(id, DIRTY_TEXTURE);
            if (ok === true) {
                // Before the event, so a listener reads the autosized w/h (1.10).
                s.u32[id * I_STRIDE + I_STATE] =
                    s.u32[id * I_STRIDE + I_STATE] | ST_AUTOSIZE_DUE;
                this.applyTexSize(id);
                this.applyAutosize(id);
                this.loaded(id, listRec);
            }
            else {
                this.failedNode(id, pixels);
            }
            id = next;
        }
    }
    /**
     * Node `id`'s loaded event, with its source's size; a side of 1 is
     * skipped (1.10). Like the node's failed and freed, it is queued only
     * for a node listening to it as it is raised (1.10 emitted it then):
     * most nodes listen to nothing, and the payload is two objects.
     */
    loaded(id, rec) {
        const node = this.nodes.handles[id];
        if (node.hasListener('loaded') === false) {
            return;
        }
        this.measure(rec);
        if (this.dimW > 1 && this.dimH > 1) {
            this.events.queue(node, 'loaded', {
                type: 'texture',
                dimensions: { w: this.dimW, h: this.dimH },
            });
        }
    }
    failedNode(id, pixels) {
        const node = this.nodes.handles[id];
        if (node.hasListener('failed') === true) {
            this.events.queue(node, 'failed', {
                type: 'texture',
                error: this.store.errors[pixels],
            });
        }
    }
}
//# sourceMappingURL=TextureNodes.js.map