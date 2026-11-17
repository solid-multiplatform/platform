import { Node } from '../core/nodes/Node.js';
import type { NodeStore } from '../core/nodes/NodeStore.js';
import type { PassHooks } from '../core/scene/ScenePass.js';
import type { TextureStore } from '../core/textures/TextureStore.js';
import type { AnimationManager } from '../core/animation/AnimationManager.js';
import type { AnimationControllerState } from '../common/types.js';
/**
 * Inspector options (1.10's), read at construction: a change through
 * `setOptions({ inspectorOptions })` builds the inspector anew.
 */
export interface InspectorOptions {
    /**
     * Count, per node, the frames it changed in, and warn when a node
     * changes in `excessiveCallThreshold` frames within `resetInterval` ms
     * (1.10 counted setter calls: v2 has no hook per call, spec 12.4).
     *
     * @defaultValue false
     */
    enablePerformanceMonitoring: boolean;
    /** @defaultValue 100 */
    excessiveCallThreshold: number;
    /** @defaultValue 5000 */
    resetInterval: number;
    /**
     * Record animation starts and stops (see `getActiveAnimations` and
     * `getAnimationStats`).
     *
     * @defaultValue false
     */
    enableAnimationMonitoring: boolean;
    /** @defaultValue 1000 */
    maxAnimationHistory: number;
    /**
     * Log the animation statistics every this many seconds; 0 never.
     *
     * @defaultValue 0
     */
    animationStatsInterval: number;
}
/** One node's changes (`Inspector.getPerformanceStats`). */
export interface InspectorChangeStats {
    /** The node's uid. */
    nodeId: number;
    /** Frames it changed in since `timeWindow` ms ago. */
    count: number;
    timeWindow: number;
}
/** An animation running or paused (`Inspector.getActiveAnimations`). */
export interface InspectorAnimation {
    /** The animated node's uid. */
    nodeId: number;
    animationId: string;
    startTime: number;
    duration: number;
    elapsedTime: number;
    state: AnimationControllerState;
}
/** The settings the inspector reads (the renderer's). */
export interface InspectorSettings {
    appWidth: number;
    appHeight: number;
    deviceLogicalPixelRatio: number;
    inspectorOptions: Partial<InspectorOptions>;
}
/** What the inspector reads and chains on its renderer (RendererCore has it all). */
export interface InspectorOwner {
    readonly nodes: NodeStore;
    readonly root: Node;
    readonly hooks: PassHooks;
    readonly textures: TextureStore;
    readonly animationManager: AnimationManager;
    requestRender(): void;
}
/**
 * The inspector (spec 12.4, exported from `@solidtv/renderer/inspector`):
 * a DOM mirror of the scene for DevTools and Playwright, one element per
 * node over the canvas. It wraps no setter that marks dirty: attached, it
 * chains the renderer's store and scene pass hooks, collects the nodes written since
 * the last frame with their dirty masks (as the writes land, before the
 * walk clears them) and the nodes created and destroyed, and applies them
 * to the mirror once per frame. Built only when the renderer's `inspector`
 * setting names it in a build with `__enableInspector__` on; nothing of it
 * runs, or ships, otherwise.
 *
 * The DOM contract (1.10's): an element per node, its `id` the node's
 * `uid` (and the renderer root's the overlay, `id="root"`); `node.div` and
 * `element.node`; position, size, opacity, colour, transform, z-index and
 * clipping as CSS; `data` as `data-*` attributes; `src` as `data-src`;
 * `data-texture-*` attributes; text as content (opacity 0.001, so
 * Playwright still finds it); `state` (`inViewport`, `outOfViewport`); a
 * custom element named after `componentName` where the browser has them.
 */
