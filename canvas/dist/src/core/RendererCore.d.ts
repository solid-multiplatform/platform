import { EventEmitter } from '../common/EventEmitter.js';
import { type BoundsMargin, type Dimensions, type FontLoadOptions } from '../common/types.js';
import { NodeStore } from './nodes/NodeStore.js';
import { Node, type INodeProps, type NodeOwner } from './nodes/Node.js';
import { TextNode, type ITextNodeProps, type TextOwner } from './nodes/TextNode.js';
import { type DestroyOwner } from './nodes/destroy.js';
import { ClipStore } from './scene/ClipStore.js';
import { ScenePass, type PassHooks, type Viewport } from './scene/ScenePass.js';
import { VertexStream } from './gl/VertexStream.js';
import { OpList } from './gl/OpList.js';
import { AnimationManager } from './animation/AnimationManager.js';
import { FrameEvents } from './FrameEvents.js';
import { TextureStore } from './textures/TextureStore.js';
import { TextureNodes } from './textures/TextureNodes.js';
import { type ExtractProps, type TextureMap } from './textures/Texture.js';
import { ShaderRegistry } from './shaders/ShaderRegistry.js';
import type { ShaderNode } from './shaders/ShaderNode.js';
import type { ShaderType } from './shaders/ShaderType.js';
import { FontRegistry } from './text/FontRegistry.js';
import { TextNodes } from './text/TextNodes.js';
import type { TextBaselineMode } from './text/TextLayout.js';
export interface CoreSettings {
    appWidth: number;
    appHeight: number;
    boundsMargin: number | BoundsMargin;
    deviceLogicalPixelRatio: number;
    devicePhysicalPixelRatio: number;
    /** Quads per vertex chunk, in [1, MAX_QUADS] (1.10 took bytes). */
    quadBufferSize: number;
    /** Text layouts kept for reuse, least recently used out first (spec 10.2). */
    textLayoutCacheSize: number;
    /**
     * Text layouts made per idle maintenance pass, into the layout cache, for
     * text nodes no walk has visited yet (beyond the bounds margin, under a
     * hidden parent): the walk that brings one in looks its layout up instead
     * of laying it out in its frame. 0 turns it off.
     */
    idleTextLayouts: number;
    /** Which height a text line's mid-line centres (1.10's engine-wide anchor). */
    textBaselineMode: TextBaselineMode;
}
export declare const CORE_DEFAULTS: CoreSettings;
/**
 * Quads per vertex chunk: floored and clamped to [1, MAX_QUADS] (spec 14,
 * item 31: 1.10 took bytes). Tested as "not at least 1" so that NaN, which
 * fails every comparison, lands on 1 instead of a zero-length stream.
 */
export declare function resolveQuadBufferSize(value: number | undefined): number;
export type FlushHandler = (stream: VertexStream, ops: OpList) => void;
/**
 * The headless renderer: stores, root, scene pass, animations. Phase 2's
 * `Renderer` extends it with a canvas, the GL backend and the loop.
 */
