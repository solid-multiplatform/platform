import {
  assertTruthy,
  ENABLE_INSPECTOR,
  isProductionEnvironment,
  setPremultiplyMode,
} from '../utils.js';
import { AnimationManager } from './animations/AnimationManager.js';
import {
  UpdateType,
  CoreNode,
  CoreNodeRenderState,
  type CoreNodeProps,
} from './CoreNode.js';
import {
  CoreTextureManager,
  type TextureOptions,
} from './CoreTextureManager.js';
import { CoreShaderManager } from './CoreShaderManager.js';
import {
  type FontHandler,
  type FontLoadOptions,
  type TextRenderer,
  type TextRenderers,
  type TrProps,
} from './text-rendering/TextRenderer.js';
import { setBaselineMode } from './text-rendering/TextLayoutEngine.js';

import { EventEmitter } from '../common/EventEmitter.js';
import { ContextSpy } from './lib/ContextSpy.js';
import {
  FRAME_TIME_BUCKET_COUNT,
  FRAME_TIME_COARSE_MS,
  FRAME_TIME_MAX_MS,
  FRAME_TIME_SPLIT_MS,
  normalizeBoundsMargin,
} from '../common/CommonTypes.js';
import type {
  BoundsMargin,
  FpsUpdatePayload,
  FrameTickPayload,
  RenderUpdatePayload,
} from '../common/CommonTypes.js';
import {
  TextureMemoryManager,
  type TextureMemoryManagerSettings,
} from './TextureMemoryManager.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { CoreTextNode, type CoreTextNodeProps } from './CoreTextNode.js';
import { santizeCustomDataMap } from '../main-api/utils.js';
import type { CoreShaderNode } from './renderers/CoreShaderNode.js';
import { Matrix3d } from './lib/Matrix3d.js';
import type { Texture } from './textures/Texture.js';
import { ColorTexture } from './textures/ColorTexture.js';
import type { Platform } from './platforms/Platform.js';
import type { WebPlatform } from './platforms/web/WebPlatform.js';
import type { RendererMainSettings } from '../main-api/Renderer.js';

export type StageOptions = Omit<
  RendererMainSettings,
  'platform' | 'maxRetryCount'
> & {
  textureMemory: TextureMemoryManagerSettings;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  fpsUpdateInterval: number;
  eventBus: EventEmitter;
  platform: Platform | WebPlatform;
  maxRetryCount: number;
};

export type StageFpsUpdateHandler = (
  stage: Stage,
  fpsData: FpsUpdatePayload,
) => void;

export type StageFrameTickHandler = (
  stage: Stage,
  frameTickData: FrameTickPayload,
) => void;

const autoStart = true;

/**
 * Shared, frozen default for `textureOptions`. Most nodes never set texture
 * options, so resolving the default to one immutable shared object avoids
 * allocating an empty `{}` per node. `textureOptions` is only ever read or
 * replaced wholesale (never mutated in place), so sharing is safe.
 */
const EMPTY_TEXTURE_OPTIONS: TextureOptions = Object.freeze({});

export class Stage {
  /// Module Instances
  public readonly animationManager: AnimationManager;
  public readonly txManager: CoreTextureManager;
  public readonly txMemManager: TextureMemoryManager;
  public readonly textRenderers: Record<string, TextRenderer> = {};
  public readonly fontHandlers: Record<string, FontHandler> = {};
  public readonly shManager: CoreShaderManager;
  public readonly renderer: CoreRenderer;
  public readonly root: CoreNode;
  /**
   * Preload runway, in logical pixels, around every node's visible region.
   *
   * A node whose render bounds fall outside its visible region but inside
   * that region grown by this margin loads its textures yet stays out of the
   * render list, so content is decoded before it scrolls on screen.
   */
  public boundsMargin: BoundsMargin;
  public readonly defShaderNode: CoreShaderNode | null = null;
  /**
   * Viewport extent in logical pixels. The viewport always starts at (0, 0),
   * so these two numbers fully describe the fallback visible region used by
   * `CoreNode.checkRenderBounds` when no clipping ancestor applies.
   */
  public readonly viewportW: number;
  public readonly viewportH: number;
  public readonly defaultTexture: Texture | null = null;
  /**
   * Physical × logical device pixel ratio. Fixed at construction (app size and
   * pixel ratio are not `setOptions` keys): shaders compile it in as
   * `EDGE_WIDTH` and fold it into cached uniforms, which would go stale if it
   * could change.
   */
  public readonly pixelRatio: number;
  /**
   * Canvas height in device pixels, read once: the canvas is sized before the
   * stage is created and never resized. Used to flip scissor boxes to GL's
   * bottom-left origin.
   */
  public readonly canvasH: number;
  public readonly platform: Platform | WebPlatform;
  public readonly calculateTextureCoord: boolean;

  /**
   * Target frame time in milliseconds (calculated from targetFPS)
   *
   * @remarks
   * This is pre-calculated to avoid recalculating on every frame.
   * - 0 means no throttling (use display refresh rate)
   * - >0 means throttle to this frame time (1000 / targetFPS)
   */
  public targetFrameTime: number = 0;

  /**
   * Renderer Event Bus for the Stage to emit events onto
   *
   * @remarks
   * In reality this is just the RendererMain instance, which is an EventEmitter.
   * this allows us to directly emit events from the Stage to RendererMain
   * without having to set up forwarding handlers.
   */
  public readonly eventBus: EventEmitter;

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
  public isContextLost = false;

  /**
   * Set by {@link pauseLoop}. The platform loop honours it only once no
   * animation is active, so a pause never freezes an animation mid-flight.
   */
  loopPauseRequested = false;

  /**
   * Set with {@link loopPauseRequested} when the pause must not wait: the
   * loop stops on its next tick before it draws, animations included. For a
   * host leaving the foreground, where a frame drawn late is a crash.
   */
  loopPauseImmediate = false;

  /**
   * True while the platform loop has actually stopped scheduling ticks.
   */
  isLoopPaused = false;

  /**
   * Restarts a paused loop. Installed by the platform in `startLoop`, since
   * only the platform owns the tick function and its scheduler.
   */
  loopResume: (() => void) | null = null;

