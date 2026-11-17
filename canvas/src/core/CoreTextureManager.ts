import { ImageWorkerManager } from './lib/ImageWorker.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import { ColorTexture } from './textures/ColorTexture.js';
import { ImageTexture } from './textures/ImageTexture.js';
import { NoiseTexture } from './textures/NoiseTexture.js';
import { SubTexture } from './textures/SubTexture.js';
import { Texture, TextureType } from './textures/Texture.js';
import type { TextureData } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';
import type { Stage } from './Stage.js';
import {
  validateCreateImageBitmap,
  detectPremultiplyAlphaHonored,
  type CreateImageBitmapSupport,
} from './lib/validateImageBitmap.js';
import type { Platform } from './platforms/Platform.js';
import { TextureError, TextureErrorCode } from './TextureError.js';

/**
 * Augmentable map of texture class types
 *
 * @remarks
 * This interface can be augmented by other modules/apps to add additional
 * texture types. The ones included directly here are the ones that are
 * included in the core library.
 */
export interface TextureMap {
  ColorTexture: typeof ColorTexture;
  ImageTexture: typeof ImageTexture;
  NoiseTexture: typeof NoiseTexture;
  SubTexture: typeof SubTexture;
}

export type ExtractProps<Type> = Type extends { z$__type__Props: infer Props }
  ? Props
  : never;

/**
 * Contains information about the texture manager's internal state
 * for debugging purposes.
 */
export interface TextureManagerDebugInfo {
  keyCacheSize: number;
}

export interface TextureManagerSettings {
  numImageWorkers: number;
  createImageBitmapSupport: 'auto' | 'basic' | 'options' | 'full';
  // Override for whether createImageBitmap honors premultiplyAlpha:'premultiply'.
  // 'auto' = detect via probe; boolean = force the value and skip the probe.
  premultiplyAlphaHonored: boolean | 'auto';
  maxRetryCount: number;
  // Upper bound on concurrent main-thread fetch+decode operations when no
  // image worker manager exists (numImageWorkers === 0). See CoreTextureManager
  // for how the gate is applied. `0` disables the gate (unbounded).
  imageDecodeConcurrency: number;
}

/**
 * A number in the closed interval [0, 1].
 *
 * @remarks
 * TypeScript cannot express a numeric range, so this alias documents the
 * contract rather than enforcing it — `clipX: 2` still compiles. Consumers
 * clamp on read (see `getTextureCoords` in WebGlRenderer and the `cover`
 * branch in CanvasRenderer) so an out-of-range value is well defined on both
 * backends instead of sampling outside the texture.
 */
export type UnitInterval = number;

export type ResizeModeOptions =
  | {
      /**
       * Specifies that the image should be resized to cover the specified dimensions.
       */
      type: 'cover';
      /**
       * The horizontal clipping position
       * To clip the left, set clipX to 0. To clip the right, set clipX to 1.
       * clipX 0.5 will clip a equal amount from left and right
       *
       * Values outside [0, 1] are clamped.
       *
       * @defaultValue 0.5
       */
      clipX?: UnitInterval;
      /**
       * The vertical clipping position
       * To clip the top, set clipY to 0. To clip the bottom, set clipY to 1.
       * clipY 0.5 will clip a equal amount from top and bottom
       *
       * Values outside [0, 1] are clamped.
       *
       * @defaultValue 0.5
       */
      clipY?: UnitInterval;
    }
  | {
      /**
       * Specifies that the image should be resized to fit within the specified dimensions.
       */
      type: 'contain';
      /**
       * The horizontal alignment of the contained image within the node
       * To align left, set x to 0. To align right, set x to 1.
       * x 0.5 centers the image horizontally
       *
       * Only applies when the image is narrower than the node.
       *
       * @defaultValue 0.5
       */
      x?: UnitInterval;
      /**
       * The vertical alignment of the contained image within the node
       * To align top, set y to 0. To align bottom, set y to 1.
       * y 0.5 centers the image vertically
       *
       * Only applies when the image is shorter than the node.
       *
       * @defaultValue 0.5
       */
      y?: UnitInterval;
    };

