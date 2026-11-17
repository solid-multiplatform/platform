import type { ExtractProps, TextureMap } from '../core/CoreTextureManager.js';
import { EventEmitter } from '../common/EventEmitter.js';
import { Stage, type StageOptions } from '../core/Stage.js';
import { CoreNode, type CoreNodeProps } from '../core/CoreNode.js';
import { type CoreTextNodeProps } from '../core/CoreTextNode.js';
import type { INode, INodeProps, ITextNode, ITextNodeProps } from './INode.js';
import type { TextureMemoryManagerSettings } from '../core/TextureMemoryManager.js';
import type { TextBaselineMode, TextRenderer } from '../core/text-rendering/TextRenderer.js';
import type { CanvasRenderer } from '../core/renderers/canvas/CanvasRenderer.js';
import type { WebGlRenderer } from '../core/renderers/webgl/WebGlRenderer.js';
import type { Inspector, InspectorOptions } from './Inspector.js';
import type { CoreShaderNode } from '../core/renderers/CoreShaderNode.js';
import type { RendererCapabilities } from '../core/renderers/CoreRenderer.js';
import type { ExtractShaderProps, OptionalShaderProps, ShaderMap } from '../core/CoreShaderManager.js';
import { Platform } from '../core/platforms/Platform.js';
import { type BoundsMargin, type FpsUpdatePayload } from '../common/CommonTypes.js';
/**
 * FPS Update Event Data
 *
 * @category Events
 * @remarks
 * An alias of {@link FpsUpdatePayload}, which is the shape the Stage actually
 * emits. The two names describe one runtime object, so this is a single type
 * rather than a copy that can drift out of it; see {@link FpsUpdatePayload}
 * for the per-field documentation.
 *
 * @example
 * ```typescript
 * renderer.on('fpsUpdate', (_target, data) => {
 *   console.log(`${data.fps} fps, ${data.renderOps} draw calls`);
 *   // Pair `sampledFrames` with `renderedMs`, never `renderedFrames`.
 *   console.log(`${data.sampledFrames / (data.renderedMs / 1000)} fps, recomputed`);
 *   // Backend and device limits are constant for the renderer's lifetime, so
 *   // read them once at startup with `renderer.getCapabilities()` rather than
 *   // expecting them in this payload.
 *   if (data.contextSpyData !== null) {
 *     console.log('WebGL calls:', data.contextSpyData);
 *   }
 * });
 * ```
 */
export type RendererMainFpsUpdateEvent = FpsUpdatePayload;
/**
 * Frame Tick Event Data
 *
 * @category Events
 * @example
 * ```typescript
 * renderer.on('frameTick', (_target, data) => {
 *   console.log(`Frame time: ${data.time}ms, delta: ${data.delta}ms`);
 * });
 * ```
 */
export interface RendererMainFrameTickEvent {
    /**
     * Monotonic timestamp of the current frame, in milliseconds.
     *
     * @remarks
     * Sourced from `performance.now()`, so it is measured from page load and is
     * NOT a Unix epoch timestamp: never pass it to `new Date()`. In exchange it
     * is monotonic, which `Date.now()` is not. It is not necessarily finer
     * grained: the clamp is 100us in Chrome but a measured 1ms on the reference
     * TV, so do not assume sub-millisecond resolution on device.
     */
    time: number;
    /** Time delta since the previous frame, in milliseconds. */
    delta: number;
}
/**
 * Render Update Event Data
 *
 * @category Events
 * @example
 * ```typescript
 * renderer.on('renderUpdate', (_target, data) => {
 *   console.log(`Rendered quads: ${data.quads}, renderOps: ${data.renderOps}`);
 * });
 * ```
 */
export interface RendererMainRenderUpdateEvent {
    /** Number of rendered quads */
    quads: number;
    /** Number of render operations */
    renderOps: number;
}
/**
 * Idle Event Data
 *
 * @category Events
 * @remarks
 * This event is emitted when the renderer has no scene updates to process.
 * The event has no payload - use this for performance optimizations during idle periods.
 *
 * @example
 * ```typescript
 * renderer.on('idle', () => {
 *   // Renderer is idle - perfect time for cleanup, analytics, etc.
 *   console.log('Renderer is idle - no scene changes');
 *
 *   // Example: Perform background tasks
 *   performBackgroundCleanup();
 *   sendAnalytics();
 * });
 * ```
 */
