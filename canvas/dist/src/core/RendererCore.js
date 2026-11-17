import { EventEmitter } from '../common/EventEmitter.js';
import { EMIT_BOUNDS_EVENTS } from '../common/flags.js';
import { normalizeBoundsMargin, } from '../common/types.js';
import { NodeStore } from './nodes/NodeStore.js';
import { Node } from './nodes/Node.js';
import { TextNode, TextState, applyTextProps, textStateFrom, } from './nodes/TextNode.js';
import { DIRTY_LAYOUT, ST_TEXT } from './nodes/NodeFlags.js';
import { applyNodeProps } from './nodes/applyProps.js';
import { destroySubtree } from './nodes/destroy.js';
import { ClipStore } from './scene/ClipStore.js';
import { ScenePass, nullHooks, } from './scene/ScenePass.js';
import { MAX_QUADS, VertexStream } from './gl/VertexStream.js';
import { OpList } from './gl/OpList.js';
import { AnimationManager } from './animation/AnimationManager.js';
import { FrameEvents } from './FrameEvents.js';
import { installBoundsEvents } from './boundsEvents.js';
import { TextureStore } from './textures/TextureStore.js';
import { TextureNodes } from './textures/TextureNodes.js';
import { createTexture, } from './textures/Texture.js';
import { ShaderRegistry, headlessHost } from './shaders/ShaderRegistry.js';
import { viewportGlsl } from './shaders/glsl.js';
import { FontRegistry } from './text/FontRegistry.js';
import { TextNodes } from './text/TextNodes.js';
import { TextEmitter } from './text/TextEmitter.js';
import { I_CLIP, I_DIRTY, I_STATE, I_STRIDE } from './nodes/NodeLayout.js';
export const CORE_DEFAULTS = {
    appWidth: 1920,
    appHeight: 1080,
    boundsMargin: [100, 100, 450, 50],
    deviceLogicalPixelRatio: 1,
    devicePhysicalPixelRatio: 1,
    quadBufferSize: MAX_QUADS,
    textLayoutCacheSize: 250,
    idleTextLayouts: 8,
    textBaselineMode: 'optical',
};
/**
 * Quads per vertex chunk: floored and clamped to [1, MAX_QUADS] (spec 14,
 * item 31: 1.10 took bytes). Tested as "not at least 1" so that NaN, which
 * fails every comparison, lands on 1 instead of a zero-length stream.
 */
export function resolveQuadBufferSize(value) {
    const quads = Math.floor(value ?? CORE_DEFAULTS.quadBufferSize);
    if (quads >= 1 === false) {
        return 1;
    }
    return quads > MAX_QUADS ? MAX_QUADS : quads;
}
/**
 * Shared no-op: `reprocessUpdates()` with no callback stores this instead of
 * `undefined`, so `update()`'s existing "is a callback pending" check
 * (`postUpdate !== null`) keeps working without a branch for the absent-cb
 * case, and there is nothing to allocate per call.
 */
function noop() { }
/**
 * The headless renderer: stores, root, scene pass, animations. Phase 2's
 * `Renderer` extends it with a canvas, the GL backend and the loop.
 */
