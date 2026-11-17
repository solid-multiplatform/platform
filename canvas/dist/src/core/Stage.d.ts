import { AnimationManager } from './animations/AnimationManager.js';
import { CoreNode, type CoreNodeProps } from './CoreNode.js';
import { CoreTextureManager } from './CoreTextureManager.js';
import { CoreShaderManager } from './CoreShaderManager.js';
import { type FontHandler, type FontLoadOptions, type TextRenderer, type TextRenderers, type TrProps } from './text-rendering/TextRenderer.js';
import { EventEmitter } from '../common/EventEmitter.js';
import { ContextSpy } from './lib/ContextSpy.js';
import type { BoundsMargin, FpsUpdatePayload, FrameTickPayload } from '../common/CommonTypes.js';
import { TextureMemoryManager, type TextureMemoryManagerSettings } from './TextureMemoryManager.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { CoreTextNode, type CoreTextNodeProps } from './CoreTextNode.js';
import type { CoreShaderNode } from './renderers/CoreShaderNode.js';
import type { Texture } from './textures/Texture.js';
import type { Platform } from './platforms/Platform.js';
import type { WebPlatform } from './platforms/web/WebPlatform.js';
import type { RendererMainSettings } from '../main-api/Renderer.js';
export type StageOptions = Omit<RendererMainSettings, 'platform' | 'maxRetryCount'> & {
    textureMemory: TextureMemoryManagerSettings;
    canvas: HTMLCanvasElement | OffscreenCanvas;
    fpsUpdateInterval: number;
    eventBus: EventEmitter;
    platform: Platform | WebPlatform;
    maxRetryCount: number;
};
export type StageFpsUpdateHandler = (stage: Stage, fpsData: FpsUpdatePayload) => void;
export type StageFrameTickHandler = (stage: Stage, frameTickData: FrameTickPayload) => void;
export declare class Stage {
    options: StageOptions;
    readonly animationManager: AnimationManager;
    readonly txManager: CoreTextureManager;
    readonly txMemManager: TextureMemoryManager;
    readonly textRenderers: Record<string, TextRenderer>;
    readonly fontHandlers: Record<string, FontHandler>;
    readonly shManager: CoreShaderManager;
    readonly renderer: CoreRenderer;
    readonly root: CoreNode;
    /**
     * Preload runway, in logical pixels, around every node's visible region.
     *
     * A node whose render bounds fall outside its visible region but inside
     * that region grown by this margin loads its textures yet stays out of the
     * render list, so content is decoded before it scrolls on screen.
     */
    boundsMargin: BoundsMargin;
    readonly defShaderNode: CoreShaderNode | null;
    /**
     * Viewport extent in logical pixels. The viewport always starts at (0, 0),
     * so these two numbers fully describe the fallback visible region used by
     * `CoreNode.checkRenderBounds` when no clipping ancestor applies.
     */
    readonly viewportW: number;
    readonly viewportH: number;
    readonly defaultTexture: Texture | null;
    /**
     * Physical × logical device pixel ratio. Fixed at construction (app size and
     * pixel ratio are not `setOptions` keys): shaders compile it in as
     * `EDGE_WIDTH` and fold it into cached uniforms, which would go stale if it
     * could change.
     */
    readonly pixelRatio: number;
    /**
     * Canvas height in device pixels, read once: the canvas is sized before the
     * stage is created and never resized. Used to flip scissor boxes to GL's
     * bottom-left origin.
     */
    readonly canvasH: number;
    readonly platform: Platform | WebPlatform;
    readonly calculateTextureCoord: boolean;
    /**
     * Target frame time in milliseconds (calculated from targetFPS)
     *
     * @remarks
     * This is pre-calculated to avoid recalculating on every frame.
     * - 0 means no throttling (use display refresh rate)
     * - >0 means throttle to this frame time (1000 / targetFPS)
     */
    targetFrameTime: number;
    /**
     * Renderer Event Bus for the Stage to emit events onto
     *
     * @remarks
     * In reality this is just the RendererMain instance, which is an EventEmitter.
     * this allows us to directly emit events from the Stage to RendererMain
     * without having to set up forwarding handlers.
     */
    readonly eventBus: EventEmitter;
    /**
     * Whether the underlying WebGL context has been lost.
     *
     * @remarks
     * Set by the renderer's `webglcontextlost` listener. Once true it stays true:
     * the engine does not rebuild GPU resources in-place, so the render loop
     * stops and the supported recovery is to reload the app (see the `contextLost`
     * event). This avoids issuing GL calls against a dead context, which return
     * null/throw on low-RAM devices (e.g. Chromium 123+ backgrounding behaviour).
     */
    isContextLost: boolean;
    /**
     * Set by {@link pauseLoop}. The platform loop honours it only once no
     * animation is active, so a pause never freezes an animation mid-flight.
     */
    loopPauseRequested: boolean;
    /**
     * Set with {@link loopPauseRequested} when the pause must not wait: the
     * loop stops on its next tick before it draws, animations included. For a
     * host leaving the foreground, where a frame drawn late is a crash.
     */
    loopPauseImmediate: boolean;
    /**
     * True while the platform loop has actually stopped scheduling ticks.
     */
    isLoopPaused: boolean;
    /**
     * Restarts a paused loop. Installed by the platform in `startLoop`, since
     * only the platform owns the tick function and its scheduler.
     */
    loopResume: (() => void) | null;
    startTime: number;
    deltaTime: number;
    lastFrameTime: number;
    currentFrameTime: number;
    elapsedTime: number;
    private timedNodes;
    private clrColor;
    private fpsSampleFrames;
    private fpsSampleElapsed;
    private fpsRenderedFrames;
    private fpsIdleTicks;
    private fpsIntervalElapsed;
    private fpsLastTickRendered;
    private fpsLastInterval;
    telemetrySegment: string;
    private fpsFrameTimeBuckets;
    private fpsMaxFrameTime;
    private fpsAnimatedFrames;
    private fpsAnimatedElapsed;
    private fpsAnimatedBuckets;
    private fpsAnimatedMaxFrameTime;
    private fpsAnimationSum;
    private fpsMaxAnimations;
    private fpsUploadFrames;
    private fpsUpdateMs;
    private fpsRenderMs;
    private fpsUploadMs;
    private fpsMaxUpdateMs;
    private fpsMaxRenderMs;
    private fpsMaxUploadMs;
    private fpsUploadedTextures;
    private fpsMaxUploadQueue;
    private numQuadsRendered;
    private numRenderOpsRendered;
    private renderRequested;
    private reprocessFrame;
    private reprocessCallback;
    private frameEventQueue;
    renderList: CoreNode[];
    renderListDirty: boolean;
    private hasCanvasEngine;
    contextSpy: ContextSpy | null;
    /**
     * Stage constructor
     */
    constructor(options: StageOptions);
    setClearColor(color: number): void;
    /**
     * Update the target frame time based on the current targetFPS setting
     *
     * @remarks
     * This should be called whenever the targetFPS option is changed
     * to ensure targetFrameTime stays in sync.
     * targetFPS of 0 means no throttling (targetFrameTime = 0)
     * targetFPS > 0 means throttle to 1000/targetFPS milliseconds
     */
    updateTargetFrameTime(): void;
    /**
     * Advance the frame clock.
     *
     * @param frameTime - The frame's own timestamp, i.e. the value
     *   `requestAnimationFrame` hands its callback. Optional: omitting it reads
     *   the clock here instead, which is what the loop did before this parameter
     *   existed.
     *
     * @remarks
     * Prefer passing it. The rAF timestamp is the moment the frame *began*
     * (vsync); reading the clock here gives the moment the callback got around to
     * *executing*, a variable amount later depending on what else the main thread
     * was doing. Differencing execution times folds that scheduling jitter into
     * `deltaTime`: a callback starting 3ms late reports a 20ms frame and makes the
     * next read 13ms, with no frame dropped at all. That noise reached both the
     * animation step and the frame-time histogram, where it produced a p95 sitting
     * between the display's quantized frame periods and read as jank that was not
     * happening.
     *
     * Differencing frame timestamps instead yields clean multiples of the display
     * period, so a percentile off {@link FpsUpdatePayload.frameTimeBuckets} counts
     * dropped frames rather than callback lateness.
     *
     * Both clocks are `performance.now()`-based and share an origin, so
     * {@link elapsedTime} stays comparable whichever path ran.
     */
    updateFrameTime(frameTime?: number): void;
    /**
     * Mark the WebGL context as lost. Stops GL work and notifies consumers.
     *
     * @remarks
     * The engine does not rebuild GPU resources in-place; consumers are expected
     * to reload the app in response to the `contextLost` event.
     */
    setContextLost(): void;
    /**
     * Create default PixelTexture
     */
    createDefaultTexture(): void;
    /**
     * Update animations
     */
    updateAnimations(): boolean;
    /**
     * Check if the scene has updates
     */
    hasSceneUpdates(): boolean;
    /**
     * Trim text renderer caches back to their configured limits.
     *
     * Called when the stage goes idle so layout-cache eviction never competes
     * with active rendering.
     */
    cleanupTextRenderers(): void;
    /**
     * Start a new frame draw
     */
    drawFrame(hasActiveAnimations?: boolean): void;
    /**
     * Queue an event to be emitted after the current/next frame is rendered
     *
     * @remarks
     * When we are operating in the context of the render loop, we may want to
     * emit events that are related to the current frame. However, we generally do
     * NOT want to emit events directly in the middle of the render loop, since
     * this could enable event handlers to modify the scene graph and cause
     * unexpected behavior. Instead, we queue up events to be emitted and then
     * flush the queue after the frame has been rendered.
     *
     * @param name
     * @param data
     */
    queueFrameEvent(name: string, data: unknown): void;
    /**
     * Emit all queued frame events
     *
     * @remarks
     * This method should be called after the frame has been rendered to emit
     * all events that were queued during the frame.
     *
     * See {@link queueFrameEvent} for more information.
     */
    flushFrameEvents(): void;
    /**
     * Accumulate one loop tick into the current FPS sample.
     *
     * @param rendered `true` for a tick that drew a frame, `false` for an idle
     *   poll (WebPlatform's idle path, where the scene had no updates).
     * @param animating `true` when animations were running for this frame.
     *   Defaults to `false` so that a caller written against the previous
     *   one-argument signature still compiles and behaves as it did: this is
     *   part of the render loop's contract with {@link Platform}, and a custom
     *   platform implementation calls it from its own `startLoop`.
     */
    calculateFps(rendered: boolean, animating?: boolean): void;
    /**
     * Close the current FPS sample: emit it and reset the accumulators.
     *
     * @remarks
     * Deliberately split out of {@link calculateFps} rather than nested inside
     * it. `calculateFps` runs on every loop tick; this runs once per
     * `fpsUpdateInterval`, which at a 1s interval is under 2% of them. Keeping
     * the allocation, the payload literal and the capability lookup out of the
     * per-tick function keeps that function small enough to stay attractive to
     * the optimizer, the same reason WebPlatform splits `tick` out of `runLoop`.
     */
    /**
     * Label the samples that follow, e.g. `'home'` or `'detail-scroll'`.
     *
     * @remarks
     * Closes the sample in progress under the OLD label before adopting the new
     * one, so no interval ever straddles two segments. Without that, a sample
     * spanning a menu and the scroll that follows it reports the blend of the
     * two, which is exactly what segmenting is meant to prevent.
     *
     * The flushed sample can be short. Filter on `renderedFrames` if a minimum
     * is needed. Call this on screen and interaction changes, never per frame.
     */
    setTelemetrySegment(label: string): void;
    /**
     * Clear every accumulator backing the current FPS sample.
     *
     * @remarks
     * Deliberately does not touch `fpsLastTickRendered`. That is continuity
     * state about the previous tick rather than sample state, and clearing it
     * here would drop a frame from the rate at every interval boundary instead
     * of only at the start of a rendering burst.
     */
    private resetFpsSample;
    private emitFpsUpdate;
    calculateRenderInfo(): void;
    requestRenderListUpdate(): void;
    buildRenderList(node: CoreNode): void;
    /**
     * Request a render pass without forcing an update
     */
    requestRender(): void;
    /**
     * Ask the render loop to stop scheduling ticks.
     *
     * @remarks
     * The loop keeps running until no animation is active and the pending frame
     * has been drawn, then stops. With `immediate` it stops on its next tick
     * before drawing anything, animations frozen where they are.
     * {@link isLoopPaused} reports when it has.
     */
    pauseLoop(immediate?: boolean): void;
    /**
     * Cancel a pending pause, or restart a paused loop.
     */
    resumeLoop(): void;
    reprocessUpdates(callback?: () => void): void;
    /**
     * Given a font name, and possible renderer override, return the best compatible text renderer.
     *
     * @remarks
     * Will try to return a canvas renderer if no other suitable renderer can be resolved.
     *
     * @param fontFamily
     * @param textRendererOverride
     * @returns
     */
    resolveTextRenderer(trProps: TrProps, textRendererOverride?: keyof TextRenderers | null): TextRenderer | null;
    createNode(props: Partial<CoreNodeProps>, resolved?: boolean): CoreNode;
    createTextNode(props: Partial<CoreTextNodeProps>, resolved?: boolean): CoreTextNode;
    /**
     * Allocate a fully-resolved CoreNodeProps bag — the same shape and
     * defaults the renderer would otherwise build inside `createNode`.
     *
     * Frameworks (e.g. solid-tv) call this once per node at construction
     * time, fill it in as user props flow in, then pass it back via
     * `createNode(props, true)`.  The renderer adopts the bag directly:
     * one allocation instead of two, and a stable hidden class for the
     * node's lifetime.
     */
    createNodeProps(initial?: Partial<CoreNodeProps>): CoreNodeProps;
    /**
     * Allocate a fully-resolved CoreTextNodeProps bag.  See
     * {@link createNodeProps}.
     */
    createTextNodeProps(initial?: Partial<CoreTextNodeProps>): CoreTextNodeProps;
    /**
     * Apply text-specific defaults on top of a base CoreNodeProps build.
     * Shared by `createTextNode` and `createTextNodeProps`.
     */
    protected resolveTextNodeDefaults(props: Partial<CoreTextNodeProps>): CoreTextNodeProps;
    setBoundsMargin(value: number | BoundsMargin): void;
    /**
     * Re-test every node's render bounds, e.g. after the bounds margin changes.
     * The viewport extent itself is fixed at construction.
     */
    updateViewportBounds(): void;
    /**
     * add node to timedNodes array
     *
     * @remarks
     * The array is dense and unordered — indexing it by `node.id` would make it
     * sparse (ids are a global monotonic counter), forcing V8 into dictionary
     * elements and leaving `length` permanently non-zero after every node is
     * untracked. The frame loop walks this array every frame, so it must stay
     * a packed array.
     *
     * @param node
     * @returns
     */
    trackTimedNode(node: CoreNode): void;
    /**
     * remove node from timedNodes array
     *
     * @remarks
     * Swap-remove: order carries no meaning here (the frame loop only asks
     * "is any tracked node renderable"), so the last element backfills the hole
     * and the array stays packed.
     *
     * @param node
     * @returns
     */
    untrackTimedNode(node: CoreNode): void;
    /**
     * Resolves the default property values for a Node
     *
     * @remarks
     * This method is used internally by the RendererMain to resolve the default
     * property values for a Node. It is exposed publicly so that it can be used
     * by Core Driver implementations.
     *
     * @param props
     * @returns
     */
    protected resolveNodeDefaults(props: Partial<CoreNodeProps>): CoreNodeProps;
    /**
     * Cleanup Orphaned Textures
     *
     * @remarks
     * This method is used to cleanup orphaned textures that are no longer in use.
     */
    cleanup(full?: boolean): void;
    set clearColor(value: number);
    get clearColor(): number;
    /**
     * Load a font using a specific text renderer type
     *
     * @remarks
     * This method allows consumers to explicitly load fonts for a specific
     * text renderer type (e.g., 'canvas', 'sdf'). Consumers must specify
     * the renderer type to ensure fonts are loaded with the correct pipeline.
     *
     * For Canvas fonts, provide fontUrl (e.g., .ttf, .woff, .woff2)
     * For SDF fonts, provide atlasUrl (image) and atlasDataUrl (JSON glyph data)
     *
     * @param rendererType - The type of text renderer ('canvas', 'sdf', etc.)
     * @param options - Font loading options specific to the renderer type
     * @returns Promise that resolves when the font is loaded
     */
    loadFont(rendererType: TextRenderers, options: FontLoadOptions): Promise<void>;
}