export interface RendererMainIdleEvent {
    /** This event has no payload - listen without parameters */
    readonly __eventHasNoPayload?: never;
}
/**
 * Critical Cleanup Event Data
 *
 * @category Events
 * @example
 * ```typescript
 * renderer.on('criticalCleanup', (_target, data) => {
 *   console.log(`Memory cleanup triggered!`);
 *   console.log(`Memory used: ${data.memUsed} bytes`);
 *   console.log(`Critical threshold: ${data.criticalThreshold} bytes`);
 * });
 * ```
 */
export interface RendererMainCriticalCleanupEvent {
    /** Memory used before cleanup (bytes) */
    memUsed: number;
    /** Critical threshold (bytes) */
    criticalThreshold: number;
}
/**
 * Critical Cleanup Failed Event Data
 *
 * @category Events
 * @example
 * ```typescript
 * renderer.on('criticalCleanupFailed', (_target, data) => {
 *   console.warn(`Memory cleanup failed!`);
 *   console.log(`Memory still used: ${data.memUsed} bytes`);
 *   console.log(`Critical threshold: ${data.criticalThreshold} bytes`);
 *   // Consider reducing texture usage or forcing cleanup
 * });
 * ```
 */
export interface RendererMainCriticalCleanupFailedEvent {
    /** Memory used after cleanup (bytes) */
    memUsed: number;
    /** Critical threshold (bytes) */
    criticalThreshold: number;
}
/**
 * WebGL Context Lost Event Data
 *
 * @remarks
 * Fired when the underlying WebGL context is lost (e.g. on low-RAM devices
 * running Chromium 123+ after the app has been backgrounded). The render loop
 * stops; in-engine GL resources are NOT rebuilt, so the supported handling is
 * to reload the app.
 *
 * @category Events
 * @example
 * ```typescript
 * renderer.on('contextLost', () => {
 *   window.location.reload();
 * });
 * ```
 */
export interface RendererMainContextLostEvent {
    /** This event has no payload - listen without parameters */
    readonly __eventHasNoPayload?: never;
}
/**
 * GPU Out Of Memory Event Data
 *
 * @remarks
 * Fired when the renderer detects a real `GL_OUT_OF_MEMORY` from the GPU (probed
 * once per frame). This is the only certain signal that the texture memory
 * estimate has overshot the device's real VRAM budget. At this point a texture
 * upload has already failed and the driver may soon drop the WebGL context, so
 * the supported recovery is for the application to reload with a lower
 * `criticalThreshold`.
 *
 * `memUsed` is the estimated texture memory in use at the moment of the failure.
 * Because the upload failed, the real GPU budget is at or below this value — so
 * it is a good basis for the next `criticalThreshold`.
 *
 * The renderer deliberately does NOT persist, reload, or change the threshold
 * itself — that is application policy. The recommended integration is to lower
 * the threshold, persist it, and reload:
 *
 * @category Events
 * @example
 * ```typescript
 * // --- on startup: read the calibrated threshold before creating the renderer
 * //
 * // Namespace the storage key per app. On TV devices that run from the
 * // filesystem (file://) the origin is null/opaque, so a bare key can collide
 * // across apps — including the path keeps each app's calibration separate.
 * const STORAGE_KEY = `myapp:criticalThreshold:${location.pathname}`;
 *
 * // Never let calibration drive the threshold so low the UX breaks. Pick a
 * // floor that matches your app (here, 70% of the default budget).
 * const DEFAULT_CRITICAL = 200e6;
 * const MIN_THRESHOLD = Math.round(DEFAULT_CRITICAL * 0.7);
 *
 * function readCriticalThreshold(): number {
 *   const raw =
 *     typeof localStorage !== 'undefined'
 *       ? localStorage.getItem(STORAGE_KEY)
 *       : null;
 *   const stored = raw !== null ? parseInt(raw, 10) : NaN;
 *   if (Number.isNaN(stored) === false && stored > 0) {
 *     return Math.max(stored, MIN_THRESHOLD);
 *   }
 *   return DEFAULT_CRITICAL;
 * }
 *
 * const renderer = new RendererMain(
 *   { textureMemory: { criticalThreshold: readCriticalThreshold() } },
 *   'app',
 * );
 *
 * // --- at runtime: react to a real GPU out-of-memory
 * let handlingOOM = false;
 * renderer.on('outOfMemory', (_target, { memUsed, criticalThreshold }) => {
 *   if (handlingOOM === true) {
 *     return; // debounce — several uploads can fail in the same burst
 *   }
 *   handlingOOM = true;
 *
 *   // The OOM proves the real budget is <= memUsed. Drop to 90% of the lower
 *   // of (estimate, current threshold), but never below the floor.
 *   const ceiling = Math.min(memUsed, criticalThreshold);
 *   const next = Math.max(Math.round(ceiling * 0.9), MIN_THRESHOLD);
 *
 *   try {
 *     localStorage.setItem(STORAGE_KEY, String(next));
 *   } catch (e) {
 *     // storage may be blocked (e.g. file:// with storage disabled); the new
 *     // value just won't survive the reload.
 *   }
 *
 *   // Reload so the renderer reinitializes with the lower budget. The engine
 *   // does not rebuild GPU resources in place, so reload is the clean recovery.
 *   location.reload();
 * });
 * ```
 */