  /// State
  startTime = 0;
  deltaTime = 0;
  lastFrameTime = 0;
  currentFrameTime = 0;
  elapsedTime = 0;
  private timedNodes: CoreNode[] = [];
  private clrColor = 0x00000000;
  // FPS sampling state. Rendered frames and idle polls are counted apart:
  // idle polls come from a setTimeout throttled to ~15ms and mean the loop is
  // checking for work, not that the renderer is keeping up, so folding them
  // into one average makes any mostly-static scene report the poll cadence.
  private fpsSampleFrames = 0;
  private fpsSampleElapsed = 0;
  private fpsRenderedFrames = 0;
  private fpsIdleTicks = 0;
  private fpsIntervalElapsed = 0;
  private fpsLastTickRendered = false;
  private fpsLastInterval = 0;
  // App-set label describing what the scene is currently doing. Carried on
  // every sample so intervals can be grouped by screen and interaction rather
  // than averaged across a whole session.
  telemetrySegment = '';
  // Allocated once and reused for the renderer's lifetime: accumulating the
  // distribution costs one index computation and one increment per frame, with
  // no per-frame allocation. Uint32 rather than Uint16 so a large
  // `fpsUpdateInterval` cannot silently wrap a bucket.
  private fpsFrameTimeBuckets = new Uint32Array(FRAME_TIME_BUCKET_COUNT);
  private fpsMaxFrameTime = 0;
  // The same measurements again, restricted to frames that had animations
  // running. Smoothness only matters while something is moving: a scene that
  // renders once for a texture load and then sits still can post a terrible
  // frame time without a viewer ever seeing it. Scoping the distribution to
  // animated frames is what makes "is it smooth" answerable.
  private fpsAnimatedFrames = 0;
  private fpsAnimatedElapsed = 0;
  private fpsAnimatedBuckets = new Uint32Array(FRAME_TIME_BUCKET_COUNT);
  private fpsAnimatedMaxFrameTime = 0;
  // Animation load, sampled per rendered frame. A count rather than a
  // duration: the animation step costs a few tens of microseconds, far under
  // the `performance.now()` clamp (100us in Chrome, a measured 1ms on the
  // reference TV), so timing it would read as a flat zero on most frames
  // while the count is exact and free.
  private fpsAnimationSum = 0;
  private fpsMaxAnimations = 0;
  // Phase attribution, summed over the rendered frames of the interval.
  private fpsUploadFrames = 0;
  private fpsUpdateMs = 0;
  private fpsRenderMs = 0;
  private fpsUploadMs = 0;
  // Per-frame peaks of the same phases. The totals average a spike away; the
  // maxima are what tie a fat histogram tail to the phase that caused it.
  private fpsMaxUpdateMs = 0;
  private fpsMaxRenderMs = 0;
  private fpsMaxUploadMs = 0;
  // Upload workload: textures actually uploaded, and the deepest the pending
  // queue got before a drain. Together with uploadMs these are what steer
  // `textureProcessingTimeLimit`: a growing queue means the budget is too
  // tight, a fat frame tail with high uploadedTextures means it is too loose.
  private fpsUploadedTextures = 0;
  private fpsMaxUploadQueue = 0;
  private numQuadsRendered = 0;
  private numRenderOpsRendered = 0;
  private renderRequested = false;
  private reprocessFrame = false;
  private reprocessCallback: (() => void) | null = null;
  private frameEventQueue: [name: string, payload: unknown][] = [];

  // Flattened render list optimization
  public renderList: CoreNode[] = [];
  public renderListDirty: boolean = true;

  private hasCanvasEngine: boolean;

  // Debug data
  contextSpy: ContextSpy | null = null;