/**
 * Universal options for all texture types
 *
 * @remarks
 * Texture Options provide a way to specify options that are relevant to the
 * texture loading process (including caching) and specifically for how a
 * texture is rendered within a specific Node (or set of Nodes).
 *
 * They are not used in determining the cache key for a texture (except if
 * the `cacheKey` option is provided explicitly to oveerride the default
 * cache key for the texture instance) nor are they stored/referenced within
 * the texture instance itself. Instead, the options are stored/referenced
 * within individual Nodes. So a single texture instance can be used in
 * multiple Nodes each using a different set of options.
 */
export interface TextureOptions {
  /**
   * Preload the texture immediately even if it's not being rendered to the
   * screen.
   *
   * @remarks
   * This allows the texture to be used immediately without any delay when it
   * is first needed for rendering. Otherwise the loading process will start
   * when the texture is first rendered, which may cause a delay in that texture
   * being shown properly.
   *
   * @defaultValue `false`
   */
  preload?: boolean;

  /**
   * Prevent clean up of the texture when it is no longer being used.
   *
   * @remarks
   * This is useful when you want to keep the texture in memory for later use.
   * Regardless of whether the texture is being used or not, it will not be
   * cleaned up.
   *
   * @defaultValue `false`
   */
  preventCleanup?: boolean;

  /**
   * Number of times to retry loading a failed texture
   *
   * @remarks
   * When a texture fails to load, Lightning will retry up to this many times
   * before permanently giving up. Each retry will clear the texture ownership
   * and then re-establish it to trigger a new load attempt.
   *
   * Set to null to disable retries. Set to 0 to always try once and never retry.
   * This is typically only used on ImageTexture instances.
   *
   */
  maxRetryCount?: number | null;

  /**
   * Flip the texture horizontally when rendering
   *
   * @defaultValue `false`
   */
  flipX?: boolean;

  /**
   * Flip the texture vertically when rendering
   *
   * @defaultValue `false`
   */
  flipY?: boolean;

  /**
   * You can use resizeMode to determine the clipping automatically from the width
   * and height of the source texture. This can be convenient if you are unsure about
   * the exact image sizes but want the image to cover a specific area.
   *
   * The resize modes cover and contain are supported
   */
  resizeMode?: ResizeModeOptions;
}

/**
 * Insertion-ordered, dedup'd FIFO queue used by the texture upload
 * pipeline.
 *
 * Backed by an array (for ordered traversal without per-call iterator
 * allocation) plus a Set (for O(1) membership and cancel-by-reference).
 * Removed entries are tombstoned in the array — they're skipped on the
 * next `shift()`, and the array is compacted once the consumed prefix
 * grows large enough to be worth reclaiming.
 */
class TextureUploadQueue {
  private list: Texture[] = [];
  private membership: Set<Texture> = new Set();
  private head = 0;

  get size(): number {
    return this.membership.size;
  }

  has(texture: Texture): boolean {
    return this.membership.has(texture);
  }

  add(texture: Texture): void {
    if (this.membership.has(texture)) {
      return;
    }
    this.membership.add(texture);
    this.list.push(texture);
  }

  delete(texture: Texture): boolean {
    return this.membership.delete(texture);
  }

  /**
   * Remove and return the oldest live entry, or `undefined` if empty.
   */
  shift(): Texture | undefined {
    const list = this.list;
    const membership = this.membership;
    while (this.head < list.length) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const texture = list[this.head++]!;
      if (membership.has(texture)) {
        membership.delete(texture);
        this.compactIfNeeded();
        return texture;
      }
    }
    // Fully drained — reset for the next batch.
    this.head = 0;
    list.length = 0;
    return undefined;
  }

  private compactIfNeeded(): void {
    // Drop the consumed prefix once it's substantial in absolute terms
    // and at least half the array. Avoids growing the array unboundedly
    // when shift() runs faster than the queue refills.
    if (this.head >= 64 && this.head >= this.list.length >> 1) {
      this.list = this.list.slice(this.head);
      this.head = 0;
    }
  }
}