export interface RendererMainOutOfMemoryEvent {
    /** Estimated texture memory in use at the time of the failure (bytes) */
    memUsed: number;
    /** Critical threshold in effect at the time of the failure (bytes) */
    criticalThreshold: number;
}
/**
 * Settings for the Renderer that can be updated during runtime.
 */
export interface RendererRuntimeSettings {
    /**
     * Texture Memory Manager Settings
     */
    textureMemory: Partial<TextureMemoryManagerSettings>;
    /**
     * Texture preload runway, in logical pixels, around every Node's visible
     * region.
     *
     * @remarks
     * A Node's visible region is the viewport, narrowed by any clipping
     * ancestor. Nodes outside that region but within this margin of it keep
     * updating and load their textures, yet stay out of the render list — no
     * quad writes, texture binds, or draw calls for content the GPU would clip
     * anyway. Raise it to decode further ahead of a scroll, lower it to hold
     * less texture memory.
     *
     * Accepts a single value applied to every side, or a per-side
     * `[top, right, bottom, left]` tuple.
     *
     * @defaultValue `200`
     */
    boundsMargin: number | BoundsMargin;
    /**
     * RGBA encoded number of the background to use
     *
     * @defaultValue `0x00000000`
     */
    clearColor: number;
    /**
     * Interval in milliseconds to receive FPS updates
     *
     * @remarks
     * If set to `0`, FPS updates will be disabled.
     *
     * This is the only switch for FPS sampling: it is honoured in production
     * builds as well as development ones, so field telemetry needs nothing but a
     * non-zero value here. Rendered frames and the ~15ms idle polls are
     * accumulated apart — `fps` covers rendering time only, so a mostly static
     * scene reports the rate it sustained while actually drawing, with the
     * polls counted separately as `idleTicks`.
     *
     * @defaultValue `0` (disabled)
     */
    fpsUpdateInterval: number;
    /**
     * DOM Inspector
     *
     * @remarks
     * The inspector will replicate the state of the Nodes created
     * in the renderer and allow inspection of the state of the nodes.
     *
     */
    inspector: typeof Inspector | false;
    /**
     * Inspector Options
     *
     * @remarks
     * Configuration options for the Inspector's performance monitoring features.
     * Only used when inspector is enabled.
     */
    inspectorOptions?: Partial<InspectorOptions>;
    /**
     * Texture Processing Limit (in milliseconds)
     *
     * @remarks
     * The maximum amount of time the renderer is allowed to process textures in a
     * single frame. If the processing time exceeds this limit, the renderer will
     * skip processing the remaining textures and continue rendering the frame.
     *
     * @defaultValue `10`
     */
    textureProcessingTimeLimit: number;
    /**
     * Frame-rate cap for the global render loop
     *
     * @remarks
     * Caps the frame rate of the entire rendering system. The loop never draws
     * faster than this; it already draws slower whenever the scene is idle or
     * the device cannot keep up, so the cap costs nothing when under it.
     *
     * When set to 0, no cap is applied and the loop draws on every
     * `requestAnimationFrame` the browser fires. That is NOT the same as the
     * display refresh rate: when the GPU falls behind, browsers issue catch-up
     * callbacks faster than vsync and every one of them is drawn — measured at
     * ~140fps on a 60Hz TV panel, where the wasted draws deepen the very GPU
     * stall that triggered them. Set 0 only for panels faster than 60Hz or to
     * benchmark raw throughput.
     *
     * @defaultValue `60`
     */
    targetFPS: number;
}
/**
 * Configuration settings for {@link RendererMain}
 */