  /**
   * Stage constructor
   */
  constructor(public options: StageOptions) {
    const {
      canvas,
      clearColor,
      appWidth,
      appHeight,
      boundsMargin,
      enableContextSpy,
      forceWebGL2,
      disableVertexArrayObject,
      numImageWorkers,
      textureMemory,
      renderEngine,
      fontEngines,
      createImageBitmapSupport,
      premultiplyAlphaHonored,
      platform,
      maxRetryCount,
      imageDecodeConcurrency,
    } = options;

    assertTruthy(
      platform !== null,
      'A CorePlatform is not provided in the options',
    );

    // Configure the engine-wide text baseline anchor before any node is
    // created. TextLayoutEngine reads this value when laying out every line;
    // setting it during Stage construction ensures it's stable for the
    // lifetime of the renderer.
    setBaselineMode(options.textBaselineMode);

    this.platform = platform;

    this.startTime = platform.getTimeStamp();

    this.eventBus = options.eventBus;

    // Calculate target frame time from targetFPS option
    this.targetFrameTime = options.targetFPS > 0 ? 1000 / options.targetFPS : 0;

    this.txManager = new CoreTextureManager(this, {
      numImageWorkers,
      createImageBitmapSupport,
      // undefined -> true (default: assume honored, no probe)
      premultiplyAlphaHonored: premultiplyAlphaHonored ?? true,
      maxRetryCount,
      imageDecodeConcurrency,
    });

    // Wait for the Texture Manager to initialize
    // once it does, request a render
    this.txManager.on('initialized', () => {
      this.requestRender();
    });

    this.txMemManager = new TextureMemoryManager(this, textureMemory);

    this.animationManager = new AnimationManager();
    this.contextSpy = enableContextSpy ? new ContextSpy() : null;

    this.boundsMargin = normalizeBoundsMargin(boundsMargin);

    // precalculate our viewport extent
    this.viewportW = appWidth;
    this.viewportH = appHeight;

    this.clrColor = clearColor;

    this.pixelRatio =
      options.devicePhysicalPixelRatio * options.deviceLogicalPixelRatio;
    this.canvasH = options.canvas.height;

    this.renderer = new renderEngine({
      stage: this,
      canvas,
      contextSpy: this.contextSpy,
      forceWebGL2,
      disableVertexArrayObject,
      powerPreference: options.powerPreference,
    });

    this.shManager = new CoreShaderManager(this);

    this.defShaderNode = this.renderer.getDefaultShaderNode();
    this.calculateTextureCoord = this.renderer.getTextureCoords !== undefined;

    const renderMode = this.renderer.mode || 'webgl';

    // Canvas2D textures are plain JS heap objects managed by the browser GC.
    // Threshold-based upload blocking makes no sense for JS heap — disable it
    // by setting criticalThreshold to 0 while keeping the eviction machinery.
    if (renderMode === 'canvas') {
      this.txMemManager.updateSettings({
        ...textureMemory,
        criticalThreshold: 0,
        doNotExceedCriticalThreshold: false,
      });
    }

    setPremultiplyMode(renderMode);

    // Must do this after renderer is created
    this.txManager.renderer = this.renderer;

    // Must come after `txManager.renderer` is assigned: the default texture
    // uploads as soon as its 1x1 pixel resolves, and the upload needs the
    // renderer to create the context texture.
    this.createDefaultTexture();

    // Create text renderers
    this.hasCanvasEngine = false;
    // Filter out incompatible engines first
    const compatibleEngines = fontEngines.filter((fontEngine: TextRenderer) => {
      const type = fontEngine.type;

      if (type === 'sdf' && renderMode === 'canvas') {
        console.warn(
          'MsdfTextRenderer is not compatible with Canvas renderer. Skipping...',
        );
        return false;
      }

      if (type === 'canvas') {
        this.hasCanvasEngine = true;
      }

      return true;
    });

    // Initialize SDF before Canvas
    const sortedEngines = compatibleEngines.sort(
      (a: TextRenderer, b: TextRenderer) => {
        if (a.type === 'sdf') return -1;
        if (b.type === 'sdf') return 1;
        return 0;
      },
    );

    for (let i = 0; i < sortedEngines.length; i++) {
      const fontEngine = sortedEngines[i]!;
      const type = fontEngine.type;
      this.textRenderers[type] = fontEngine;
      this.fontHandlers[type] = fontEngine.font;
      fontEngine.init(this);
    }

    if (Object.keys(this.textRenderers).length === 0) {
      console.warn('No text renderers available. Your text will not render.');
    }

    // create root node
    const rootNode = new CoreNode(this, {
      x: 0,
      y: 0,
      w: appWidth,
      h: appHeight,
      alpha: 1,
      ignoreParentAlpha: false,
      autosize: false,
      clipping: false,
      color: 0x00000000,
      colorTop: 0x00000000,
      colorBottom: 0x00000000,
      colorLeft: 0x00000000,
      colorRight: 0x00000000,
      colorTl: 0x00000000,
      colorTr: 0x00000000,
      placeholderColor: 0x00000000,
      colorBl: 0x00000000,
      colorBr: 0x00000000,
      zIndex: 0,
      scaleX: 1,
      scaleY: 1,
      mountX: 0,
      mountY: 0,
      mount: 0,
      pivot: 0.5,
      pivotX: 0.5,
      pivotY: 0.5,
      rotation: 0,
      parent: null,
      texture: null,
      textureOptions: EMPTY_TEXTURE_OPTIONS,
      shader: this.defShaderNode,
      src: null,
      scale: 1,
    });

    this.root = rootNode;

    // Initialize root node properties. Copy in place into the eagerly-allocated
    // matrices so the hidden class for these fields stays stable.
    rootNode.updateLocalTransform();
    Matrix3d.copy(rootNode.localTransform!, rootNode.globalTransform);
    rootNode.updateGlobalGeometry();
    rootNode.updateRenderState(CoreNodeRenderState.InViewport);
    rootNode.updateIsRenderable();

    // Initialize premultiplied colors (default is transparent 0x00000000)
    rootNode.premultipliedColorTl =
      rootNode.premultipliedColorTr =
      rootNode.premultipliedColorBl =
      rootNode.premultipliedColorBr =
        0;

    // execute platform start loop
    if (autoStart === true) {
      this.platform.startLoop(this);
    }
  }

  setClearColor(color: number) {
    // The setter updates the renderer and requests a render.
    this.clearColor = color;
  }

  /**
   * Update the target frame time based on the current targetFPS setting
   *
   * @remarks
   * This should be called whenever the targetFPS option is changed
   * to ensure targetFrameTime stays in sync.
   * targetFPS of 0 means no throttling (targetFrameTime = 0)
   * targetFPS > 0 means throttle to 1000/targetFPS milliseconds
   */
  updateTargetFrameTime() {
    this.targetFrameTime =
      this.options.targetFPS > 0 ? 1000 / this.options.targetFPS : 0;
  }

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
  updateFrameTime(frameTime?: number) {
    const newFrameTime =
      frameTime !== undefined && frameTime > 0
        ? frameTime
        : this.platform.getTimeStamp();
    this.lastFrameTime = this.currentFrameTime;
    this.currentFrameTime = newFrameTime;
    this.elapsedTime = newFrameTime - this.startTime;
    this.deltaTime = !this.lastFrameTime
      ? 100 / 6
      : newFrameTime - this.lastFrameTime;
    this.txMemManager.frameTime = newFrameTime;

    // This event is emitted at the beginning of the frame (before any updates
    // or rendering), so no need to to use `stage.queueFrameEvent` here. The
    // listener check keeps the payload allocation off frames nobody watches.
    const eventBus = this.eventBus;
    if (eventBus.hasListener('frameTick') === true) {
      eventBus.emit('frameTick', {
        time: this.currentFrameTime,
        delta: this.deltaTime,
      });
    }
  }

  /**
   * Mark the WebGL context as lost. Stops GL work and notifies consumers.
   *
   * @remarks
   * The engine does not rebuild GPU resources in-place; consumers are expected
   * to reload the app in response to the `contextLost` event.
   */
  setContextLost() {
    if (this.isContextLost === true) {
      return;
    }
    this.isContextLost = true;
    this.eventBus.emit('contextLost');
  }

  /**
   * Create default PixelTexture
   */
  createDefaultTexture() {
    const dt = this.txManager.createTexture('ColorTexture', {
      color: 0xffffffff,
    });
    (this.defaultTexture as ColorTexture) = dt;

    // Load synchronously: the 1x1 pixel is built inline and both backends
    // upload with straight-line code, so the texture is 'loaded' before this
    // method returns — and therefore before any node can be constructed.
    // The async `loadTexture` path would leave it 'loading' across a
    // microtask hop, forcing every node created in the same task (an app
    // building its scene right after renderer init) to subscribe to the
    // 'loaded' event to re-derive renderability.
    dt.textureData = dt.buildTextureData();
    this.txManager.uploadTexture(dt);

    // Request a render in case the RAF is paused.
    // Fixes: https://github.com/lightning-js/renderer/issues/123
    this.requestRender();

    // Mark the default texture as ALWAYS renderable
    // This prevents it from ever being cleaned up.
    // Fixes https://github.com/lightning-js/renderer/issues/262
    // The load() this triggers early-returns: the texture is already loaded.
    dt.setRenderableOwner('stage', true);
  }