/**
 * Bounds how many async operations run concurrently.
 *
 * Used to cap main-thread fetch+decode (`getTextureData`) when there are no
 * image workers: on such devices every `createImageBitmap`/decode runs on the
 * main thread, so a scroll that makes dozens of image nodes renderable at once
 * would otherwise fire dozens of decodes back-to-back and starve the render
 * loop. A caller `await`s {@link acquire} before the work and calls
 * {@link release} in a `finally` after it.
 *
 * The in-flight slot is handed straight from a releaser to the next waiter, so
 * the active count never dips below `limit` while work is pending.
 *
 * Exported for unit testing; not part of the public renderer surface.
 */
export class ConcurrencyGate {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      // Transfer the slot to the next waiter without touching the count —
      // one operation left, one is starting, so `inFlight` is unchanged.
      next();
      return;
    }
    this.inFlight--;
  }
}

export class CoreTextureManager extends EventEmitter {
  /**
   * Map of textures by cache key
   */
  keyCache: Map<string, Texture> = new Map();

  /**
   * Map of texture constructors by their type name
   */
  txConstructors: Partial<TextureMap> = {};

  public maxRetryCount: number;
  private uploadTextureQueue: TextureUploadQueue = new TextureUploadQueue();
  /**
   * Textures currently between `setState('loading')` and either enqueue or
   * failure — i.e. mid fetch/decode, so present in no queue.
   *
   * Deliberately NOT part of `hasUpdates()`. Feeding this into
   * `Stage.hasSceneUpdates()` would hold the render loop on the
   * requestAnimationFrame path for the whole duration of a network fetch,
   * burning frames on a TV SoC while waiting on IO. This exists purely so a
   * caller can ask "is anything still arriving?" — see `hasPendingLoads`.
   */
  private pendingLoads = 0;
  private initialized = false;
  private stage: Stage;
  private numImageWorkers: number;
  private imageDecodeConcurrency: number;
  /**
   * Caps concurrent main-thread fetch+decode. Non-null only when there is no
   * image worker manager: the worker path posts every request straight through
   * without queueing, so it has no concurrency bound to interact with.
   * Assigned in {@link initialize} once worker availability is known.
   */
  private decodeGate: ConcurrencyGate | null = null;

  public platform: Platform;

  get pixelRatio(): number {
    return this.stage.pixelRatio;
  }

  imageWorkerManager: ImageWorkerManager | null = null;
  hasCreateImageBitmap = false;
  imageBitmapSupported = {
    basic: false,
    options: false,
    full: false,
    premultiplyHonored: null as boolean | null,
  };

  hasWorker = !!self.Worker;
  /**
   * Renderer that this texture manager is associated with
   *
   * @remarks
   * This MUST be set before the texture manager is used. Otherwise errors
   * will occur when using the texture manager.
   */
  renderer!: CoreRenderer;