export type RendererMainSettings = RendererRuntimeSettings & {
    /**
     * Authored logical pixel width of the application
     *
     * @defaultValue `1920`
     */
    appWidth: number;
    /**
     * Authored logical pixel height of the application
     *
     * @defaultValue `1080`
     */
    appHeight: number;
    /**
     * Factor to convert app-authored logical coorindates to device logical coordinates
     *
     * @remarks
     * This value allows auto-scaling to support larger/small resolutions than the
     * app was authored for.
     *
     * If the app was authored for 1920x1080 and this value is 2, the app's canvas
     * will be rendered at 3840x2160 logical pixels.
     *
     * Likewise, if the app was authored for 1920x1080 and this value is 0.66667,
     * the app's canvas will be rendered at 1280x720 logical pixels.
     *
     * @defaultValue `1`
     */
    deviceLogicalPixelRatio: number;
    /**
     * Factor to convert device logical coordinates to device physical coordinates
     *
     * @remarks
     * This value allows auto-scaling to support devices with different pixel densities.
     *
     * This controls the number of physical pixels that are used to render each logical
     * pixel. For example, if the device has a pixel density of 2, each logical pixel
     * will be rendered using 2x2 physical pixels.
     *
     * By default, it will be set to `window.devicePixelRatio` which is the pixel
     * density of the device the app is running on reported by the browser.
     *
     * @defaultValue `window.devicePixelRatio`
     */
    devicePhysicalPixelRatio: number;
    /**
     * Maximum number of entries kept in the SDF text layout cache
     *
     * @remarks
     * The SDF text renderer caches the computed glyph layout for a given
     * `text` + font + layout-prop combination so that identical strings (e.g.
     * repeated badges/labels) are not re-laid-out. The cache is content-keyed
     * and shared across nodes, and is trimmed down to this many (most recently
     * used) entries whenever the stage goes idle.
     *
     * Set this higher for content-dense UIs with many simultaneous unique
     * strings, or lower to cap memory more aggressively.
     *
     * @defaultValue `250`
     */
    textLayoutCacheSize: number;
    /**
     * Include context call (i.e. WebGL) information in FPS updates
     *
     * @remarks
     * When enabled the number of calls to each context method over the
     * `fpsUpdateInterval` will be included in the FPS update payload's
     * `contextSpyData` property.
     *
     * Enabling the context spy has a serious impact on performance so only use it
     * when you need to extract context call information.
     *
     * @defaultValue `false` (disabled)
     */
    enableContextSpy: boolean;
    /**
     * Whether to offload image loading to a worker
     *
     * @remarks
     * Effectively a toggle: `0` disables image workers, any value above `0`
     * enables exactly one. Values greater than 1 are accepted and clamped rather
     * than rejected, so existing configs keep working.
     *
     * There is no pool because the worker never blocks. Every path in it is
     * `xhr.send()` followed by `createImageBitmap(...).then(...)`, and the decode
     * itself runs in the browser's decode pool regardless of which thread asked
     * for it - a traced session left a pool of four 99.7% idle (46ms of combined
     * busy time over 15s). Nothing queues behind the worker either, so a second
     * one would raise neither throughput nor the number of images in flight,
     * while costing an isolate and a thread that matter on a TV SoC.
     *
     * With `0`, fetch+decode runs on the main thread under
     * {@link imageDecodeConcurrency}.
     *
     * @defaultValue `1`
     */
    numImageWorkers: number;
    /**
     * Maximum number of image fetch+decode operations allowed to run at once
     * when image workers are unavailable
     *
     * @remarks
     * Only applies when there is no image worker manager (i.e.
     * `numImageWorkers === 0`, or workers/`createImageBitmap` are unsupported).
     * In that mode every image decode runs on the main thread, so a burst — such
     * as a scroll that makes many image nodes renderable in a single tick — can
     * fire dozens of decodes back-to-back and starve the render loop. This caps
     * how many run concurrently. Only image textures are gated; colour and noise
     * textures generate their bytes synchronously and never queue behind a
     * decode.
     *
     * Has no effect when image workers are active: that path does not gate
     * concurrency at all (requests are posted straight through, never queued
     * behind a worker), so the cap simply does not apply there. Set to `0` to
     * disable the cap (unbounded).
     *
     * @defaultValue `4`
     */
    imageDecodeConcurrency: number;
    /**
     * Renderer Engine
     *
     * @remarks
     * The renderer engine to use. Spawns a WebGL or Canvas renderer.
     * WebGL is more performant and supports more features. Canvas is
     * supported on most platforms.
     *
     * Note: When using CanvasCoreRenderer you can only use
     * CanvasTextRenderer. The WebGLCoreRenderer supports
     * both CanvasTextRenderer and SdfTextRenderer for Text Rendering.
     *
     */
    renderEngine: typeof CanvasRenderer | typeof WebGlRenderer;
    /**
     * Quad buffer size in bytes
     *
     * @remarks
     * Holds 80 bytes (20 32-bit words) per renderable node. SDF text glyphs are
     * not stored here — they use their own vertex buffer.
     *
     * Values above the default are clamped by the WebGL renderer: element
     * indices are Uint16, so no vertex buffer can address more than 16384 quads
     * (16384 * 80 bytes = the default). Extra bytes could be written but never
     * drawn. Lowering it saves heap on constrained devices — measure the peak
     * with {@link RendererMain.getBufferInfo} and size to that plus headroom.
     *
     * @defaultValue 1310720 (16384 quads x 80 bytes = 1.25 MiB)
     */
    quadBufferSize: number;
    /**
     * Font Engines
     *
     * @remarks
     * The font engines to use for text rendering. CanvasTextRenderer is supported
     * on all platforms. SdfTextRenderer is a more performant renderer.
     * When using `renderEngine=CanvasCoreRenderer` you can only use `CanvasTextRenderer`.
     * The `renderEngine=WebGLCoreRenderer` supports both `CanvasTextRenderer` and `SdfTextRenderer`.
     *
     * This setting is used to enable tree shaking of unused font engines. Please
     * import your font engine(s) as follows:
     * ```
     * import { CanvasTextRenderer } from '@lightning/renderer/canvas';
     * import { SdfTextRenderer } from '@lightning/renderer/webgl';
     * ```
     *
     * If both CanvasTextRenderer and SdfTextRenderer are provided, the first renderer
     * provided will be asked first if it can render the font. If it cannot render the
     * font, the next renderer will be asked. If no renderer can render the font, the
     * text will not be rendered.
     *
     * **Note** that if you have fonts available in both engines the second font engine
     * will not be used. This is because the first font engine will always be asked first.
     *
     * @defaultValue '[]'
     *
     *
     */
    fontEngines: TextRenderer[];
    /**
     * Per-line vertical baseline anchor used by the text layout engine.
     *
     * @remarks
     * Picks which font-derived height is centered on each line's geometric
     * mid-line. This is engine-wide and intentionally not exposed per node —
     * mixing anchor models within one app produces visually inconsistent text.
     *
     * - `'optical'` (default): the mean of cap-height and x-height is centered.
     *   Reads visually centered for mixed-case UI text like "Button"; the
     *   sweet spot between `'cap'` (low for lowercase-heavy) and `'x'` (high
     *   for headings). Matches macOS/iOS control behavior.
     * - `'cap'`: capital letters and digits sit centered on the line. Use
     *   when content is mostly uppercase or numeric (timers, badges); mixed-
     *   case "Button" can read slightly low.
     * - `'x'`: lowercase x-height is centered. Better for running body text;
     *   capitals appear slightly high in headings.
     * - `'linebox'`: legacy mode. Centers the asc/lineGap/desc rectangle.
     *   Mathematically tidy but visually unbalanced because most Latin fonts
     *   have asymmetric asc/desc ratios.
     *
     * @defaultValue `'optical'`
     */
    textBaselineMode: TextBaselineMode;
    /**
     * Force WebGL2
     *
     * @remarks
     * Force the renderer to use WebGL2. This can be used to force the renderer to
     * use WebGL2 even if the browser supports WebGL1.
     *
     * @defaultValue `false`
     */
    forceWebGL2: boolean;
    /**
     * Disable Vertex Array Objects
     *
     * @remarks
     * By default the WebGL renderer caches each shader program's attribute layout
     * in a Vertex Array Object (native on WebGL2, or via the
     * `OES_vertex_array_object` extension on WebGL1) and binds it with a single
     * call per draw instead of re-pointing every attribute. Set this to `true` to
     * force the per-draw attribute-binding path instead.
     *
     * This is primarily a diagnostic/benchmarking switch — it lets you A/B the VAO
     * optimization on a target device. It has no effect on the Canvas renderer.
     *
     * @defaultValue `false`
     */
    disableVertexArrayObject: boolean;
    /**
     * WebGL power preference hint
     *
     * @remarks
     * Hint passed to the browser when creating the WebGL context.
     * On multi-GPU systems, `'high-performance'` selects the discrete GPU while
     * `'default'` lets the browser decide (typically integrated GPU to save power).
     *
     * @defaultValue `'default'`
     */
    powerPreference: WebGLPowerPreference;
    /**
     * Canvas object to use for rendering
     *
     * @remarks
     * This is used to render the scene graph. If not provided, a new canvas
     * element will be created and appended to the target element.
     */
    canvas: HTMLCanvasElement;
    /**
     * createImageBitmap support for the runtime
     *
     * @remarks
     * This is used to determine if and which version of the createImageBitmap API
     * is supported by the runtime. This is used to determine if the renderer can
     * use createImageBitmap to load images.
     *
     * Options supported
     * - Auto - Automatically determine the supported version
     * - Basic - Supports createImageBitmap(image)
     * - Options - Supports createImageBitmap(image, options)
     * - Full - Supports createImageBitmap(image, sx, sy, sw, sh, options)
     *
     * Note with auto detection, the renderer will attempt to use the most advanced
     * version of the API available. If the API is not available (e.g. Chrome < 50,
     * including the Chrome 38 support floor), the renderer falls back to loading
     * images via `new Image()`.
     *
     * `'auto'` runs a small startup probe (a 1x1 PNG) to determine support; this
     * adds a negligible one-time startup cost. Set an explicit value (`'full'`,
     * `'options'`, `'basic'`) to skip the probe ONLY when the target runtime is
     * known to support that level — forcing a level the runtime lacks will fail
     * to load images. When in doubt, use `'auto'`.
     *
     * @defaultValue `auto`
     */
    createImageBitmapSupport: 'auto' | 'basic' | 'options' | 'full';
    /**
     * Override for whether `createImageBitmap(..., { premultiplyAlpha: 'premultiply' })`
     * is actually honored by the target device.
     *
     * @remarks
     * Some older browsers (notably older Safari/WebKit) accept the
     * `premultiplyAlpha: 'premultiply'` option without throwing but silently
     * ignore it, returning straight (non-premultiplied) alpha. This causes edge
     * "ghosting" on images with transparency.
     *
     * Set to `'auto'` to detect via a cheap startup probe (one 1×1 PNG decode +
     * texture upload + framebuffer readback). On devices that honor the option —
     * the vast majority — the probe returns `true` and behavior is identical to
     * assuming it honored; only devices that actually ignore it (e.g. the
     * Movistar STB) switch to the WebGL-side premultiply fallback. Set to a
     * boolean to force the value (`false` forces the GL-premultiply fallback;
     * `true` skips it). Leave unset to assume the option is honored — the
     * default, which preserves existing behavior with no probe overhead.
     *
     * @defaultValue `true` (assume honored; no probe)
     */
    premultiplyAlphaHonored?: boolean | 'auto';
    /**
     * Provide an alternative platform abstraction layer
     *
     * @remarks
     * By default the Lightning 3 renderer will load a webplatform, assuming it runs
     * inside a web browsr. However for special cases there might be a need to provide
     * an abstracted platform layer to run on non-web or non-standard JS engines
     *
     * @defaultValue `null`
     */
    platform: typeof Platform | null;
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
    maxRetryCount?: number;
    /**
     * Render loop error handler — an escape hatch for `requestAnimationFrame` crashes
     *
     * @remarks
     * The render loop runs client-supplied code every frame: synchronous event
     * subscribers (`frameTick`, `idle`, `fpsUpdate`, etc.) and animation steps. If
     * any of these throw, the exception would otherwise propagate out of the
     * `requestAnimationFrame` callback and permanently stop the loop — freezing
     * the entire app until reload.
     *
     * The loop catches such errors and never lets them stop it. By default the
     * error is swallowed (the default handler is a no-op), so a single bad frame
     * can't freeze the app. Provide your own handler to log/report the crash (and
     * optionally recover); the loop still keeps running after it returns.
     *
     * @param error The error thrown during the frame
     *
     * @defaultValue a no-op (errors are swallowed; the loop keeps running)
     */
    handleLoopError?: (error: unknown) => void;
};
/**
 * The Renderer Main API
 *
 * @remarks
 * This is the primary class used to configure and operate the Renderer.
 *
 * It is used to create and destroy Nodes, as well as Texture and Shader
 * references.
 *
 * Example:
 * ```ts
 * import { RendererMain, MainCoreDriver } from '@lightningjs/renderer';
 *
 * // Initialize the Renderer
 * const renderer = new RendererMain(
 *   {
 *     appWidth: 1920,
 *     appHeight: 1080
 *   },
 *   'app',
 *   new MainCoreDriver(),
 * );
 * ```
 *
 * ## Event Handling
 *
 * Listen to events using the standard EventEmitter API:
 * ```typescript
 * renderer.on('fpsUpdate', (_target, data: RendererMainFpsUpdateEvent) => {
 *   console.log(`FPS: ${data.fps}`);
 * });
 *
 * renderer.on('idle', () => {
 *   // Renderer is idle - no scene changes
 * });
 * ```
 *
 * @see {@link RendererMainFpsUpdateEvent}
 * @see {@link RendererMainFrameTickEvent}
 * @see {@link RendererMainRenderUpdateEvent}
 * @see {@link RendererMainIdleEvent}
 * @see {@link RendererMainCriticalCleanupEvent}
 * @see {@link RendererMainCriticalCleanupFailedEvent}
 * @see {@link RendererMainContextLostEvent}
 * @see {@link RendererMainOutOfMemoryEvent}
 *
 * @fires RendererMain#fpsUpdate
 * @fires RendererMain#frameTick
 * @fires RendererMain#renderUpdate
 * @fires RendererMain#idle
 * @fires RendererMain#criticalCleanup
 * @fires RendererMain#criticalCleanupFailed
 * @fires RendererMain#contextLost
 * @fires RendererMain#outOfMemory
 */