export declare class RendererCore extends EventEmitter implements NodeOwner, TextOwner, DestroyOwner {
    readonly settings: CoreSettings;
    /** @hidden */
    readonly nodes: NodeStore;
    /** @hidden */
    readonly clips: ClipStore;
    /** @hidden */
    readonly animationManager: AnimationManager;
    /** @hidden */
    readonly stream: VertexStream;
    /** @hidden */
    readonly ops: OpList;
    readonly view: Viewport;
    readonly hooks: PassHooks;
    /** @hidden */
    readonly scene: ScenePass;
    readonly root: Node;
    /**
     * Events raised during a frame, delivered after its draw (the Renderer
     * flushes them; a headless caller calls `events.flush()`).
     *
     * @hidden
     */
    readonly events: FrameEvents;
    /**
     * Texture records (spec 9.1); the Renderer attaches the loader and uploader.
     *
     * @hidden
     */
    readonly textures: TextureStore;
    /**
     * The scene pass's texture hooks, node release and the preload drain.
     *
     * @hidden
     */
    readonly textureNodes: TextureNodes;
    /**
     * Shader types, programs and params blocks (spec 8). Headless, programs
     * compile nowhere (headlessHost); the Renderer installs the GL backend.
     *
     * @hidden
     */
    readonly shaders: ShaderRegistry;
    /**
     * SDF fonts (spec 10.1). Headless it has no fetch, so a load fails; the
     * Renderer gives it the platform's.
     *
     * @hidden
     */
    readonly fonts: FontRegistry;
    /**
     * The scene pass's text hook, the font wait lists and the layout cache.
     *
     * @hidden
     */
    readonly textNodes: TextNodes;
    /**
     * Text `loaded` events, delivered between walks (RendererCore.update):
     * outside the walk, and before the re-walk decision, so a listener's
     * writes (a framework's layout) land in the same frame.
     *
     * @hidden
     */
    readonly textEvents: FrameEvents;
    /**
     * The clock shader time functions read: 1.10's Stage timing values, in
     * ms, as of the frame being drawn, which the Renderer writes each frame
     * (0 headless). `elapsedTime` counts from the renderer's start: the
     * clock of `time: true` shaders.
     */
    elapsedTime: number;
    deltaTime: number;
    lastFrameTime: number;
    currentFrameTime: number;
    /**
     * A frame is needed. Raised, always, by a store write (NodeStore.onDirty),
     * `reprocessUpdates` and `requestRender()` (an animation start calls it
     * through AnimationManager.onActive). A completed `update()` clears it
     * only when nothing is outstanding: no unconsumed write, no pending
     * callback and no `requestRender()` since the update began. So a write a
     * re-walk consumed requests nothing, and an update that throws leaves it
     * raised (the conservative direction).
     */
    frameRequested: boolean;
    /** Walks performed by the last `update()` (1 unless writes happened mid-frame). */
    updateIterations: number;
    /** Chunk flushes during the last `update()`. */
    flushes: number;
    /**
     * Ops the chunk flushes of the last `update()` drew; with what is left
     * in `ops`, the frame's ops (telemetry's `renderOps`).
     */
    flushedOps: number;
    /**
     * Draws the current stream and ops. Phase 2 installs the GL implementation.
     *
     * @hidden
     */
    onFlush: FlushHandler | null;
    private readonly emitter;
    private postUpdate;
    /** `requestRender()` was called since the current `update()` began. */
    private renderRequested;
    constructor(settings?: Partial<CoreSettings>);
    /** 1.10 compatibility: the stage is the renderer. */
    get stage(): this;
    /**
     * Allocates and applies props without going through the public,
     * overridable `createNode`. The constructor must use this for the root:
     * `this` already carries the most-derived prototype the instant `super()`
     * starts running, so `this.createNode(...)` from here would dispatch to a
     * subclass's override (phase 2's `Renderer`) before that subclass's own
     * fields are initialized.
     */
    private createNodeInternal;
    createNode(props?: Partial<INodeProps>): Node;
    /**
     * A text node (spec 10, 1.10 createTextNode): its text props take 1.10's
     * creation defaults, and it lays out in the scene pass once its font's
     * description is loaded.
     */
    createTextNode(props?: Partial<ITextNodeProps>): TextNode;
    /**
     * Lay text out ahead of its node: `props` as createTextNode takes them
     * (only the text props count), laid out into the layout cache that a
     * text node created later with the same text props lays out from, so
     * its frame looks the layout up instead of laying it out. For text an
     * app knows is coming (the next rows' titles), called while the renderer
     * is idle. Makes no node, queues no event and asks for no frame. The
     * cache keeps the `textLayoutCacheSize` layouts used last, these
     * included. Returns the size the node's `w` and `h` will read, or null
     * while the font's description has not arrived.
     */
    measureText(props: Partial<ITextNodeProps>): Dimensions | null;
    /**
     * Load an SDF font (spec 10.1): its atlas description and its atlas
     * image, under every name `fontFamily` and `aliases` give. 1.10's form,
     * `loadFont('sdf', options)`, works too; a 'canvas' font rejects, since
     * v2 draws SDF text only, and any other type as 1.10 rejected one it had
     * no font handler for.
     */
    loadFont(options: FontLoadOptions): Promise<void>;
    loadFont(type: string, options: FontLoadOptions): Promise<void>;
    /** Fonts loading (their description or atlas on the way): the examples harness settles on 0. */
    get pendingFonts(): number;
    /** Register a shader type under `name` (1.10 `stage.shManager.registerShaderType`). */
    registerShaderType<P extends object>(name: string, type: ShaderType<P>): void;
    /**
     * A shader of a registered type for `node.shader`, or null (with a
     * warning) for a name not registered. Its program compiles at the first
     * pack of a node in bounds using it, which may come before anything is
     * drawn with it: a node in the bounds margin, or one whose own alpha is
     * 0, packs too. The Renderer's idle warm-up may have compiled it already.
     */
    createShader(name: string, props?: Record<string, unknown>): ShaderNode | null;
    /**
     * A texture handle (spec 9.1). The record exists from now on; it loads
     * when a node in bounds, or a preloading node, needs its pixels. A
     * SubTexture, always a new handle, hears that its parent is already
     * loaded, failed or freed with the next delivery of events: after the
     * frame's draw, or from a zero-delay timer (1.10: a microtask), so a
     * listener added in the same task hears it.
     */
    createTexture<Type extends keyof TextureMap>(type: Type, props: ExtractProps<TextureMap[Type]>): InstanceType<TextureMap[Type]>;
    /**
     * Textures still on their way to the GPU (queued, loading, decoded and
     * waiting for upload, or failed with a retry to come): the examples
     * harness settles on 0.
     */
    get pendingTextures(): number;
    /** Request a frame; one requested during `update()` outlives it. */
    requestRender(): void;
    /**
     * The one funnel for frame requests. A store write (NodeStore.onDirty, on
     * the store's clean-to-dirty transition), reprocessUpdates and
     * requestRender each call it once, and so does an animation start
     * (AnimationManager.onActive calls requestRender). It only schedules: a
     * frame draws because its source raised frameRequested, so a texture's
     * upload (phase 3) and font arrival (phase 5) must go through
     * requestRender() or a store write (markDirty), never onFrameRequest()
     * alone. A decode is the exception: it needs a frame for the uploader,
     * not a walk and a draw, so the Renderer answers it with
     * onFrameRequest() and a flag of its own, and the upload marks the
     * nodes. The Renderer overrides it to schedule a frame; the headless core
     * has no loop. It can run during RendererCore's own constructor (the root
     * node's creation marks it dirty), before a subclass's fields are
     * assigned, so an override must tolerate its own state being undefined at
     * that point.
     */
    protected onFrameRequest(): void;
    /**
     * Run `cb` once inside the next update, after the walk and before the draw;
     * writes it makes are folded into the same frame. A call made during a
     * walk (a hook or an event it raised) runs after that walk. `cb` is
     * optional (1.10 parity: `reprocessUpdates(callback?)`, which only
     * replaced its stored callback `if (callback)`): a bare call only
     * requests the walk, and leaves a callback already pending (from an
     * earlier `reprocessUpdates(fn)` that has not run yet) untouched instead
     * of clobbering it with a no-op. Solid calls it after a batch of
     * mutations to run its flex layout there, so what the layout writes is
     * drawn in the same frame.
     */
    reprocessUpdates(cb?: () => void): void;
    /**
     * Advance animations by `dt` ms (the loop calls this before `update`).
     * The phase 2 loop owns `animationManager.now`: it writes the frame's
     * rAF timestamp there before calling `step`.
     */
    step(dt: number): void;
    /**
     * Update the scene and emit this frame's quads. Re-walks (at most three
     * walks total, so up to two re-walks) when a write happened during the
     * walk or in the post-update callback, or when a callback is still
     * pending, so that text layout and framework layout land in the same
     * frame. A texture size a leaf in the bounds margin takes in the walk is
     * not counted (TextureNodes takes it back): the leaf is not drawn this
     * frame either way, and its next visit, next frame, composes it. A walk
     * that flushed a chunk is final: those quads are already drawn, so its
     * writes land next frame. The last, unflushed chunk is left in `stream` /
     * `ops` for the caller to draw after `update()` returns; `onFlush` only
     * fires for the full chunks flushed mid-walk.
     */
    update(): void;
    private flush;
}