  constructor(stage: Stage, settings: TextureManagerSettings) {
    super();

    const {
      numImageWorkers,
      createImageBitmapSupport,
      premultiplyAlphaHonored,
      maxRetryCount,
      imageDecodeConcurrency,
    } = settings;

    this.stage = stage;
    this.platform = stage.platform;
    this.numImageWorkers = numImageWorkers;
    this.maxRetryCount = maxRetryCount;
    this.imageDecodeConcurrency = imageDecodeConcurrency;

    if (createImageBitmapSupport === 'auto') {
      validateCreateImageBitmap(this.platform)
        .then((result) => {
          this.resolvePremultiplyAndInit(result, premultiplyAlphaHonored);
        })
        .catch(() => {
          console.warn(
            '[Lightning] createImageBitmap is not supported on this browser. ImageTexture will be slower.',
          );

          // initialized without image worker manager and createImageBitmap
          this.initialized = true;
          this.emit('initialized');
        });
    } else {
      this.resolvePremultiplyAndInit(
        {
          basic: createImageBitmapSupport === 'basic',
          options: createImageBitmapSupport === 'options',
          full: createImageBitmapSupport === 'full',
          premultiplyHonored: null,
        },
        premultiplyAlphaHonored,
      );
    }

    this.registerTextureType('ImageTexture', ImageTexture);
    this.registerTextureType('ColorTexture', ColorTexture);
    this.registerTextureType('NoiseTexture', NoiseTexture);
    this.registerTextureType('SubTexture', SubTexture);
  }

  /**
   * Decode images on the main thread: drop the worker manager and bound how
   * many decodes run at once (see `decodeGate`). Used when no worker is
   * available at init, and when the worker later fails to spawn (e.g. a CSP
   * that forbids blob workers).
   */
  private useMainThreadDecode(): void {
    this.imageWorkerManager = null;
    if (this.decodeGate === null && this.imageDecodeConcurrency > 0) {
      this.decodeGate = new ConcurrencyGate(this.imageDecodeConcurrency);
    }
  }

  registerTextureType<Type extends keyof TextureMap>(
    textureType: Type,
    textureClass: TextureMap[Type],
  ): void {
    this.txConstructors[textureType] = textureClass;
  }

  /**
   * Resolve `premultiplyHonored` on the support object, then initialize.
   *
   * - boolean override -> use it directly, skip the probe
   * - 'auto' -> run the detection probe (only meaningful when the options/full
   *   API exists, since that's the only path that passes the premultiply option)
   */
  private resolvePremultiplyAndInit(
    support: CreateImageBitmapSupport,
    premultiplyAlphaHonored: boolean | 'auto',
  ): void {
    if (premultiplyAlphaHonored !== 'auto') {
      support.premultiplyHonored = premultiplyAlphaHonored;
      this.initialize(support);
      return;
    }

    if (support.options === false && support.full === false) {
      support.premultiplyHonored = null;
      this.initialize(support);
      return;
    }

    detectPremultiplyAlphaHonored(this.platform)
      .then((honored) => {
        support.premultiplyHonored = honored;
        this.initialize(support);
      })
      .catch(() => {
        support.premultiplyHonored = null;
        this.initialize(support);
      });
  }

  private initialize(support: CreateImageBitmapSupport) {
    this.hasCreateImageBitmap =
      support.basic || support.options || support.full;
    this.imageBitmapSupported = support;

    if (support.premultiplyHonored === false) {
      console.warn(
        '[Lightning] createImageBitmap premultiplyAlpha:"premultiply" is not honored on this device and images may show alpha ghosting. GL-side premultiply fallback recommended.',
      );
    }

    if (this.hasCreateImageBitmap === false) {
      console.warn(
        '[Lightning] createImageBitmap is not supported on this browser. ImageTexture will be slower.',
      );
    }

    if (
      this.hasCreateImageBitmap === true &&
      this.hasWorker === true &&
      this.numImageWorkers > 0
    ) {
      // Exactly one worker, always. `numImageWorkers` above is only a
      // 0-or-more gate on whether image loading is offloaded at all.
      this.imageWorkerManager = new ImageWorkerManager(support, () => {
        this.useMainThreadDecode();
      });
    } else {
      console.warn(
        '[Lightning] Image worker count is 0 or workers are not supported on this browser. Image loading will be slower.',
      );
    }

    // Without an image worker manager, every fetch+decode runs on the main
    // thread. Bound how many run at once so a burst (e.g. a scroll that makes
    // many image nodes renderable in one tick) can't serialize dozens of
    // decodes and starve the render loop. With workers, the pool already caps
    // concurrency, so the gate stays null (no main-thread ceiling needed).
    //
    // Scope: this bounds the `createImageBitmap` decode, which happens inside
    // `getTextureData` (see `loadTexture`). On the `<img>` fallback path
    // (`hasCreateImageBitmap === false`) the image decodes lazily and the real
    // main-thread cost is the synchronous `texImage2D` at upload, which the
    // gate does not cover — the per-frame upload budget (`processUntil`) paces
    // that instead. The gate is therefore most effective on the
    // createImageBitmap(-polyfill) path.
    if (this.imageWorkerManager === null) {
      this.useMainThreadDecode();
    }

    this.initialized = true;
    this.emit('initialized');

    // Anything that arrived before initialization completed is now safe to
    // process. Without this, queued textures would sit until the next frame
    // tick happens to drain them.
    if (this.uploadTextureQueue.size > 0) {
      this.processUntil(Infinity);
    }
  }

