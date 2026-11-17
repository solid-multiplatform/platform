import { ImageWorkerManager } from './lib/ImageWorker.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import { ColorTexture } from './textures/ColorTexture.js';
import { ImageTexture } from './textures/ImageTexture.js';
import { NoiseTexture } from './textures/NoiseTexture.js';
import { SubTexture } from './textures/SubTexture.js';
import { Texture } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';
import type { Stage } from './Stage.js';
import type { Platform } from './platforms/Platform.js';
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
export type ExtractProps<Type> = Type extends {
    z$__type__Props: infer Props;
} ? Props : never;
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
    premultiplyAlphaHonored: boolean | 'auto';
    maxRetryCount: number;
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
export type ResizeModeOptions = {
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
} | {
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
export declare class ConcurrencyGate {
    private readonly limit;
    private inFlight;
    private readonly waiters;
    constructor(limit: number);
    acquire(): Promise<void>;
    release(): void;
}
export declare class CoreTextureManager extends EventEmitter {
    /**
     * Map of textures by cache key
     */
    keyCache: Map<string, Texture>;
    /**
     * Map of texture constructors by their type name
     */
    txConstructors: Partial<TextureMap>;
    maxRetryCount: number;
    private uploadTextureQueue;
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
    private pendingLoads;
    private initialized;
    private stage;
    private numImageWorkers;
    private imageDecodeConcurrency;
    /**
     * Caps concurrent main-thread fetch+decode. Non-null only when there is no
     * image worker manager: the worker path posts every request straight through
     * without queueing, so it has no concurrency bound to interact with.
     * Assigned in {@link initialize} once worker availability is known.
     */
    private decodeGate;
    platform: Platform;
    get pixelRatio(): number;
    imageWorkerManager: ImageWorkerManager | null;
    hasCreateImageBitmap: boolean;
    imageBitmapSupported: {
        basic: boolean;
        options: boolean;
        full: boolean;
        premultiplyHonored: boolean | null;
    };
    hasWorker: boolean;
    /**
     * Renderer that this texture manager is associated with
     *
     * @remarks
     * This MUST be set before the texture manager is used. Otherwise errors
     * will occur when using the texture manager.
     */
    renderer: CoreRenderer;
    constructor(stage: Stage, settings: TextureManagerSettings);
    /**
     * Decode images on the main thread: drop the worker manager and bound how
     * many decodes run at once (see `decodeGate`). Used when no worker is
     * available at init, and when the worker later fails to spawn (e.g. a CSP
     * that forbids blob workers).
     */
    private useMainThreadDecode;
    registerTextureType<Type extends keyof TextureMap>(textureType: Type, textureClass: TextureMap[Type]): void;
    /**
     * Resolve `premultiplyHonored` on the support object, then initialize.
     *
     * - boolean override -> use it directly, skip the probe
     * - 'auto' -> run the detection probe (only meaningful when the options/full
     *   API exists, since that's the only path that passes the premultiply option)
     */
    private resolvePremultiplyAndInit;
    private initialize;
    /**
     * Enqueue a texture for uploading to the GPU.
     *
     * @param texture - The texture to upload
     */
    enqueueUploadTexture(texture: Texture): void;
    /**
     * Create a texture
     *
     * @param textureType - The type of texture to create
     * @param props - The properties to use for the texture
     */
    createTexture<Type extends keyof TextureMap>(textureType: Type, props: ExtractProps<TextureMap[Type]>): InstanceType<TextureMap[Type]>;
    /**
     * Override loadTexture to use the batched approach.
     *
     * @param texture - The texture to load
     */
    loadTexture(texture: Texture): Promise<void>;
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
    uploadTexture(texture: Texture): boolean;
    /**
     * Check if a texture is being processed
     */
    isProcessingTexture(texture: Texture): boolean;
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
    processOne(): number;
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
    processUntil(maxProcessingTime: number): number;
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
    private uploadQueued;
    /**
     * Recover a queued texture whose data was freed before it reached the front
     * of the queue, then upload it off the frame path.
     */
    private refetchAndUpload;
    /**
     * A texture is "dead" once it has failed or been freed — both terminal for
     * the upload pipeline.
     *
     * @remarks
     * Kept as a method rather than an inline check so TypeScript doesn't
     * permanently narrow `state` after the first comparison: the property is
     * mutable and can transition across the awaits in {@link uploadQueued}.
     */
    private isTextureDead;
    hasUpdates(): boolean;
    /**
     * Textures currently waiting in the upload queue.
     *
     * @remarks
     * Read by `Stage.drawFrame` before each drain so telemetry can report the
     * queue's high-water mark per interval: a growing depth means arrivals are
     * outpacing the per-frame upload budget, so queued images appear late.
     */
    get uploadQueueSize(): number;
    /**
     * `true` while any texture is mid fetch/decode.
     *
     * Read-only signal for callers that need "has everything arrived?", which
     * `hasUpdates()` cannot answer: a downloading texture sits in no queue, so
     * the stage can report idle with images still in flight. Used by the visual
     * regression harness to settle before capturing a frame.
     */
    hasPendingLoads(): boolean;
    /**
     * Initialize a texture to the cache
     *
     * @param texture Texture to cache
     * @param cacheKey Cache key for the texture
     */
    initTextureToCache(texture: Texture, cacheKey: string): void;
    /**
     * Get a texture from the cache
     *
     * @param cacheKey
     */
    getTextureFromCache(cacheKey: string): Texture | undefined;
    /**
     * Remove a texture from the cache
     *
     * @remarks
     * Called by Texture Cleanup when a texture is freed.
     *
     * @param texture
     */
    removeTextureFromCache(texture: Texture): void;
    /**
     * Remove texture from the upload queue
     *
     * @param texture - The texture to remove
     */
    removeTextureFromQueue(texture: Texture): void;
    /**
     * Resolve a parent texture from the cache or fallback to the provided texture.
     *
     * @param texture - The provided texture to resolve.
     * @returns The cached or provided texture.
     */
    resolveParentTexture(texture: ImageTexture): Texture;
}