  /**
   * Update animations
   */
  updateAnimations(): boolean {
    const { animationManager } = this;
    if (!this.root) {
      return false;
    }
    // Checked before the step as well as after: `update()` removes finished
    // animations, and an animation's final frame still applies values and
    // renders motion. Counting only the survivors dropped every animation's
    // last frame from the animated FPS sample and, worse, let the greedy
    // `processUntil` upload path run on a frame the viewer still sees moving.
    const hadAnimations = animationManager.activeAnimations.length > 0;
    // step animation
    animationManager.update(this.deltaTime);
    return hadAnimations || animationManager.activeAnimations.length > 0;
  }

  /**
   * Check if the scene has updates
   */
  hasSceneUpdates() {
    return (
      !!this.root.updateType ||
      this.renderRequested ||
      this.txManager.hasUpdates()
    );
  }

  /**
   * Trim text renderer caches back to their configured limits.
   *
   * Called when the stage goes idle so layout-cache eviction never competes
   * with active rendering.
   */
  cleanupTextRenderers() {
    const textRenderers = this.textRenderers;
    for (const key in textRenderers) {
      textRenderers[key]!.cleanup();
    }
  }

  /**
   * Start a new frame draw
   */
  drawFrame(hasActiveAnimations: boolean = false) {
    const { renderer, renderRequested, root, platform } = this;

    // Phase attribution rides the same opt-in as the rest of FPS sampling, so
    // a build that reports nothing pays nothing: no timestamps, and no branch
    // past this one read. The clock reads are very nearly the entire cost of
    // measuring, an order of magnitude above the counters and histogram they
    // feed, which is why they are gated here and why the closing one is
    // skipped on frames that upload nothing.
    //
    // Snapshotted once rather than re-read at each boundary, so a frame is
    // either measured throughout or not at all. A mid-frame change to the
    // option (an event subscriber calling `setOptions`) would otherwise leave
    // a phase differencing against a boundary that was never stamped.
    const sampling = this.options.fpsUpdateInterval > 0;
    let updateStart = 0;
    let renderStart = 0;
    let uploadStart = 0;
    let uploadEnd = 0;
    if (sampling === true) {
      updateStart = platform.getTimeStamp();
    }

    // Update tree if needed
    do {
      const forceUpdate = this.reprocessFrame;
      this.reprocessFrame = false;

      if (root.updateType !== 0 || forceUpdate) {
        root.updateType = 0;
        const childUpdateType = root.childUpdateType;
        root.childUpdateType = 0;

        for (let i = 0, length = root.children.length; i < length; i++) {
          const child = root.children[i] as CoreNode;

          if (childUpdateType !== 0) {
            child.updateType |= childUpdateType;
          }

          if (child.updateType === 0) {
            continue;
          }

          child.update(this.deltaTime, root.clippingRect);
        }
      }

      if (this.reprocessCallback !== null) {
        this.reprocessCallback();
        this.reprocessCallback = null;
      }
    } while (this.reprocessFrame);

    if (sampling === true) {
      renderStart = platform.getTimeStamp();
    }

    // Reset render operations and clear the canvas
    renderer.reset();

    // Update render list if dirty
    if (this.renderListDirty === true) {
      this.renderList.length = 0;
      this.buildRenderList(this.root);
      this.renderListDirty = false;
    } else {
      // Fill quads buffer
      const renderList = this.renderList;
      for (let i = 0, len = renderList.length; i < len; i++) {
        renderList[i]!.renderQuads(renderer);
      }
    }

    // Perform render pass
    renderer.render();

    if (sampling === true) {
      uploadStart = platform.getTimeStamp();
      // Stands in as the end boundary too. Most steady-state frames upload
      // nothing, and stamping the clock again to measure a block that was
      // skipped would both cost a read and report sub-microsecond noise where
      // the honest answer is a flat zero.
      uploadEnd = uploadStart;
    }

    // Upload queued textures AFTER the render pass, not before it.
    //
    // `texImage2D` is a synchronous driver-side copy and the single most
    // expensive call in a scroll frame: measured p90 31ms, worst case 46ms for
    // one 1280-wide image on a throttled TV profile. Running it ahead of
    // `render()` held this frame's draw calls out of the command buffer for
    // that whole stall, leaving the GPU idle while the CPU copied pixels.
    // Issuing the draws first lets the GPU process chew on them while the
    // upload runs, so the two overlap instead of serializing.
    //
    // The cost is that a texture uploaded here first appears one frame later,
    // since the render list for this frame was already built. At scroll frame
    // rates that is a sub-20ms delay on an image that was not on screen at all
    // a moment ago, which is a good trade for taking the stall off the
    // critical path.
    //
    // Ordering is safe for GL state: uploads bind through WebGlContextWrapper,
    // which shadows the active unit and its bound texture, so the next frame's
    // render re-binds on mismatch rather than inheriting a stale binding. This
    // still runs ahead of the critical-memory cleanup below so a texture that
    // pushes the budget over is handled in the same frame.
    if (this.txManager.hasUpdates() === true) {
      if (sampling === true) {
        // Queue depth before the drain. The interval's high-water mark is the
        // backpressure signal: a climbing peak means arrivals are outpacing
        // the per-frame upload budget and queued images are appearing late.
        const queued = this.txManager.uploadQueueSize;
        if (queued > this.fpsMaxUploadQueue) {
          this.fpsMaxUploadQueue = queued;
        }
      }

      // While animating, upload at most one texture per frame so uploads don't
      // steal time from the animation; otherwise fill the per-frame time budget.
      //
      // These run synchronously. They used to return a promise that was not
      // awaited, which deferred every upload into a microtask continuation
      // draining after this callback had already returned: the cost landed
      // outside the frame where it could not be attributed, and the time budget
      // below measured wall-clock across the awaits rather than across the
      // uploads it was meant to pace.
      let uploaded: number;
      if (hasActiveAnimations === true) {
        uploaded = this.txManager.processOne();
      } else {
        uploaded = this.txManager.processUntil(
          this.options.textureProcessingTimeLimit,
        );
      }

      if (sampling === true) {
        uploadEnd = platform.getTimeStamp();
        this.fpsUploadFrames++;
        this.fpsUploadedTextures += uploaded;
      }
    }

    // FPS sampling is opt-in through `fpsUpdateInterval` and has to run on
    // frames that actually rendered. WebPlatform's idle path calls
    // `calculateFps` with no such guard, so keeping this call behind a
    // build-time flag meant a production build (where the flag was false)
    // sampled idle polls exclusively: rendered frames incremented nothing, and
    // the reported figure was the ~15ms idle poll cadence rather than the
    // frame rate. Gating on the interval instead keeps the disabled case to
    // one property read per frame and makes `fpsUpdateInterval` the single
    // switch for every telemetry emit, `renderUpdate` included.
    if (sampling === true) {
      // Bank this frame's phases before `calculateFps`, which may close the
      // interval and emit: accumulating afterwards would leave the frame that
      // trips the boundary out of the sample it belongs to.
      // Read here rather than in `updateAnimations` so the sample is scoped to
      // rendered frames without any hand-off: the loop calls that immediately
      // before this, and idle ticks never reach `drawFrame` at all.
      const activeAnimations = this.animationManager.activeAnimations.length;
      this.fpsAnimationSum += activeAnimations;
      if (activeAnimations > this.fpsMaxAnimations) {
        this.fpsMaxAnimations = activeAnimations;
      }

      // Totals and per-frame peaks off the same three differences. The totals
      // spread a spike across the interval; the peaks are what let a fat
      // histogram tail be pinned on the phase that caused it.
      const frameUpdateMs = renderStart - updateStart;
      const frameRenderMs = uploadStart - renderStart;
      const frameUploadMs = uploadEnd - uploadStart;
      this.fpsUpdateMs += frameUpdateMs;
      this.fpsRenderMs += frameRenderMs;
      this.fpsUploadMs += frameUploadMs;
      if (frameUpdateMs > this.fpsMaxUpdateMs) {
        this.fpsMaxUpdateMs = frameUpdateMs;
      }
      if (frameRenderMs > this.fpsMaxRenderMs) {
        this.fpsMaxRenderMs = frameRenderMs;
      }
      if (frameUploadMs > this.fpsMaxUploadMs) {
        this.fpsMaxUploadMs = frameUploadMs;
      }

      // Classified by `hasActiveAnimations`, not `activeAnimations > 0`: the
      // loop computed it across the animation step, so the final frame of an
      // animation — stepped to completion and removed before this ran — still
      // counts as animated. The count above intentionally reads the survivors:
      // it measures load still running, this measures whether the frame
      // rendered motion.
      this.calculateFps(true, hasActiveAnimations === true);

      // Rides the same switch. The counts it compares are maintained by the
      // renderer as part of drawing, so the read is two field loads and two
      // compares; the emit fires only on a frame that changed them. With the
      // interval at 0 an app pays neither, the same as for `fpsUpdate`.
      this.calculateRenderInfo();
    }

    // Reset renderRequested flag if it was set
    if (renderRequested === true) {
      this.renderRequested = false;
    }

    const timedNodes = this.timedNodes;
    for (let i = 0, len = timedNodes.length; i < len; i++) {
      if (timedNodes[i]!.isRenderable === true) {
        this.requestRender();
        break;
      }
    }
    // Check if we need to cleanup textures
    if (this.txMemManager.criticalCleanupRequested === true) {
      this.txMemManager.cleanup();
    }
  }

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
  queueFrameEvent(name: string, data: unknown) {
    this.frameEventQueue.push([name, data]);
  }