  /**
   * Enqueue a texture for uploading to the GPU.
   *
   * @param texture - The texture to upload
   */
  enqueueUploadTexture(texture: Texture): void {
    if (texture.state === 'failed' || texture.state === 'freed') {
      return;
    }
    this.uploadTextureQueue.add(texture);
  }

  /**
   * Create a texture
   *
   * @param textureType - The type of texture to create
   * @param props - The properties to use for the texture
   */
  createTexture<Type extends keyof TextureMap>(
    textureType: Type,
    props: ExtractProps<TextureMap[Type]>,
  ): InstanceType<TextureMap[Type]> {
    const TextureClass = this.txConstructors[textureType];
    if (!TextureClass) {
      throw new TextureError(
        TextureErrorCode.TEXTURE_TYPE_NOT_REGISTERED,
        `Texture type "${textureType}" is not registered`,
      );
    }

    // Cache key is computed from raw props (each Texture's makeCacheKey
    // inlines its own defaults) so we can skip the resolveDefaults
    // allocation on a cache hit.
    const cacheKey = TextureClass.makeCacheKey(props as any);
    if (cacheKey) {
      const cached = this.keyCache.get(cacheKey);
      if (cached) {
        return cached as InstanceType<TextureMap[Type]>;
      }
    }

    const resolvedProps = TextureClass.resolveDefaults(props as any);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const texture = new TextureClass(this, resolvedProps as any);

    if (cacheKey) {
      this.initTextureToCache(texture, cacheKey);
    }

    return texture as InstanceType<TextureMap[Type]>;
  }

