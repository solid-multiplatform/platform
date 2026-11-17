import type { FrameEvents } from '../FrameEvents.js';
import { type NodeStore } from '../nodes/NodeStore.js';
import type { TextState } from '../nodes/TextNode.js';
import type { FontRegistry } from './FontRegistry.js';
import { LayoutCache, type TextBaselineMode, type TextLayout } from './TextLayout.js';
/**
 * The node side of text (spec 10): the scene pass's `layoutText`, the
 * wait lists of the nodes whose font is not there yet, the forceLoad
 * nodes laid out before the walk, and the layout cache. A text node lays
 * out from its font's description, before the walk composes it, takes the
 * layout's size in that visit (NodeStore.applySizeInVisit) and hears
 * `loaded` between walks (RendererCore.update), and is ready to draw once
 * its font's atlas is uploaded. `measure` lays it out earlier, outside the
 * walk, and the visit then reuses that layout.
 */
export declare class TextNodes {
    /** Layouts by content, shared by every node (spec 10.2). */
    readonly cache: LayoutCache;
    /** The renderer's baseline anchor (1.10's engine-wide textBaselineMode). */
    readonly baselineMode: TextBaselineMode;
    private readonly nodes;
    private readonly fonts;
    /** `loaded`, delivered between walks; `failed` waits for the frame's events. */
    private readonly loadedEvents;
    private readonly events;
    /** Node ids waiting on each font name, made on demand (a node created before loadFont waits too). */
    private readonly waiting;
    /** Text nodes with forceLoad set. */
    private readonly forced;
    /** Layouts layoutAhead makes per idle maintenance pass (settings.idleTextLayouts). */
    private readonly idleLayouts;
    constructor(nodes: NodeStore, fonts: FontRegistry, loadedEvents: FrameEvents, events: FrameEvents, cacheSize: number, baselineMode: TextBaselineMode, idleLayouts: number);
    /**
     * PassHooks.layoutText: DIRTY_LAYOUT on a visited text node, before the
     * visit composes it (or a forceLoad one, before the walk). Without its
     * font's description it waits, drawing nothing; with it, it lays out
     * when a prop the layout reads changed (from the cache when another node
     * laid the same text out the same way), takes the size and queues
     * `loaded`, places its block, and is ready to draw when the atlas is up
     * (else it waits for that). Returns the dirty bits the size and the
     * block raised (DIRTY_LOCAL | DIRTY_SHADER, DIRTY_LOCAL), which the visit
     * takes: the node is drawn in this walk with the transform they give.
     * Never -1: the wait lists raise DIRTY_LAYOUT again when the font
     * changes, so nothing is left pending.
     */
    layoutText(id: number): number;
    /**
     * TextNode.measure: lay text node `id` out now, outside the walk, when a
     * layout is due (a prop the layout reads changed, or its font), for a
     * framework that sizes its layout by the text before the frame. The size
     * goes through applySize (DIRTY_LOCAL | DIRTY_SHADER, composed by the
     * next walk) and DIRTY_LAYOUT stays raised: the visit finds the layout
     * current, so it only places the block and derives readiness. `loaded`
     * is queued as the visit queues it. Returns false, changing nothing,
     * while the font's description is missing (the walk lays the node out
     * once it arrives); true otherwise.
     */
    measure(id: number): boolean;
    /**
     * Lay `t` out in `font` (from the cache when another node laid the same
     * text out the same way), make it the node's layout, and queue `loaded`
     * for a listener. The caller applies the size.
     */
    private lay;
    /**
     * RendererCore.measureText: lay `t` out ahead of any node, into the
     * cache a text node with the same text props lays out from (its visit
     * then looks the layout up instead of laying out in its frame). No node,
     * no event, no frame. Returns the layout, or null while the font's
     * description is missing.
     */
    measureAhead(t: TextState): TextLayout | null;
    /**
     * Idle maintenance: lay out, into the cache, up to `idleLayouts` text
     * nodes a layout is due for that no walk has visited (beyond the bounds
     * margin, under a hidden parent), from their text props as they are now,
     * as measureAhead does: the visit that brings one in looks its layout up
     * (taking the size, telling `loaded` and placing it as ever) instead of
     * laying it out in its frame. The nodes are not touched: no size, no
     * event, no frame. A layout the cache has already is not made again nor
     * counted. Returns how many were made.
     */
    layoutAhead(): number;
    /**
     * The layout of `t` in `font` from the cache, else laid out and cached.
     * By the record, not a name: a font loaded again under its name (a
     * failed load, retried) may lay text out differently.
     */
    private cached;
    /**
     * Before every walk: lay out the forceLoad nodes a layout is due for,
     * which the walk may not visit (a parent out of bounds or hidden), as
     * 1.10 laid them out whatever their parent's visibility. What the layout
     * raised is marked for their next visit, which composes them and derives
     * their renderability.
     */
    drainForced(): void;
    /** forceLoad set or cleared on text node `id` (the setter). */
    force(id: number, on: boolean): void;
    /** RendererCore.releaseNode: a destroyed text node leaves its lists. */
    release(id: number): void;
    /** Idle maintenance: the layout cache back to its size. */
    trim(): void;
    /**
     * The box the block is placed by (1.10 CoreTextNode.updateLocalTransform):
     * with `contain` on an axis and a max size there, mount and pivot use the
     * max size and the block aligns inside it by `textAlign`; a height above
     * the text's (`maxHeight`) places it by `verticalAlign`; `offsetY` moves
     * it down. Returns DIRTY_LOCAL when that changed (NaN equal to NaN, so a
     * NaN size settles), else 0.
     */
    private place;
    private park;
    private unpark;
    /**
     * A font's description arrived: the nodes waiting on any of its names
     * lay out, and stay listed (`park` keeps them) until its atlas is up,
     * when they lay out again and leave the list. So a failure of the atlas
     * reaches every one of them, a node no walk visited since (out of bounds,
     * hidden) included. Its load failed for good: they hear `failed` and keep
     * waiting, for a later load of the name (1.10 kept them parked).
     */
    private fontChanged;
    /**
     * `failed` for the waiting nodes listening to it, each of which asks for
     * a frame (markDirty with no bits, as setZIndex asks for one), whose
     * flush delivers it: the failure can arrive inside a flush (the atlas's
     * own `failed`), where an event queued waits for the next flush and
     * schedules none. A node whose family is none of the font's `names` is
     * skipped: it switched font since it was listed, and no walk visited it
     * to take it off the list.
     */
    private tellFailed;
}
