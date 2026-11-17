import type { FrameEvents } from '../FrameEvents.js';
import { type TextureStore } from './TextureStore.js';
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
export declare class TextureNodes {
    private readonly store;
    private readonly nodes;
    private readonly events;
    private readonly rect;
    /** The size `measure` found. */
    private dimW;
    private dimH;
    constructor(store: TextureStore, events: FrameEvents);
    /**
     * PassHooks.resolveTexture: DIRTY_TEXTURE on a node in bounds. Resolves
     * the source to a record (creating it the first time: spec 9.2, no record
     * before a node is in bounds), takes the node's wants, and derives what
     * it shows: size, UVs and ST_CONTENT_READY.
     */
    resolveTexture(id: number): void;
    /**
     * PassHooks.onVisibility: wants follow the bounds (spec 9.2). Entering
     * the viewport promotes a queued load ahead of the margin.
     */
    onVisibility(id: number, prev: number, next: number): void;
    /**
     * PassHooks.onHidden: node `id`, in bounds, is hidden by world alpha 0
     * (its own or an ancestor's), so its visibility wants go, as 1.10
     * released texture ownership at world alpha 0; preload wants stay. It
     * asks for onShown when it has a source to want again.
     */
    onHidden(id: number): boolean;
    /**
     * PassHooks.onShown: node `id`, in bounds, is shown again: it wants its
     * pixels back, after the check for what was freed while it was hidden.
     * A resolve due in this visit (ST_DEFER_TEXTURE, as the pass hands it
     * over) takes the wants of the source it resolves to instead, as on a
     * return into bounds.
     */
    onShown(id: number): void;
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
    private back;
    /**
     * The texture part of PassHooks.packShader (DIRTY_SHADER, which every
     * w/h change raises): a cover crop depends on the node's size. Contain
     * needs nothing here: composeWorld recomputes it.
     */
    onResize(id: number): void;
    /**
     * RendererCore.createTexture made SubTexture record `rec`: on a parent
     * already uploaded, failed or freed, its handle's event is queued now and
     * delivered after the frame's draw or from a zero-delay timer, as 1.10
     * told a new SubTexture in a microtask (a listener added in the same task
     * hears it; `loading` is no event in v2).
     */
    subTextureCreated(rec: number): void;
    /** RendererCore.releaseNode: a destroyed node lets go of its records. */
    release(id: number): void;
    /**
     * Preload (spec 9.2) for the nodes NodeStore.queuePreload listed: resolve
     * the source and hold a permanent want while preload is set, wherever the
     * node is. Runs before the walk (RendererCore.update).
     */
    drainPreloads(): void;
    /**
     * The drain switched node `id` to source `src`: an uploaded record taken
     * at once (a cache hit) sizes the node now, wherever it is, as a load
     * does (notifyOwners): its loaded event, delivered after the draw, reads
     * the size (1.10), and before the walk the sizes cost no re-walk.
     */
    private sizeCacheHit;
    /**
     * The record node `id`'s source resolves to, or NULL: the assigned
     * texture's record, or the image record for its src and crop (looked up
     * in the cache, created on first use).
     */
    private sourceOf;
    /**
     * Point node `id`'s source at `rec`. Its wants move with it. The old
     * image stays on screen until the new one is uploaded (spec 9.4), unless
     * nothing was showing or the new one is already there or failed. A node
     * whose textureOptions ask for preventCleanup marks the record and its
     * pixels (a SubTexture's sheet) when it takes them.
     */
    private switchSource;
    /** Draw `rec`'s pixels on node `id` (its wants and references follow). */
    private show;
    /**
     * Not hidden by world alpha 0: a node the pass is visiting has a current
     * world alpha, and a node an alpha-0 ancestor hid holds ST_HIDDEN until
     * its first visit shown (onShown then takes the wants).
     */
    private shown;
    private addWants;
    private dropWants;
    /**
     * Derive what node `id` shows: its texture size (contain, and autosize
     * when due), its UVs, and ST_CONTENT_READY. In the walk, a size change
     * that moves or resizes the node defers ST_CONTENT_READY to the next walk
     * (a re-walk of the same frame, or the next frame after a chunk flush),
     * so that the image is never drawn with the previous transform.
     */
    private refresh;
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
    private sizedInWalk;
    /**
     * Store the size node `id`'s source shows at; true when that changed its
     * transform (contain).
     */
    private applyTexSize;
    /**
     * Size node `id` to its source when autosize is due (turned on, or a
     * texture taken: a load or a cache hit), as 1.10 did on those only, so
     * a w/h written since stays; true when its size changed. A text node's
     * size is its layout's: autosize does nothing on one (1.10).
     */
    private applyAutosize;
    /** The size a record shows at (a SubTexture: its region) into dimW / dimH. */
    private measure;
    /**
     * Pack node `id`'s UVs for the uploaded image it shows: its source's
     * region and size or, mid-switch, the old image's own size. A sprite
     * sheet shown mid-switch keeps the UVs it had: the region it showed is
     * not known any more.
     */
    private packShown;
    /** Pack node `id`'s UVs for the image it shows at `rec`'s region and size. */
    private packUv;
    /**
     * Record `rec` uploaded (`ok`) or failed for good: every node asking for
     * it, directly or through a SubTexture, switches to it, takes its size
     * and resolves again next frame (the pixels draw from the frame after
     * the upload); its handles and the nodes get their events.
     */
    private notify;
    /**
     * Memory cleanup freed `rec` (spec 9.5): its owners resolve again (it
     * reloads when one is next in bounds), and they and its handle hear
     * `freed` (1.10).
     */
    private freed;
    private freedOwners;
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
    private held;
    private releaseShown;
    /**
     * A failure with a retry to come: the handles hear of it (1.10 emitted
     * `failed` on every attempt); the nodes wait for the outcome.
     */
    private failedHandles;
    private notifyOwners;
    /**
     * Node `id`'s loaded event, with its source's size; a side of 1 is
     * skipped (1.10). Like the node's failed and freed, it is queued only
     * for a node listening to it as it is raised (1.10 emitted it then):
     * most nodes listen to nothing, and the payload is two objects.
     */
    private loaded;
    private failedNode;
}