  /**
   * Override loadTexture to use the batched approach.
   *
   * @param texture - The texture to load
   */
  async loadTexture(texture: Texture): Promise<void> {
    if (texture.type === TextureType.subTexture) {
      // ignore subtextures - they get loaded through their parent
      return;
    }

    if (texture.state === 'loaded') {
      // if the texture is already loaded, just return
      return;
    }

    // Only image textures depend on initialization: it resolves
    // `createImageBitmap` support, the image worker and the decode gate.
    // Colour and noise textures build their bytes out of nothing, so holding
    // them behind an async capability probe only delays the first frame. The
    // default texture, which backs every plain-colour node, is one of them.
    const isImage = texture.type === TextureType.image;
    const localPixels = isImage && typeof ImageData !== 'undefined' && (texture as ImageTexture).props.src instanceof ImageData;
    if (isImage === true && !localPixels && this.initialized === false) {
      this.uploadTextureQueue.add(texture);
      return;
    }

    texture.setState('loading');

    // The fetch/decode/enqueue body is inline rather than in a helper: a
    // `finally` runs on every exit from its own `try`, early `return`s
    // included, so the pending-load counter is bracketed correctly without a
    // second async frame. That frame was not free: one promise allocation, a
    // microtask hop and an async state machine per texture, on a path a scroll
    // hits in bursts.
    this.pendingLoads++;
    try {
      // Focus colors need decoded Canvas pixels before this frame is painted.
      if (localPixels && this.renderer.mode === 'canvas' && (texture as ImageTexture).props.type !== 'compressed') {
        const image = texture as ImageTexture;
        texture.textureData = { data: image.props.src as ImageData,
          premultiplyAlpha: image.props.premultiplyAlpha ?? true };
        this.uploadTexture(texture);
        return;
      }
      // Bound concurrent main-thread fetch+decode. Only image textures have a
      // fetch+decode to bound: colour and noise textures generate their bytes
      // synchronously, so gating them would only park them behind image
      // decodes. `decodeGate` is null when image workers handle decoding
      // off-thread.
      const gate = isImage === true && !localPixels ? this.decodeGate : null;
      if (gate !== null) {
        await gate.acquire();
      }

      // Get texture data - early return on failure
      let textureDataResult: TextureData | null;
      try {
        textureDataResult = await texture.getTextureData().catch((err) => {
          console.error(err);
          texture.setState(
            'failed',
            new TextureError(TextureErrorCode.TEXTURE_DATA_NULL),
          );
          return null;
        });
      } finally {
        if (gate !== null) {
          gate.release();
        }
      }

      // Early return if texture data fetch failed
      if (textureDataResult === null || texture.state === 'failed') {
        return;
      }

      // Handle non-image textures: upload immediately
      if (isImage === false || (localPixels && this.renderer.mode === 'canvas')) {
        // `uploadTexture` records failure on the texture's state rather than
        // throwing, so there is nothing to catch here.
        this.uploadTexture(texture);
        return;
      }

      // Queue image textures for throttled upload
      this.enqueueUploadTexture(texture);
    } finally {
      this.pendingLoads--;
    }
  }

  /**
   * Upload a texture to the GPU.
   *
   * @remarks
   * Synchronous: the underlying `CoreContextTexture.load` is straight-line GL /
   * canvas work. Failure is recorded on the texture's state rather than thrown,
   * so a bad texture cannot unwind the frame that is draining the queue.
   *
   * @param texture Texture to upload
   * @returns `true` when an upload actually ran, `false` when the texture was
   *   skipped (dead, already loaded, data missing, or memory-critical).
   */
  uploadTexture(texture: Texture): boolean {
    if (
      this.stage.txMemManager.doNotExceedCriticalThreshold === true &&
      this.stage.txMemManager.criticalCleanupRequested === true
    ) {
      // we're at a critical memory threshold, don't upload textures
      texture.setState(
        'failed',
        new TextureError(TextureErrorCode.MEMORY_THRESHOLD_EXCEEDED),
      );
      return false;
    }

    if (texture.state === 'failed' || texture.state === 'freed') {
      // don't upload failed or freed textures
      return false;
    }

    if (texture.state === 'loaded') {
      // already loaded
      return false;
    }

    if (texture.textureData === null) {
      texture.setState(
        'failed',
        new TextureError(
          TextureErrorCode.TEXTURE_DATA_NULL,
          'Texture data is null, cannot upload texture',
        ),
      );
      return false;
    }

    const coreContext = texture.loadCtxTexture();
    if (coreContext.state === 'loaded') {
      texture.setState('loaded');
      return false;
    }

    coreContext.load();
    return true;
  }

  /**
   * Check if a texture is being processed
   */
  isProcessingTexture(texture: Texture): boolean {
    return this.uploadTextureQueue.has(texture);
  }

  /**
   * Upload a single queued texture to the GPU.
   *
   * @remarks
   * Used while animations are running so uploads don't steal time from the
   * animation. If the dequeued texture already died (failed/freed), nothing is
   * uploaded this frame and the next call handles the following one.
   *
   * @returns Number of textures uploaded synchronously: `1`, or `0` when the
   *   queue was empty or the dequeued texture was skipped. Feeds the
   *   `uploadedTextures` telemetry counter in `Stage.drawFrame`.
   */
  processOne(): number {
    if (this.initialized === false) {
      return 0;
    }

    const texture = this.uploadTextureQueue.shift();
    if (texture === undefined) {
      return 0;
    }

    return this.uploadQueued(texture);
  }