export declare const resolveTargetFPS: (fps: number | undefined) => number;
export declare class RendererMain extends EventEmitter {
    readonly root: INode;
    readonly canvas: HTMLCanvasElement;
    readonly stage: Stage;
    private inspector;
    /**
     * Constructs a new Renderer instance
     *
     * @param settings Renderer settings
     * @param target Element ID or HTMLElement to insert the canvas into
     * @param driver Core Driver to use
     */
    constructor(settings: Partial<RendererMainSettings>, target?: string | HTMLElement);
    /**
     * Create a new scene graph node
     *
     * @remarks
     * A node is the main graphical building block of the Renderer scene graph. It
     * can be a container for other nodes, or it can be a leaf node that renders a
     * solid color, gradient, image, or specific texture, using a specific shader.
     *
     * To create a text node, see {@link createTextNode}.
     *
     * See {@link CoreNode} for more details.
     *
     * @param props
     * @returns
     */
    createNode<ShNode extends CoreShaderNode<any>>(props: Partial<INodeProps<ShNode>>, resolved?: boolean): INode<ShNode>;
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
     * Create a new scene graph text node
     *
     * @remarks
     * A text node is the second graphical building block of the Renderer scene
     * graph. It renders text using a specific text renderer that is automatically
     * chosen based on the font requested and what type of fonts are installed
     * into an app.
     *
     * See {@link ITextNode} for more details.
     *
     * @param props
     * @returns
     */
    createTextNode(props: Partial<ITextNodeProps>, resolved?: boolean): ITextNode;
    /**
     * Allocate a fully-resolved CoreTextNodeProps bag.  See
     * {@link createNodeProps}.
     */
    createTextNodeProps(initial?: Partial<CoreTextNodeProps>): CoreTextNodeProps;
    /**
     * Destroy a node
     *
     * @remarks
     * This method destroys a node
     *
     * @param node
     * @returns
     */
    destroyNode(node: INode): void;
    /**
     * Create a new texture reference
     *
     * @remarks
     * This method creates a new reference to a texture. The texture is not
     * loaded until it is used on a node.
     *
     * It can be assigned to a node's `texture` property, or it can be used
     * when creating a SubTexture.
     *
     * @param textureType
     * @param props
     * @param options
     * @returns
     */
    createTexture<TxType extends keyof TextureMap>(textureType: TxType, props: ExtractProps<TextureMap[TxType]>): InstanceType<TextureMap[TxType]>;
    /**
     * Create a new shader controller for a shader type
     *
     * @remarks
     * This method creates a new Shader Controller for a specific shader type.
     *
     * If the shader has not been loaded yet, it will be loaded. Otherwise, the
     * existing shader will be reused.
     *
     * It can be assigned to a Node's `shader` property.
     *
     * @param shaderType
     * @param props
     * @returns
     */
    createShader<ShType extends keyof ShaderMap>(shType: ShType, props?: OptionalShaderProps<ShType>): CoreShaderNode<NonNullable<ExtractShaderProps<ShType>>>;
    /**
     * Get a Node by its ID
     *
     * @param id
     * @returns
     */
    getNodeById(id: number): CoreNode | null;
    getBufferInfo(): import("../core/renderers/CoreRenderer.js").BufferInfo | null;
    /**
     * Report the active rendering backend and device capabilities.
     *
     * @remarks
     * Useful for diagnostics and field logging — e.g. confirming which WebGL
     * version a device negotiated and whether Vertex Array Objects engaged.
     * Reads live GL parameters (CPU↔GPU round-trips), so call once at startup
     * rather than per frame.
     *
     * @example
     * ```ts
     * console.table(renderer.getCapabilities());
     * ```
     */
    getCapabilities(): RendererCapabilities;
    /**
     * Label the `fpsUpdate` samples that follow.
     *
     * @remarks
     * Group telemetry by what the app was doing, e.g. `'home'`,
     * `'detail-scroll'`, `'player'`. Without it every sample is a blend of
     * whatever the session happened to be doing at the time, which makes
     * segment-level comparison impossible.
     *
     * Changing the label closes the sample in progress and emits it under the
     * OLD label, so no interval ever spans two segments. Call this on screen and
     * interaction changes, never per frame.
     *
     * @example
     * ```ts
     * router.on('enter', (screen) => renderer.setTelemetrySegment(screen.name));
     * ```
     */
    setTelemetrySegment(label: string): void;
    /**
     * Re-render the current frame without advancing any running animations.
     *
     * @remarks
     * Any state changes will be reflected in the re-rendered frame. Useful for
     * debugging.
     *
     * May not do anything if the render loop is running on a separate worker.
     */
    rerender(): void;
    /**
     * Stop the render loop so it schedules no frames, timers or idle polls.
     *
     * @remarks
     * Animations are never frozen mid-flight: while any animation is active the
     * loop keeps running, and it stops once the last one has finished and its
     * final frame is drawn. Poll {@link isPaused} to see whether it has stopped.
     *
     * With `immediate` the loop stops on its next tick before it draws
     * anything, animations included: they freeze where they are and carry on
     * after {@link resume}. For a host leaving the foreground, where a frame
     * drawn from the background gets the app killed on Apple platforms.
     *
     * While paused nothing is drawn, no texture uploads or idle cleanup run, and
     * `frameTick`, `idle` and `fpsUpdate` stop firing. Scene changes made while
     * paused appear on the first frame after {@link resume}.
     *
     * @example
     * ```ts
     * renderer.pause();
     * // later
     * renderer.resume();
     * ```
     */
    pause(options?: {
        immediate?: boolean;
    }): void;
    /**
     * Restart a paused render loop, or cancel a pause still waiting on
     * animations. Does nothing if the loop is running.
     */
    resume(): void;
    /**
     * `true` once the render loop has actually stopped after {@link pause}.
     * Stays `false` while a pause is waiting for animations to finish.
     */
    get isPaused(): boolean;
    /**
     * Cleanup textures that are not being used
     *
     * @param aggressive - If true, will cleanup all textures, regardless of render status
     *
     * @remarks
     * This can be used to free up GFX memory used by textures that are no longer
     * being displayed.
     *
     * This routine is also called automatically when the memory used by textures
     * exceeds the critical threshold on frame generation **OR** when the renderer
     * is idle and the memory used by textures exceeds the target threshold.
     *
     * **NOTE**: This is a heavy operation and should be used sparingly.
     * **NOTE2**: This will not cleanup textures that are currently being displayed.
     * **NOTE3**: This will not cleanup textures that are marked as `preventCleanup`.
     * **NOTE4**: This has nothing to do with the garbage collection of JavaScript.
     */
    cleanup(): void;
    /**
     * Sets the clear color for the stage.
     *
     * @param color - The color to set as the clear color.
     */
    setClearColor(color: number): void;
    /**
     * Set options for the renderer
     *
     * @param options
     */
    setOptions(options: Partial<RendererRuntimeSettings>): void;
    /**
     * Bring the Inspector in line with `stage.options`: destroy it when turned
     * off, and (re)create it when turned on, when its class changes, or when
     * its options change (it reads them only at construction).
     */
    private applyInspector;
    get settings(): Readonly<StageOptions>;
    /**
     * Gets the frame-rate cap for the global render loop
     *
     * @returns The current cap in frames per second (0 means uncapped)
     *
     * @remarks
     * This caps the frame rate of the entire rendering system. When 0, the
     * loop draws on every `requestAnimationFrame` the browser fires, which
     * can exceed the display refresh rate under GPU load. Defaults to 60.
     */
    get targetFPS(): number;
    /**
     * Sets the frame-rate cap for the global render loop
     *
     * @param fps - The cap in frames per second. Set to 0 or a negative value
     *              to remove the cap entirely.
     *
     * @remarks
     * This setting affects the entire rendering system immediately.
     * All animations, rendering, and frame updates will be capped at this
     * rate. Defaults to 60 — see {@link RendererRuntimeSettings.targetFPS}
     * for why an uncapped loop is unsafe on TV hardware.
     *
     * @example
     * ```typescript
     * // Cap at 30fps for better performance
     * renderer.targetFPS = 30;
     *
     * // Remove the cap (draw on every rAF; can exceed panel refresh rate)
     * renderer.targetFPS = 0;
     * ```
     */
    set targetFPS(fps: number);
}