  /**
   * Emit all queued frame events
   *
   * @remarks
   * This method should be called after the frame has been rendered to emit
   * all events that were queued during the frame.
   *
   * See {@link queueFrameEvent} for more information.
   */
  flushFrameEvents() {
    const queue = this.frameEventQueue;
    const len = queue.length;
    if (len === 0) {
      return;
    }

    // Swap the queue out before emitting, not after. Subscribers are
    // client code: one that throws unwinds straight out of this method, and
    // a reset placed after the loop would never run. The whole queue would
    // then replay on the next frame, duplicating every event already
    // delivered and re-throwing forever if the fault is deterministic.
    // Clearing first bounds the damage to the remaining events of one frame.
    this.frameEventQueue = [];

    for (let i = 0; i < len; i++) {
      const event = queue[i]!;
      this.eventBus.emit(event[0], event[1]);
    }
  }

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
  calculateFps(rendered: boolean, animating: boolean = false) {
    // If there's an FPS update interval, emit the FPS update event
    // when the specified interval has elapsed.
    const { fpsUpdateInterval } = this.options;
    if (fpsUpdateInterval > 0) {
      // `fpsUpdateInterval` is writable at runtime, through `setOptions` and by
      // assigning `stage.options` directly, so the change is detected from here
      // rather than hooked at every writer: a missed writer would be a
      // heisenbug, and this costs one compare per tick. Without it, disabling
      // sampling and later re-enabling it would carry the old interval's
      // half-finished accumulators into the first new sample and fire it early.
      if (fpsUpdateInterval !== this.fpsLastInterval) {
        this.fpsLastInterval = fpsUpdateInterval;
        this.resetFpsSample();
      }

      const delta = this.deltaTime;

      // The interval is wall clock, so a sample still lands on schedule while
      // the scene sits idle. That keeps the event working as a heartbeat
      // instead of going silent, which would read as a hang.
      this.fpsIntervalElapsed += delta;

      if (rendered === true) {
        this.fpsRenderedFrames++;

        // Pair a frame with its delta only when the previous tick rendered
        // too. `deltaTime` spans the gap since the previous tick of either
        // kind, so the frame that resumes rendering after an idle stretch
        // carries that whole idle gap (>=15ms). Counting it would charge idle
        // time to the renderer and understate the rate, severely for short
        // bursts. Dropping that frame from both sides of the ratio costs one
        // sample per burst and leaves what remains unbiased.
        if (this.fpsLastTickRendered === true) {
          this.fpsSampleFrames++;
          this.fpsSampleElapsed += delta;

          // Fine buckets below the split, coarse above it, then overflow. An
          // out-of-range index cannot arise: the clock is monotonic, so delta
          // is never negative, and everything at or above FRAME_TIME_MAX_MS is
          // folded into the last bucket.
          let bucket: number;
          if (delta < FRAME_TIME_SPLIT_MS) {
            bucket = delta | 0;
          } else if (delta < FRAME_TIME_MAX_MS) {
            bucket =
              FRAME_TIME_SPLIT_MS +
              (((delta - FRAME_TIME_SPLIT_MS) / FRAME_TIME_COARSE_MS) | 0);
          } else {
            bucket = FRAME_TIME_BUCKET_COUNT - 1;
          }
          const buckets = this.fpsFrameTimeBuckets;
          buckets[bucket] = buckets[bucket]! + 1;

          if (delta > this.fpsMaxFrameTime) {
            this.fpsMaxFrameTime = delta;
          }

          // The animated subset reuses the bucket index computed above, so the
          // split costs an increment and a compare rather than a second
          // classification.
          if (animating === true) {
            this.fpsAnimatedFrames++;
            this.fpsAnimatedElapsed += delta;

            const animatedBuckets = this.fpsAnimatedBuckets;
            animatedBuckets[bucket] = animatedBuckets[bucket]! + 1;

            if (delta > this.fpsAnimatedMaxFrameTime) {
              this.fpsAnimatedMaxFrameTime = delta;
            }
          }
        }
      } else {
        this.fpsIdleTicks++;
      }

      this.fpsLastTickRendered = rendered;

      if (this.fpsIntervalElapsed >= fpsUpdateInterval) {
        this.emitFpsUpdate();
      }
    }
  }

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
  setTelemetrySegment(label: string) {
    if (label === this.telemetrySegment) {
      return;
    }

    // Nothing measured yet means nothing worth emitting, and emitting here
    // would post an empty sample on every startup label assignment.
    if (
      this.options.fpsUpdateInterval > 0 &&
      (this.fpsRenderedFrames > 0 || this.fpsIdleTicks > 0)
    ) {
      this.emitFpsUpdate();
    }

    this.telemetrySegment = label;
  }