export declare class Inspector {
    private readonly canvas;
    private readonly doc;
    private readonly win;
    private readonly root;
    private readonly options;
    private readonly onResize;
    private readonly observers;
    private owner;
    /** Elements by node uid. */
    private readonly elements;
    /** Feed bits by node slot (M_LISTED when the slot is in `changed`). */
    private marks;
    private changed;
    private changedCount;
    /** By node slot: its last index in `changed` (a parent change lists it again). */
    private entries;
    private destroyedUids;
    private readonly metrics;
    /** Owner counts by texture record, for one frame's sync (a shared texture is walked once). */
    private readonly ownerCounts;
    /** In frame()'s sync: owner counts are cached (node.div between frames counts afresh). */
    private framing;
    /** Unregistered since the last frame, with whether each ran to its end. */
    private readonly ended;
    private readonly endedFinished;
    private statsTimer;
    /** What attach() replaced, for destroy() to put back. */
    private restore;
    constructor(canvas: HTMLCanvasElement, settings: InspectorSettings);
    /**
     * Per node, the frames it changed in within the current window, most
     * first (with `enablePerformanceMonitoring`).
     */
    static getPerformanceStats(): InspectorChangeStats[];
    static clearPerformanceStats(): void;
    /** Animations running or paused, newest first (with `enableAnimationMonitoring`). */
    static getActiveAnimations(): InspectorAnimation[];
    /** The animations recorded: ended, active, and the mean duration of those that finished. */
    static getAnimationStats(): {
        totalAnimations: number;
        activeCount: number;
        averageDuration: number;
    };
    static clearAnimationStats(): void;
    /** Keep the overlay on the canvas as the page scrolls or the canvas moves. */
    setRootPosition(): void;
    /**
     * Mirror `owner`'s scene and follow it: its store's writes, creations
     * and destructions, its visibility and text layout hooks and its texture
     * events, each chained (never replaced) until destroy().
     */
    attach(owner: InspectorOwner): void;
    /**
     * Apply the frame's changes to the mirror: the Renderer calls it after
     * each drawn frame. Removed elements first, then new ones (each with its
     * whole state), then what changed on the others.
     */
    frame(): void;
    /**
     * The element mirroring `node` (`node.div`), built now when it has none
     * yet: Solid reads `node.div` right after createNode (1.10 built the
     * element there). The node stays listed, so the frame's sync takes the
     * writes that follow.
     */
    elementOf(node: Node): HTMLElement | undefined;
    /**
     * A meta write (data, componentName, componentLocation) on slot `id`: it
     * raises no dirty bit, so it asks for the frame that flushes it.
     */
    meta(id: number): void;
    /** Stop following the renderer and remove the overlay. */
    destroy(): void;
    /**
     * A frame `uid` changed in: counted in the window, with a warning when
     * the count reaches the threshold and every 50 frames after (1.10).
     */
    private countChange;
    private animationStarted;
    /** The animations unregistered since the last frame: paused, or ended. */
    private animationsEnded;
    /**
     * The records of animations whose node was destroyed, recorded as
     * stopped (1.10 recorded them as cancelled; neither counts in
     * averageDuration).
     */
    private pruneAnimations;
    private recordEnd;
    /** Add `bits` to slot `id`'s feed, listing it on its first change of the frame. */
    private log;
    /**
     * The node's resolved direction changed (DIRTY_DIRECTION on it, derived
     * by the walk before this frame): mark its element and re-place its
     * whole subtree. Its children's `left` reads this node's bit, and its
     * inheriting descendants changed with it, none of them dirty themselves,
     * and which of them an own value stopped is not worth telling apart: a
     * dev tool, at a language switch.
     */
    private directionChanged;
    /** Build the elements of `id`'s subtree (attach), parents first. */
    private mirror;
    /** A new element for slot `id`, placed under its parent's and synced whole. */
    private create;
    /** Register the custom element `tag`; false where the browser has none (Chrome 54). */
    private defineElement;
    /** Write what `mask` says changed on slot `id` to its element. */
    private sync;
    /**
     * Position, size, transform and z-index; and under its parent's element,
     * appended there again when `reparented` (its parent assigned this
     * frame), so that it follows the siblings assigned before it.
     */
    private place;
    /** The text, invisible but findable, its font as CSS, and its layout's size. */
    private textContent;
    /**
     * `data` as `data-*` attributes: a string past 2048 characters is cut, a
     * value that is not a string, number or boolean is left out, and an
     * undefined one removes its attribute (1.10). `data` itself is untouched.
     */
    private dataAttributes;
    /** List the owners of `rec` for their texture attributes. */
    private logOwners;
    private metricsOf;
    /**
     * `data-src` and the `data-texture-*` attributes of the texture a node
     * takes: its source's type, size and owners (a SubTexture's own, its
     * region's size), and the state, retries, error and load counts of the
     * pixels (a SubTexture's sheet), as 1.10's SubTexture reported them.
     */
    private textureAttributes;
}