  /**
   * Upload queued textures to the GPU until the per-frame time budget runs out.
   *
   * @remarks
   * Called once per frame when idle. Textures are uploaded one-by-one; after
   * each, the elapsed time is rechecked and processing stops once it exceeds
   * `maxProcessingTime`, leaving the rest queued for the next frame.
   *
   * In normal operation a queued texture's data is already decoded
   * (`loadTexture` awaits `getTextureData` before enqueuing), so this budgets
   * GPU upload time. Pass `Infinity` to drain the whole queue.
   *
   * The loop is synchronous, which is what makes the budget mean anything: the
   * clock now advances only across uploads. Note the check still happens before
   * an upload rather than after, so a single texture can overshoot the budget
   * by its own cost; the bound is `maxProcessingTime` plus one upload.
   *
   * GRANULARITY: the budget is only as fine as the platform clock, which is
   * coarser than it looks. `performance.now()` measured a full 1ms on the
   * reference TV, so the comparison below can only resolve whole milliseconds
   * and the effective budget carries about +-1ms of slack (roughly 10% of the
   * 10ms default, and why a much smaller limit is not worth setting: at 4ms it
   * was 25%). The per-iteration clock read itself is not a concern at ~980ns
   * against a mean `texImage2D` cost of ~2.17ms on the same device, about
   * 0.05% of the work it paces.
   *
   * @param maxProcessingTime - The time budget for this frame, in milliseconds
   * @returns Number of textures uploaded synchronously before the budget ran
   *   out. Feeds the `uploadedTextures` telemetry counter in
   *   `Stage.drawFrame`.
   */
  processUntil(maxProcessingTime: number): number {
    if (this.initialized === false) {
      return 0;
    }

    const platform = this.platform;
    const startTime = platform.getTimeStamp();
    let uploaded = 0;

    while (platform.getTimeStamp() - startTime < maxProcessingTime) {
      const texture = this.uploadTextureQueue.shift();
      if (texture === undefined) {
        // Queue drained.
        break;
      }

      uploaded += this.uploadQueued(texture);
    }

    return uploaded;
  }

  /**
   * Upload a single already-dequeued texture.
   *
   * @remarks
   * Shared by {@link processOne} and {@link processUntil}. Dead (failed/freed)
   * textures and upload failures are skipped without throwing, so one bad
   * texture never stalls the queue or the frame draining it.
   *
   * @returns `1` when a synchronous upload ran, `0` for every skip — including
   *   the refetch hand-off, whose upload lands off the frame path and so must
   *   not be attributed to this frame's telemetry.
   */
  private uploadQueued(texture: Texture): number {
    if (this.isTextureDead(texture)) {
      return 0;
    }

    // Normal path: `loadTexture` awaited `getTextureData` before enqueuing, so
    // the bytes are already in hand and the upload is straight-line GL work
    // that belongs inside the caller's frame budget. `uploadTexture` records
    // failure on the texture's state rather than throwing (the same contract
    // `loadTexture` relies on), so there is nothing to catch here.
    if (texture.textureData !== null) {
      return this.uploadTexture(texture) === true ? 1 : 0;
    }

    // Rare: the data went missing between enqueue and dequeue (a memory
    // cleanup can free it). Re-fetching is genuinely async so it cannot ride
    // the synchronous drain; hand it off and upload when it resolves.
    this.refetchAndUpload(texture);
    return 0;
  }