  /**
   * Clear every accumulator backing the current FPS sample.
   *
   * @remarks
   * Deliberately does not touch `fpsLastTickRendered`. That is continuity
   * state about the previous tick rather than sample state, and clearing it
   * here would drop a frame from the rate at every interval boundary instead
   * of only at the start of a rendering burst.
   */
  private resetFpsSample() {
    this.fpsSampleFrames = 0;
    this.fpsSampleElapsed = 0;
    this.fpsRenderedFrames = 0;
    this.fpsIdleTicks = 0;
    this.fpsIntervalElapsed = 0;
    this.fpsMaxFrameTime = 0;
    this.fpsAnimatedFrames = 0;
    this.fpsAnimatedElapsed = 0;
    this.fpsAnimatedMaxFrameTime = 0;
    this.fpsAnimationSum = 0;
    this.fpsMaxAnimations = 0;
    this.fpsUploadFrames = 0;
    this.fpsUpdateMs = 0;
    this.fpsRenderMs = 0;
    this.fpsUploadMs = 0;
    this.fpsMaxUpdateMs = 0;
    this.fpsMaxRenderMs = 0;
    this.fpsMaxUploadMs = 0;
    this.fpsUploadedTextures = 0;
    this.fpsMaxUploadQueue = 0;

    const buckets = this.fpsFrameTimeBuckets;
    const animatedBuckets = this.fpsAnimatedBuckets;
    for (let i = 0; i < FRAME_TIME_BUCKET_COUNT; i++) {
      buckets[i] = 0;
      animatedBuckets[i] = 0;
    }
  }

  private emitFpsUpdate() {
    // Rate over continuous rendering time rather than over the wall-clock
    // interval: an interval that was 70% idle still reports the rate the
    // renderer actually sustained while it had work to do. `0` means nothing
    // rendered, which `idleTicks` separates from a stall.
    const fps =
      this.fpsSampleElapsed > 0
        ? Math.round((this.fpsSampleFrames * 1000) / this.fpsSampleElapsed)
        : 0;
    const sampledFrames = this.fpsSampleFrames;
    const renderedFrames = this.fpsRenderedFrames;
    const idleTicks = this.fpsIdleTicks;
    const renderedMs = this.fpsSampleElapsed;
    const maxFrameTime = this.fpsMaxFrameTime;
    // Rate across animated rendering time only. This is the number to watch:
    // it answers "was it smooth while something was moving", where the overall
    // `fps` is diluted by one-off renders that no viewer perceives as motion.
    const animatedFps =
      this.fpsAnimatedElapsed > 0
        ? Math.round((this.fpsAnimatedFrames * 1000) / this.fpsAnimatedElapsed)
        : 0;
    const animatedFrames = this.fpsAnimatedFrames;
    const animatedMs = this.fpsAnimatedElapsed;
    const animatedMaxFrameTime = this.fpsAnimatedMaxFrameTime;
    const maxActiveAnimations = this.fpsMaxAnimations;
    const meanActiveAnimations =
      renderedFrames > 0 ? this.fpsAnimationSum / renderedFrames : 0;
    const uploadFrames = this.fpsUploadFrames;
    const updateMs = this.fpsUpdateMs;
    const renderMs = this.fpsRenderMs;
    const uploadMs = this.fpsUploadMs;
    const maxUpdateMs = this.fpsMaxUpdateMs;
    const maxRenderMs = this.fpsMaxRenderMs;
    const maxUploadMs = this.fpsMaxUploadMs;
    const uploadedTextures = this.fpsUploadedTextures;
    const maxUploadQueueSize = this.fpsMaxUploadQueue;

    // The consumer keeps the array, so it has to be a fresh one rather than a
    // shared buffer; that is one allocation per interval, not per frame.
    const sourceBuckets = this.fpsFrameTimeBuckets;
    const sourceAnimated = this.fpsAnimatedBuckets;
    const frameTimeBuckets = new Array<number>(FRAME_TIME_BUCKET_COUNT);
    const animatedFrameTimeBuckets = new Array<number>(FRAME_TIME_BUCKET_COUNT);
    for (let i = 0; i < FRAME_TIME_BUCKET_COUNT; i++) {
      frameTimeBuckets[i] = sourceBuckets[i]!;
      animatedFrameTimeBuckets[i] = sourceAnimated[i]!;
    }

    this.resetFpsSample();

    this.queueFrameEvent('fpsUpdate', {
      fps,
      sampledFrames,
      renderedFrames,
      idleTicks,
      renderedMs,
      frameTimeBuckets,
      maxFrameTime,
      animatedFps,
      animatedFrames,
      animatedMs,
      animatedFrameTimeBuckets,
      animatedMaxFrameTime,
      segment: this.telemetrySegment,
      meanActiveAnimations,
      maxActiveAnimations,
      updateMs,
      renderMs,
      uploadMs,
      maxUpdateMs,
      maxRenderMs,
      maxUploadMs,
      uploadFrames,
      uploadedTextures,
      maxUploadQueueSize,
      contextSpyData: this.contextSpy?.getData() ?? null,
      renderOps: this.renderer.getRenderOpCount() ?? 0,
      quads: this.renderer.getQuadCount() ?? 0,
    } satisfies FpsUpdatePayload);
    this.contextSpy?.reset();
  }

