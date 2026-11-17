import { type MemoryInfo, type RendererCapabilities } from './common/types.js';
import { RendererCore } from './core/RendererCore.js';
import { GlBackend } from './core/gl/GlBackend.js';
import { type Platform } from './platform/Platform.js';
import { type RendererRuntimeSettings, type RendererSettings } from './settings.js';
/**
 * The renderer (spec 12.2), also exported as `RendererMain`: RendererCore
 * plus the canvas, the GL backend, the frame loop and the settings table.
 * Events: `idle` (the loop went idle), `frameTick` ({ time, delta } at the
 * start of every frame the loop runs, drawn or not), `contextLost`, the
 * telemetry's `fpsUpdate` and `renderUpdate` (while `fpsUpdateInterval` is
 * above 0), and the memory events `criticalCleanup`,
 * `criticalCleanupFailed` and `outOfMemory`.
 *
 * `idle` fires synchronously inside the animation-frame callback that drew
 * the last frame (1.10 fired it one vsync later, in a tick that drew
 * nothing), so heavy work in an `idle` listener delays that frame reaching
 * the screen.
 */
export declare class Renderer extends RendererCore {
    readonly settings: RendererSettings;
    readonly canvas: HTMLCanvasElement;
    readonly platform: Platform;
    /**
     * The GL backend: phases 3 to 5 upload textures and register programs here.
     *
     * @hidden
     */
    readonly backend: GlBackend;
    /** Starts texture loads (spec 9.3). */
    private readonly loader;
    /** Uploads decoded textures after the draw (spec 9.4). */
    private readonly uploader;
    private readonly memory;
    private readonly loop;
    /** Turns frame deltas into animation steps (animationSnapRate). */
    private readonly snapper;
    /** The renderer created the canvas (destroy detaches only that one). */
    private readonly ownsCanvas;
    /** destroy() ran: a frame still in progress must not touch the backend. */
    private destroyed;
    /**
     * A decode landed, or a run left uploads over: the next frame runs the
     * uploader, with no walk or draw unless something else asks for one (the
     * upload marks the nodes showing the texture, which draw it the frame
     * after).
     */
    private uploadRequested;
    /** platform.now() at construction: elapsedTime counts from it (1.10). */
    private readonly startTime;
    /** Frame telemetry, while fpsUpdateInterval is above 0; null otherwise. */
    private telemetry;
    /** The telemetry label (setTelemetrySegment), kept while it is off. */
    private segment;
    /** The DOM inspector, when the settings name one (and the build allows it). */
    private inspector;
    constructor(settings?: Partial<RendererSettings>, target?: string | HTMLElement);
    /** The frame-request funnel (RendererCore): every request schedules a frame. */
    protected onFrameRequest(): void;
    /** One frame (the loop calls it): animations, the scene walk, the draw. */
    private frame;
    /**
     * Bring the inspector in line with the settings (1.10): destroy it when
     * turned off, build it when turned on, when its class changes or when
     * its options change (it reads them only when built), and attach it.
     */
    private applyInspector;
    /**
     * Upload decoded textures within the frame's budget; timed for the
     * telemetry from `start` (a clock read the caller made) when there are
     * textures to upload, with one more read at the end (none otherwise).
     */
    private upload;
    /**
     * Bring the telemetry in line with fpsUpdateInterval: attach it above 0
     * (the first sample starts now, and closes on time even if no frame
     * comes; while paused, its timer starts with resume()), restart it on a
     * new interval (the sample in progress is discarded, as in 1.10) and
     * detach it at 0 (nothing is sampled).
     */
    private applyTelemetry;
    /**
     * Label the `fpsUpdate` samples that follow, e.g. `'home'` or
     * `'detail-scroll'` (1.10). The sample in progress closes under the old
     * label first, so no sample spans two segments; call it on screen and
     * interaction changes, never per frame. The label is kept while the
     * telemetry is off.
     */
    setTelemetrySegment(label: string): void;
    /**
     * Idle maintenance, at most once per idle period, from a timer queued on
     * going idle: the GL out-of-memory probe (drained here, never in the
     * frame loop: spec 12.1), texture memory cleanup, the trim of the
     * params blocks no node holds and of the text layout cache, and the
     * layouts of the text nodes no walk has visited yet (idleTextLayouts).
     */
    protected maintain(): void;
    /** Texture memory in use (1.10 txMemManager.getMemoryInfo). */
    memoryInfo(): MemoryInfo;
    /**
     * Free the textures nobody wants now, down to the target threshold (all
     * of them with `full`), and remove the ones nothing references (1.10
     * stage.cleanup). Their `freed` events are delivered before it returns
     * (called from a listener: with the next flush; inside a frame, from a
     * reprocessUpdates callback: with the frame's, after the draw).
     */
    cleanup(full?: boolean): void;
    /** 1.10 alias of requestRender. */
    rerender(): void;
    /** The backend and device limits; reads GL parameters, so call it once. */
    getCapabilities(): RendererCapabilities;
    /**
     * Change runtime settings (spec 13.2) through the constructor's
     * resolvers; each effect runs once, after every value is stored. After
     * destroy() it does nothing.
     */
    setOptions(options: Partial<RendererRuntimeSettings>): void;
    /**
     * Stop drawing once no animation is active (the frame an animation ends
     * on is drawn first); with `immediate`, stop at the next frame before
     * anything is drawn (a host leaving the foreground). Nothing is drawn
     * or sampled while paused: writes made meanwhile land on the first frame
     * after resume().
     */
    pause(options?: {
        immediate?: boolean;
    }): void;
    /** Restart a paused loop with a fresh frame, or cancel a pause still waiting on animations. */
    resume(): void;
    /** The loop has stopped after pause(); false while a pause waits on animations. */
    get isPaused(): boolean;
    /**
     * Stop the loop, destroy the scene, release the GL context and detach a
     * canvas the renderer created (spec 14, item 16). The context is lost
     * either way, so a canvas the app provided stays attached but cannot be
     * reused by a new Renderer: give that one a fresh canvas. A second call
     * does nothing.
     */
    destroy(): void;
}