export class RendererCore extends EventEmitter {
    constructor(settings = {}) {
        super();
        /**
         * The clock shader time functions read: 1.10's Stage timing values, in
         * ms, as of the frame being drawn, which the Renderer writes each frame
         * (0 headless). `elapsedTime` counts from the renderer's start: the
         * clock of `time: true` shaders.
         */
        this.elapsedTime = 0;
        this.deltaTime = 0;
        this.lastFrameTime = 0;
        this.currentFrameTime = 0;
        /**
         * A frame is needed. Raised, always, by a store write (NodeStore.onDirty),
         * `reprocessUpdates` and `requestRender()` (an animation start calls it
         * through AnimationManager.onActive). A completed `update()` clears it
         * only when nothing is outstanding: no unconsumed write, no pending
         * callback and no `requestRender()` since the update began. So a write a
         * re-walk consumed requests nothing, and an update that throws leaves it
         * raised (the conservative direction).
         */
        this.frameRequested = false;
        /** Walks performed by the last `update()` (1 unless writes happened mid-frame). */
        this.updateIterations = 0;
        /** Chunk flushes during the last `update()`. */
        this.flushes = 0;
        /**
         * Ops the chunk flushes of the last `update()` drew; with what is left
         * in `ops`, the frame's ops (telemetry's `renderOps`).
         */
        this.flushedOps = 0;
        /**
         * Draws the current stream and ops. Phase 2 installs the GL implementation.
         *
         * @hidden
         */
        this.onFlush = null;
        this.postUpdate = null;
        /** `requestRender()` was called since the current `update()` began. */
        this.renderRequested = false;
        // Key by key, not Object.assign (ES2015, Chrome 45). `??` also keeps the
        // default for an explicit `undefined`.
        const resolved = {
            appWidth: settings.appWidth ?? CORE_DEFAULTS.appWidth,
            appHeight: settings.appHeight ?? CORE_DEFAULTS.appHeight,
            boundsMargin: normalizeBoundsMargin(settings.boundsMargin ?? CORE_DEFAULTS.boundsMargin),
            deviceLogicalPixelRatio: settings.deviceLogicalPixelRatio ??
                CORE_DEFAULTS.deviceLogicalPixelRatio,
            devicePhysicalPixelRatio: settings.devicePhysicalPixelRatio ??
                CORE_DEFAULTS.devicePhysicalPixelRatio,
            quadBufferSize: resolveQuadBufferSize(settings.quadBufferSize),
            textLayoutCacheSize: settings.textLayoutCacheSize ?? CORE_DEFAULTS.textLayoutCacheSize,
            idleTextLayouts: settings.idleTextLayouts ?? CORE_DEFAULTS.idleTextLayouts,
            textBaselineMode: settings.textBaselineMode ?? CORE_DEFAULTS.textBaselineMode,
        };
        this.settings = resolved;
        const pixelRatio = resolved.deviceLogicalPixelRatio * resolved.devicePhysicalPixelRatio;
        this.view = {
            w: resolved.appWidth,
            h: resolved.appHeight,
            // A copy: a write into the settings tuple must not move the bounds
            // without marking anything.
            margin: normalizeBoundsMargin(resolved.boundsMargin),
            pixelRatio,
            canvasH: Math.round(resolved.appHeight * pixelRatio),
        };
        this.nodes = new NodeStore();
        this.clips = new ClipStore();
        this.animationManager = new AnimationManager();
        this.stream = new VertexStream(resolved.quadBufferSize);
        this.ops = new OpList();
        this.hooks = nullHooks();
        this.events = new FrameEvents();
        const textures = new TextureStore(this.nodes);
        const textureNodes = new TextureNodes(textures, this.events);
        this.textures = textures;
        this.textureNodes = textureNodes;
        textures.requestFrame = () => this.requestRender();
        // Assigned onto the shared hooks object (roadmap 4.3).
        this.hooks.resolveTexture = (id) => textureNodes.resolveTexture(id);
        this.hooks.onVisibility = (id, prev, next) => textureNodes.onVisibility(id, prev, next);
        this.hooks.onHidden = (id) => textureNodes.onHidden(id);
        this.hooks.onShown = (id) => textureNodes.onShown(id);
        // 1.10's bounds events, chained after the texture system's visibility
        // hook (roadmap 4.3); a build with the flag off drops them.
        if (EMIT_BOUNDS_EVENTS === true) {
            installBoundsEvents(this.hooks, this.nodes, this.events);
        }
        const shaders = new ShaderRegistry(this.nodes, this, pixelRatio, headlessHost(viewportGlsl(pixelRatio, Math.round(resolved.appWidth * pixelRatio), this.view.canvasH)));
        this.shaders = shaders;
        // Chained (roadmap 4.3): every w/h change raises DIRTY_SHADER, and a
        // cover crop follows the node's size as its shader does.
        this.hooks.packShader = (id) => {
            textureNodes.onResize(id);
            shaders.pack(id);
        };
        this.hooks.perOpMatch = (id, opNode) => shaders.perOpMatch(id, opNode);
        const fonts = new FontRegistry(textures);
        this.fonts = fonts;
        this.textEvents = new FrameEvents();
        const textNodes = new TextNodes(this.nodes, fonts, this.textEvents, this.events, resolved.textLayoutCacheSize, resolved.textBaselineMode, resolved.idleTextLayouts);
        this.textNodes = textNodes;
        this.hooks.layoutText = (id) => textNodes.layoutText(id);
        this.scene = new ScenePass(this.nodes, this.clips, this.view, this.stream, this.ops, this.hooks, () => this.flush());
        const emitter = new TextEmitter(this.nodes, this.stream, this.ops, shaders, this.scene.flush);
        this.emitter = emitter;
        this.hooks.emitText = (id) => emitter.emitText(id);
        // Not requestRender(): a write during update() may be consumed by a
        // re-walk, which the anyDirty test at the end of update() accounts for.
        this.nodes.onDirty = () => {
            this.frameRequested = true;
            this.onFrameRequest();
        };
        this.animationManager.onActive = () => this.requestRender();
        this.root = this.createNodeInternal({
            w: resolved.appWidth,
            h: resolved.appHeight,
            color: 0,
        });
    }
    /** 1.10 compatibility: the stage is the renderer. */
    get stage() {
        return this;
    }
    /**
     * Allocates and applies props without going through the public,
     * overridable `createNode`. The constructor must use this for the root:
     * `this` already carries the most-derived prototype the instant `super()`
     * starts running, so `this.createNode(...)` from here would dispatch to a
     * subclass's override (phase 2's `Renderer`) before that subclass's own
     * fields are initialized.
     */
    createNodeInternal(props) {
        const node = new Node(this, this.nodes.alloc());
        applyNodeProps(node, props);
        return node;
    }
    createNode(props = {}) {
        return this.createNodeInternal(props);
    }
    /**
     * A text node (spec 10, 1.10 createTextNode): its text props take 1.10's
     * creation defaults, and it lays out in the scene pass once its font's
     * description is loaded.
     */
    createTextNode(props = {}) {
        const s = this.nodes;
        const id = s.alloc();
        s.u32[id * I_STRIDE + I_STATE] = ST_TEXT;
        s.texts[id] = new TextState();
        s.u32[id * I_STRIDE + I_DIRTY] =
            s.u32[id * I_STRIDE + I_DIRTY] | DIRTY_LAYOUT;
        const node = new TextNode(this, id);
        applyTextProps(node, props);
        return node;
    }
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
    measureText(props) {
        const layout = this.textNodes.measureAhead(textStateFrom(props));
        if (layout === null) {
            return null;
        }
        return { w: layout.width, h: layout.height };
    }
    loadFont(typeOrOptions, options) {
        if (typeof typeOrOptions !== 'string') {
            return this.fonts.load(typeOrOptions);
        }
        if (typeOrOptions === 'sdf') {
            return this.fonts.load(options);
        }
        return Promise.reject(new Error(typeOrOptions === 'canvas'
            ? 'Canvas fonts are not supported: v2 renders SDF text only'
            : `Font handler for renderer type '${typeOrOptions}' not found. Available types: sdf`));
    }
    /** Fonts loading (their description or atlas on the way): the examples harness settles on 0. */
    get pendingFonts() {
        return this.fonts.pending;
    }
    /** @internal `node.destroy()` is the public way (spec 13.3). */
    destroyNode(node) {
        // destroySubtree marks the parent dirty, and the root has none: without
        // this request the destroyed scene would stay on screen.
        const isRoot = node === this.root;
        destroySubtree(this, node.id);
        if (isRoot === true) {
            this.requestRender();
        }
    }
    /** @internal The release hook of a destroyed node (destroySubtree). */
    releaseNode(id) {
        const rec = this.nodes.i32[id * I_STRIDE + I_CLIP];
        if (rec !== 0 && this.clips.owner[rec] === id) {
            this.clips.free(rec);
        }
        this.textureNodes.release(id);
        this.shaders.release(id);
        this.textNodes.release(id);
    }
    /** Register a shader type under `name` (1.10 `stage.shManager.registerShaderType`). */
    registerShaderType(name, type) {
        this.shaders.register(name, type);
    }
    /**
     * @internal One step of the idle warm-up (the Renderer's timer chain):
     * compile the next program a first screen would compile on first use,
     * the SDF text program, then each registered type's for its default props
     * (ShaderRegistry.warmNext); false when none is left.
     */
    warmNext() {
        return this.emitter.warm() === true || this.shaders.warmNext() === true;
    }
    /**
     * A shader of a registered type for `node.shader`, or null (with a
     * warning) for a name not registered. Its program compiles at the first
     * pack of a node in bounds using it, which may come before anything is
     * drawn with it: a node in the bounds margin, or one whose own alpha is
     * 0, packs too. The Renderer's idle warm-up may have compiled it already.
     */
    createShader(name, props) {
        return this.shaders.create(name, props);
    }
    /**
     * A texture handle (spec 9.1). The record exists from now on; it loads
     * when a node in bounds, or a preloading node, needs its pixels. A
     * SubTexture, always a new handle, hears that its parent is already
     * loaded, failed or freed with the next delivery of events: after the
     * frame's draw, or from a zero-delay timer (1.10: a microtask), so a
     * listener added in the same task hears it.
     */
    createTexture(type, props) {
        const texture = createTexture(this.textures, type, props);
        if (type === 'SubTexture') {
            this.textureNodes.subTextureCreated(texture.id);
        }
        return texture;
    }
    /**
     * Textures still on their way to the GPU (queued, loading, decoded and
     * waiting for upload, or failed with a retry to come): the examples
     * harness settles on 0.
     */
    get pendingTextures() {
        return this.textures.pending;
    }
    /** Request a frame; one requested during `update()` outlives it. */
    requestRender() {
        this.frameRequested = true;
        this.renderRequested = true;
        this.onFrameRequest();
    }
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
    onFrameRequest() { }
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
    reprocessUpdates(cb) {
        if (cb !== undefined) {
            this.postUpdate = cb;
        }
        else if (this.postUpdate === null) {
            this.postUpdate = noop;
        }
        this.frameRequested = true;
        this.onFrameRequest();
    }
    /**
     * Advance animations by `dt` ms (the loop calls this before `update`).
     * The phase 2 loop owns `animationManager.now`: it writes the frame's
     * rAF timestamp there before calling `step`.
     */
    step(dt) {
        this.animationManager.step(dt);
    }
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
    update() {
        // The root can be destroyed like any other node (ScenePass.run(NULL) is
        // itself a no-op, but getting there still needs a live this.root.id).
        // Once it is, nothing will ever have work again, so clear
        // frameRequested here rather than leave the phase 2 loop polling a dead
        // renderer forever. Also clear the leftover chunk and counters: a
        // caller that draws stream/ops after update() returns would
        // otherwise redraw the destroyed scene's last frame.
        if (this.root.destroyed === true) {
            this.stream.reset();
            this.ops.reset();
            this.scene.visited = 0;
            this.scene.updated = 0;
            this.scene.emitted = 0;
            this.scene.textEmitted = 0;
            this.updateIterations = 0;
            this.flushes = 0;
            this.flushedOps = 0;
            this.frameRequested = false;
            return;
        }
        let iterations = 0;
        this.flushes = 0;
        this.flushedOps = 0;
        this.renderRequested = false;
        do {
            // Preloads first: a preloading node's record may be shown this
            // frame. Before every walk, for a preload a reprocessUpdates callback
            // set on a node the walk does not visit. So do forceLoad layouts,
            // for text nodes the walk may not visit.
            this.textureNodes.drainPreloads();
            this.textNodes.drainForced();
            this.stream.reset();
            this.ops.reset();
            this.scene.run(this.root.id);
            // Text laid out in the walk: `loaded` listeners run now, between
            // walks, and what they write is drawn in this frame.
            this.textEvents.flush();
            // Read after every walk: the walk itself may have registered one.
            const cb = this.postUpdate;
            if (cb !== null) {
                this.postUpdate = null;
                cb();
            }
            iterations++;
        } while ((this.scene.writesDuringPass > 0 || this.postUpdate !== null) &&
            iterations < 3 &&
            this.flushes === 0);
        this.updateIterations = iterations;
        // Cleared only here, when nothing is outstanding: an update that throws
        // never gets here and leaves the flag raised.
        if (this.renderRequested === false &&
            this.nodes.anyDirty === false &&
            this.postUpdate === null) {
            this.frameRequested = false;
        }
    }
    flush() {
        this.flushes++;
        this.flushedOps += this.ops.length;
        const handler = this.onFlush;
        if (handler !== null) {
            handler(this.stream, this.ops);
        }
        this.stream.reset();
        this.ops.reset();
    }
}
//# sourceMappingURL=RendererCore.js.map