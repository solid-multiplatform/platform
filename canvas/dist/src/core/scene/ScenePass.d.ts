import type { BoundsMargin } from '../../common/types.js';
import type { NodeStore } from '../nodes/NodeStore.js';
import type { ClipStore } from './ClipStore.js';
import type { VertexStream } from '../gl/VertexStream.js';
import type { OpList } from '../gl/OpList.js';
export interface Viewport {
    /** Logical viewport size. */
    w: number;
    h: number;
    /** Bounds margin (preload runway) in logical px, [top, right, bottom, left]. */
    margin: BoundsMargin;
    /** Device pixels per logical pixel. */
    pixelRatio: number;
    /** Canvas height in device pixels (scissor origin is bottom-left). */
    canvasH: number;
}
/**
 * Seams for later phases. Every member has a no-op default (see nullHooks).
 * `resolveTexture` and `packShader` are skipped while the node is out of
 * bounds: the work is parked and runs on its next visit in bounds.
 */
export interface PassHooks {
    /** DIRTY_TEXTURE, on a node that is in bounds (the margin included). */
    resolveTexture(id: number): void;
    /** DIRTY_SHADER (shader, a shader prop, or w/h), on a node in bounds. */
    packShader(id: number): void;
    /**
     * DIRTY_LAYOUT on a visited text node (phase 5: TextNodes), before its
     * transform is composed. Returns the dirty bits the layout raised on the
     * node (DIRTY_LOCAL | DIRTY_SHADER for a new size, DIRTY_LOCAL for a
     * moved block), which the visit takes at once, so the node is composed,
     * culled and drawn with them in this walk; renderability is derived
     * again. -1 leaves DIRTY_LAYOUT pending for the next visit.
     */
    layoutText(id: number): number;
    /**
     * Emit a queued text node: write its glyph quads into the shared stream
     * and add their ops to the shared op list, calling ScenePass.flush when
     * the stream is full. Runs after the walk, or before a non-text quad with
     * a non-zero zIndex (spec 7.3).
     */
    emitText(id: number): void;
    /**
     * The node's visibility changed from `prev` to `next` (stored before the
     * call). In bounds, a resolve due in this visit, parked while the node
     * was out or already due, reads as parked (ST_DEFER_TEXTURE) and runs in
     * this visit after the hook, as does one the hook parks.
     */
    onVisibility(id: number, prev: number, next: number): void;
    /**
     * The node, in bounds, was just hidden by world alpha 0: its own, or an
     * ancestor's whose subtree the pass stops visiting (1.10 released texture
     * ownership at world alpha 0). True when it wants onShown on its next
     * visit with world alpha above 0. Visibility does not change. Once per
     * hiding: a node told already (ST_HIDDEN) is not told again by a sweep
     * inside its hidden subtree until it is shown.
     */
    onHidden(id: number): boolean;
    /**
     * The node, in bounds, is visited shown again after it was hidden, before
     * the texture step: a resolve already due in this visit reads as parked
     * (ST_DEFER_TEXTURE), as on a return into bounds, and one it parks runs
     * in this visit. The node culled by its own world alpha 0 hears it
     * whatever onHidden returned (it may have gained a source while culled),
     * so it must be idempotent.
     */
    onShown(id: number): void;
    /**
     * The node's program declares per-op uniforms (`ST_PER_OP`): can its quad
     * join the op whose first node is `opNode` (a glyph op's text node
     * included, since one op list carries quads and glyphs)? Asked only when
     * the quad's program, params block, texture and clip match the op's: a
     * quad whose keys differ starts an op without asking.
     */
    perOpMatch(id: number, opNode: number): boolean;
    /**
     * The node's renderability changed (`ST_RENDERABLE`, stored before the
     * call): it is drawn from this walk on, or no longer. Called only in a
     * build with `__emitBoundsEvents__` on (phase 6: its `renderable` event),
     * on the visit that re-derives it and for each node a culling sweep marks
     * out. A node under a subtree culled by world alpha 0 is not visited, so
     * it is not told here: the bounds events tell it from onHidden and clear
     * its bit (it is not drawn while hidden), and the visit that shows it
     * again re-derives the bit (DIRTY_RENDERABLE, raised in this build only).
     */
    onRenderable(id: number, renderable: boolean): void;
}
export declare function nullHooks(): PassHooks;
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
export declare class ScenePass {
    visited: number;
    updated: number;
    emitted: number;
    /**
     * The text nodes the walk emitted (queued and flushed), counted per
     * flush: `emitted` counts them too, once each.
     */
    textEmitted: number;
    hooks: PassHooks;
    /**
     * Draws and resets the current chunk (RendererCore's flush). The pass
     * calls it before a quad that does not fit; a text emitter calls it the
     * same way between glyph quads.
     */
    readonly flush: () => void;
    private readonly nodes;
    private readonly clips;
    readonly view: Viewport;
    private readonly stream;
    private readonly ops;
    private stack;
    private maskStack;
    private sweepStack;
    /** Text nodes queued by this walk, in walk order (spec 7.3). */
    private pendingText;
    private pendingCount;
    constructor(nodes: NodeStore, clips: ClipStore, view: Viewport, stream: VertexStream, ops: OpList, hooks: PassHooks, flush: () => void);
    /**
     * markDirty calls since the current (or last) walk started, including
     * ones made by callbacks after it: `run` zeroes the store's counter.
     * Less the ones TextureNodes takes back: a texture size a leaf in the
     * bounds margin takes in the walk (it is not drawn this frame either
     * way, and its next visit composes it with the size before it can be
     * drawn: spec 6.1).
     */
    get writesDuringPass(): number;
    /**
     * The quads the last walk wrote, chunks it flushed included, glyph quads
     * not: telemetry's `quads` (1.10 kept glyphs in a buffer of their own and
     * did not count them). Derived from the counters, so no quad pays for it.
     */
    get quads(): number;
    run(root: number): void;
    private growStack;
    private growSweepStack;
    /**
     * Update one node. Returns the inherit mask for its children, or -1 when
     * the subtree is culled (out of bounds or world alpha zero) or a hook
     * destroyed the node.
     */
    private visit;
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
    private sweepOut;
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
    private sweepHidden;
    /**
     * Sweep one descendant out; false when its subtree needs no sweep. Only
     * the visibility and ST_RENDERABLE change: dirty bits and parked work
     * (ST_DEFERRED) stay for the node's next visit.
     */
    private markOut;
    private updateClip;
    /** 1.10 checkRenderBounds on the store. */
    private classify;
    /** Premultiplied corner colors plus the derived HAS_COLOR / PLACEHOLDER bits. */
    private premultiply;
    /**
     * 1.10 updateIsRenderable on the store. Size counts when non-zero, as in
     * 1.10's hasDimensions: a negative width or height still renders.
     */
    private deriveRenderable;
    private emit;
    private queueText;
    /**
     * Emit the queued text nodes in queue order and empty the queue. The
     * emitter writes each node's glyphs into the same stream and op list, so
     * consecutive nodes' glyphs merge into one op per atlas and clip. A node
     * destroyed since it was queued is skipped.
     */
    private flushText;
}