  calculateRenderInfo() {
    const quads = this.renderer.getQuadCount();
    const renderOps = this.renderer.getRenderOpCount();
    if (
      (quads && quads !== this.numQuadsRendered) ||
      (renderOps && renderOps !== this.numRenderOpsRendered)
    ) {
      this.numQuadsRendered = quads || 0;
      this.numRenderOpsRendered = renderOps || 0;
      this.queueFrameEvent('renderUpdate', {
        quads: this.numQuadsRendered,
        renderOps: this.numRenderOpsRendered,
      } satisfies RenderUpdatePayload);
    }
  }

  requestRenderListUpdate() {
    this.requestRender();

    // A rebuild is already pending and the render list does not change until
    // drawFrame rebuilds it, so repeats have nothing to add. Skipping them also
    // keeps the invalidation below off the hot path when many nodes flip
    // renderable state in one frame (e.g. a whole row scrolling out of view).
    if (this.renderListDirty === true) {
      return;
    }

    // Anything the renderer caches in render-list order is now stale.
    if (this.renderer.invalidateRenderListCaches !== undefined) {
      this.renderer.invalidateRenderListCaches();
    }
    this.renderListDirty = true;
  }

  buildRenderList(node: CoreNode) {
    // If the node is renderable and has a loaded texture, add it
    if (node.isRenderable === true) {
      node.renderQuads(this.renderer);
      this.renderList.push(node);
    }

    const children = node.children;
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const child = children[i] as CoreNode;

      // Skip invisible subtrees
      if (
        child.worldAlpha === 0 ||
        child.renderState === CoreNodeRenderState.OutOfBounds
      ) {
        continue;
      }

      this.buildRenderList(child);
    }
  }

  /**
   * Request a render pass without forcing an update
   */
  requestRender() {
    this.renderRequested = true;
  }

  /**
   * Ask the render loop to stop scheduling ticks.
   *
   * @remarks
   * The loop keeps running until no animation is active and the pending frame
   * has been drawn, then stops. With `immediate` it stops on its next tick
   * before drawing anything, animations frozen where they are.
   * {@link isLoopPaused} reports when it has.
   */
  pauseLoop(immediate: boolean = false) {
    this.loopPauseRequested = true;
    this.loopPauseImmediate = immediate;
  }

  /**
   * Cancel a pending pause, or restart a paused loop.
   */
  resumeLoop() {
    this.loopPauseRequested = false;
    this.loopPauseImmediate = false;
    if (this.isLoopPaused === false) {
      return;
    }
    this.isLoopPaused = false;
    // Zero the previous frame time so the first tick after resume takes the
    // nominal delta. Otherwise the whole paused gap would reach the animation
    // step (an animation started while paused would jump to its end) and the
    // FPS sample.
    this.currentFrameTime = 0;
    this.requestRender();
    if (this.loopResume !== null) {
      this.loopResume();
    }
  }

  reprocessUpdates(callback?: () => void) {
    this.reprocessFrame = true;
    if (callback) {
      this.reprocessCallback = callback;
    }
  }

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
  resolveTextRenderer(
    trProps: TrProps,
    textRendererOverride: keyof TextRenderers | null = null,
  ): TextRenderer | null {
    // If we have an overide, return it
    if (textRendererOverride !== null) {
      const overrideKey = String(textRendererOverride);
      if (this.textRenderers[overrideKey] === undefined) {
        console.warn(`Text renderer override '${overrideKey}' not found.`);
        return null;
      }

      return this.textRenderers[overrideKey];
    }

    // First check SDF
    if (this.fontHandlers['sdf']?.canRenderFont(trProps) === true) {
      return this.textRenderers.sdf || null;
    }

    // If we have a canvas engine, we can return it (it can render all fonts)
    if (this.hasCanvasEngine === true) {
      return this.textRenderers.canvas || null;
    }

    // If we have no font engines, return null
    console.warn('No text renderers available. Your text will not render.');
    return null;
  }

  createNode(props: Partial<CoreNodeProps>, resolved = false) {
    // When `resolved` is true, the caller (typically a framework integration
    // like solid-tv) built `props` via `createNodeProps` and filled it in
    // over time.  CoreNode adopts that bag directly — no second resolution
    // pass and no second allocation.
    const resolvedProps = resolved
      ? (props as CoreNodeProps)
      : this.resolveNodeDefaults(props);
    return new CoreNode(this, resolvedProps);
  }

  createTextNode(props: Partial<CoreTextNodeProps>, resolved = false) {
    const resolvedProps = resolved
      ? (props as CoreTextNodeProps)
      : this.resolveTextNodeDefaults(props);

    const resolvedTextRenderer = this.resolveTextRenderer(
      resolvedProps,
      resolvedProps.textRendererOverride as keyof TextRenderers | null,
    );

    if (!resolvedTextRenderer) {
      throw new Error(
        `No compatible text renderer found for ${resolvedProps.fontFamily}`,
      );
    }

    return new CoreTextNode(this, resolvedProps, resolvedTextRenderer);
  }

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
  createNodeProps(initial?: Partial<CoreNodeProps>): CoreNodeProps {
    return this.resolveNodeDefaults(initial ?? {});
  }

  /**
   * Allocate a fully-resolved CoreTextNodeProps bag.  See
   * {@link createNodeProps}.
   */
  createTextNodeProps(initial?: Partial<CoreTextNodeProps>): CoreTextNodeProps {
    return this.resolveTextNodeDefaults(initial ?? {});
  }

  /**
   * Apply text-specific defaults on top of a base CoreNodeProps build.
   * Shared by `createTextNode` and `createTextNodeProps`.
   */
  protected resolveTextNodeDefaults(
    props: Partial<CoreTextNodeProps>,
  ): CoreTextNodeProps {
    const fontSize = props.fontSize || 16;
    const resolvedProps = this.resolveNodeDefaults(props) as CoreTextNodeProps;
    resolvedProps.text = props.text ?? '';
    resolvedProps.textRendererOverride = props.textRendererOverride ?? null;
    resolvedProps.fontSize = fontSize;
    resolvedProps.fontFamily = props.fontFamily || 'sans-serif';
    resolvedProps.fontStyle = props.fontStyle || 'normal';
    resolvedProps.textAlign = props.textAlign || 'left';
    resolvedProps.offsetY = props.offsetY || 0;
    resolvedProps.letterSpacing = props.letterSpacing || 0;
    resolvedProps.lineHeight = props.lineHeight || 1.2;
    resolvedProps.maxLines = props.maxLines || 0;
    resolvedProps.verticalAlign = props.verticalAlign || 'top';
    resolvedProps.overflowSuffix = props.overflowSuffix || '...';
    resolvedProps.wordBreak = props.wordBreak || 'break-word';
    resolvedProps.contain = props.contain || 'none';
    resolvedProps.maxWidth = props.maxWidth || 0;
    resolvedProps.maxHeight = props.maxHeight || 0;
    resolvedProps.forceLoad = props.forceLoad || false;
    return resolvedProps;
  }

  setBoundsMargin(value: number | BoundsMargin) {
    this.boundsMargin = normalizeBoundsMargin(value);
    this.updateViewportBounds();
  }

  /**
   * Re-test every node's render bounds, e.g. after the bounds margin changes.
   * The viewport extent itself is fixed at construction.
   */
  updateViewportBounds() {
    // The frame loop walks root.children directly without running root.update
    // (see drawFrame), so any bit set on the root itself is discarded — only
    // `Children` (to make root.updateType non-zero) and childUpdateType have
    // an effect. Push a Clipping pass down: it is the one flag that
    // propagates through the whole tree, and each node's Clipping block
    // raises its own render-state check — so every descendant re-tests
    // against the new viewport extent.
    this.root.setUpdateType(UpdateType.Children);
    this.root.childUpdateType |= UpdateType.Clipping;
  }

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
  trackTimedNode(node: CoreNode) {
    const timedNodes = this.timedNodes;
    for (let i = 0, len = timedNodes.length; i < len; i++) {
      if (timedNodes[i] === node) {
        return;
      }
    }
    timedNodes.push(node);
  }

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
  untrackTimedNode(node: CoreNode) {
    const timedNodes = this.timedNodes;
    const last = timedNodes.length - 1;
    for (let i = 0; i <= last; i++) {
      if (timedNodes[i] === node) {
        timedNodes[i] = timedNodes[last]!;
        timedNodes.length = last;
        return;
      }
    }
  }

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
  protected resolveNodeDefaults(props: Partial<CoreNodeProps>): CoreNodeProps {
    const color = props.color ?? 0xffffffff;
    let colorTop = color;
    let colorBottom = color;
    let colorLeft = color;
    let colorRight = color;
    let colorTl = color;
    let colorTr = color;
    let colorBl = color;
    let colorBr = color;

    // Fast-path: Check if any complex color props are present
    // We check values directly to avoid destructuring
    if (
      props.colorTop !== undefined ||
      props.colorBottom !== undefined ||
      props.colorLeft !== undefined ||
      props.colorRight !== undefined ||
      props.colorTl !== undefined ||
      props.colorTr !== undefined ||
      props.colorBl !== undefined ||
      props.colorBr !== undefined
    ) {
      const {
        colorTop: top,
        colorBottom: bottom,
        colorLeft: left,
        colorRight: right,
      } = props;

      colorTop = top ?? color;
      colorBottom = bottom ?? color;
      colorLeft = left ?? color;
      colorRight = right ?? color;

      colorTl = props.colorTl ?? top ?? left ?? color;
      colorTr = props.colorTr ?? top ?? right ?? color;
      colorBl = props.colorBl ?? bottom ?? left ?? color;
      colorBr = props.colorBr ?? bottom ?? right ?? color;
    }

    const scale = props.scale ?? null;
    const mount = props.mount ?? 0;
    const pivot = props.pivot ?? 0.5;

    // Kept in every dev build and whenever the inspector is enabled: it can be
    // enabled at runtime (setOptions), and it mirrors the `data` of nodes that
    // already exist.
    const data =
      ENABLE_INSPECTOR || isProductionEnvironment === false
        ? santizeCustomDataMap(props.data ?? {})
        : {};

    return {
      x: props.x ?? 0,
      y: props.y ?? 0,
      w: props.w ?? 0,
      h: props.h ?? 0,
      alpha: props.alpha ?? 1,
      ignoreParentAlpha: props.ignoreParentAlpha ?? false,
      autosize: props.autosize ?? false,
      clipping: props.clipping ?? false,
      color,
      colorTop,
      colorBottom,
      colorLeft,
      colorRight,
      colorTl,
      colorTr,
      colorBl,
      colorBr,
      placeholderColor: props.placeholderColor ?? 0,
      zIndex: props.zIndex ?? 0,
      parent: props.parent ?? null,
      texture: props.texture ?? null,
      textureOptions: props.textureOptions ?? EMPTY_TEXTURE_OPTIONS,
      shader: props.shader ?? this.defShaderNode,
      src: props.src ?? null,
      srcKey: props.srcKey,
      srcHeight: props.srcHeight,
      srcWidth: props.srcWidth,
      srcX: props.srcX,
      srcY: props.srcY,
      scale,
      scaleX: props.scaleX ?? scale ?? 1,
      scaleY: props.scaleY ?? scale ?? 1,
      mount,
      mountX: props.mountX ?? mount,
      mountY: props.mountY ?? mount,
      pivot,
      pivotX: props.pivotX ?? pivot,
      pivotY: props.pivotY ?? pivot,
      rotation: props.rotation ?? 0,
      data,
      imageType: props.imageType,
      preventDestroy: props.preventDestroy,
      componentName: props.componentName,
      componentLocation: props.componentLocation,
    };
  }

  /**
   * Cleanup Orphaned Textures
   *
   * @remarks
   * This method is used to cleanup orphaned textures that are no longer in use.
   */
  cleanup(full: boolean = false) {
    this.txMemManager.cleanup(full);
  }

  set clearColor(value: number) {
    this.renderer.updateClearColor(value);
    this.renderRequested = true;
    this.clrColor = value;
  }

  get clearColor() {
    return this.clrColor;
  }

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
  loadFont(
    rendererType: TextRenderers,
    options: FontLoadOptions,
  ): Promise<void> {
    const rendererTypeKey = String(rendererType);
    const fontHandler = this.fontHandlers[rendererTypeKey];

    if (!fontHandler) {
      return Promise.reject(
        new Error(
          `Font handler for renderer type '${rendererTypeKey}' not found. Available types: ${Object.keys(
            this.fontHandlers,
          ).join(', ')}`,
        ),
      );
    }

    return fontHandler.loadFont(this, options);
  }
}