  /**
   * Recover a queued texture whose data was freed before it reached the front
   * of the queue, then upload it off the frame path.
   */
  private refetchAndUpload(texture: Texture): void {
    // The refetch is real async work, so it must be visible to
    // hasPendingLoads() (the settle signal for "has everything arrived?")
    // and bounded by the same decode gate as loadTexture. Without both, the
    // pre-init drain fires every first-screen fetch/decode at once while the
    // manager reports idle.
    this.pendingLoads++;
    const gate = texture.type === TextureType.image ? this.decodeGate : null;
    const fetched =
      gate !== null
        ? gate.acquire().then(() => texture.getTextureData())
        : texture.getTextureData();
    fetched
      .then(() => {
        if (this.isTextureDead(texture) || texture.textureData === null) {
          return;
        }
        this.uploadTexture(texture);
      })
      .catch((error) => {
        console.error('Failed to upload texture:', error);
      })
      .then(() => {
        // Runs on both outcomes; `.finally` is newer than the browser floor.
        if (gate !== null) {
          gate.release();
        }
        this.pendingLoads--;
      });
  }

  /**
   * A texture is "dead" once it has failed or been freed — both terminal for
   * the upload pipeline.
   *
   * @remarks
   * Kept as a method rather than an inline check so TypeScript doesn't
   * permanently narrow `state` after the first comparison: the property is
   * mutable and can transition across the awaits in {@link uploadQueued}.
   */
  private isTextureDead(texture: Texture): boolean {
    return texture.state === 'failed' || texture.state === 'freed';
  }

  public hasUpdates(): boolean {
    return this.uploadTextureQueue.size > 0;
  }

  /**
   * Textures currently waiting in the upload queue.
   *
   * @remarks
   * Read by `Stage.drawFrame` before each drain so telemetry can report the
   * queue's high-water mark per interval: a growing depth means arrivals are
   * outpacing the per-frame upload budget, so queued images appear late.
   */
  public get uploadQueueSize(): number {
    return this.uploadTextureQueue.size;
  }

  /**
   * `true` while any texture is mid fetch/decode.
   *
   * Read-only signal for callers that need "has everything arrived?", which
   * `hasUpdates()` cannot answer: a downloading texture sits in no queue, so
   * the stage can report idle with images still in flight. Used by the visual
   * regression harness to settle before capturing a frame.
   */
  public hasPendingLoads(): boolean {
    return this.pendingLoads > 0;
  }

  /**
   * Initialize a texture to the cache
   *
   * @param texture Texture to cache
   * @param cacheKey Cache key for the texture
   */
  initTextureToCache(texture: Texture, cacheKey: string) {
    this.keyCache.set(cacheKey, texture);
    texture.cacheKey = cacheKey;
  }

  /**
   * Get a texture from the cache
   *
   * @param cacheKey
   */
  getTextureFromCache(cacheKey: string): Texture | undefined {
    return this.keyCache.get(cacheKey);
  }

  /**
   * Remove a texture from the cache
   *
   * @remarks
   * Called by Texture Cleanup when a texture is freed.
   *
   * @param texture
   */
  removeTextureFromCache(texture: Texture) {
    const cacheKey = texture.cacheKey;
    if (cacheKey !== null) {
      this.keyCache.delete(cacheKey);
      texture.cacheKey = null;
    }
  }

  /**
   * Remove texture from the upload queue
   *
   * @param texture - The texture to remove
   */
  removeTextureFromQueue(texture: Texture): void {
    this.uploadTextureQueue.delete(texture);
  }

  /**
   * Resolve a parent texture from the cache or fallback to the provided texture.
   *
   * @param texture - The provided texture to resolve.
   * @returns The cached or provided texture.
   */
  resolveParentTexture(texture: ImageTexture): Texture {
    if (!texture?.props) {
      return texture;
    }

    const cacheKey = ImageTexture.makeCacheKey(texture.props);
    const cachedTexture = cacheKey
      ? this.getTextureFromCache(cacheKey)
      : undefined;
    return cachedTexture ?? texture;
  }
}
