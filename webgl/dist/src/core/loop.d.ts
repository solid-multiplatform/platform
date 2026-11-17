import type { Platform } from '../platform/Platform.js';
/** What the loop asks of its owner (the Renderer). */
export interface LoopHost {
    /** A frame is needed: frameRequested, or an animation is active. */
    needsFrame(): boolean;
    /** An animation is active: a pause waits until none is. */
    animating(): boolean;
    /**
     * Draw one frame at animation-frame time `time`, `dt` ms after the last.
     * `nominal` is one frame at the loop's pace: the cap's period, or one
     * 60 fps frame uncapped (the `dt` of the first frame after a sleep).
     */
    frame(time: number, dt: number, nominal: number): void;
    /**
     * The loop just went idle (the `idle` event). Called synchronously inside
     * the animation-frame callback that drew the last frame (1.10 emitted it
     * one vsync later, in a tick that drew nothing), so heavy work here delays
     * that frame reaching the screen.
     */
    idle(): void;
    /**
     * The loop just paused (pause(), at the frame that took it): no frame
     * runs until resume(), so the host stops what its own timers run
     * meanwhile (the telemetry's).
     */
    paused(): void;
    /** Idle maintenance, run from a timer after going idle. */
    maintain(): void;
    /** A frame, or an idle listener, threw (settings.handleLoopError). */
    error(error: unknown): void;
}
/**
 * The event-driven frame loop (spec 12.1). A frame is requested only when
 * something needs one and is drawn on the next animation frame, capped at
 * `targetFrameTime` with 1.10's tolerance and grid snapping. A frame that
 * leaves nothing to do puts the loop to sleep (no idle polling): `idle` is
 * emitted and maintenance runs from a timer. The first frame after a sleep
 * or a resume steps one frame, not the time slept.
 *
 * Some hosts (Xumo's WPE) stop delivering animation frames once none has
 * been requested for a while, until input arrives. A request made while no
 * animation frame is on its way (a wake, or the next frame of one a timer
 * ran) therefore arms a timer that runs the frame if its animation frame
 * has not come within `wakeFallbackDelay`. Frames that animation frames
 * deliver ask for the next one from inside one and arm nothing.
 */
export declare class FrameLoop {
    /** Minimum ms between frames; 0 is uncapped. */
    targetFrameTime: number;
    /**
     * ms a request made while no animation frame is on its way waits for one
     * before a timer runs the frame instead (settings.wakeFallbackDelay); 0
     * arms no timer.
     */
    wakeFallbackDelay: number;
    /** Stopped by pause(): nothing is scheduled or drawn until resume(). */
    paused: boolean;
    /** Stopped by stop() (context loss, destroy): for good. */
    stopped: boolean;
    private pauseRequested;
    private pauseImmediate;
    /** An animation frame, or the timer that requests one, is pending. */
    private pending;
    /**
     * host.frame() is running: schedule() leaves a request made there to the
     * post-frame check, which reschedules while a frame is still needed.
     */
    private inFrame;
    /** The animation frame requested and not yet run; NO_FRAME when none. */
    private handle;
    /**
     * The tick running (or the last, when it asked for the next frame) came
     * from an animation frame, so animation frames are coming and a request
     * needs no fallback. False for a tick the fallback ran, and from a tick
     * that requested nothing (the loop slept or paused): the next request is
     * a wake.
     */
    private framed;
    /** Fallback timers armed and not yet run: only the last to run may act. */
    private fallbacks;
    /** The animation frame the latest fallback timer stands in for. */
    private fallbackHandle;
    private asleep;
    /**
     * A maintenance timer is already queued: guards against a second one
     * queued for the same idle period (a wake that goes idle again before the
     * first timer's callback has run stacks redundant `host.maintain()` calls
     * otherwise). Cleared when the timer runs.
     */
    private maintenanceQueued;
    /** Pacing grid (1.10 WebPlatform lastFrameTime). */
    private grid;
    /** Time of the last drawn frame; -1 after a sleep or a resume. */
    private last;
    private readonly platform;
    private readonly host;
    private readonly run;
    private readonly request;
    private readonly fallback;
    private readonly maintain;
    constructor(platform: Platform, host: LoopHost);
    /**
     * Run one tick from an animation frame (`framed`) or the fallback timer.
     * The try/catch sits in this small shell so that Crankshaft (Chrome 38),
     * which does not optimize a function containing one, leaves tick()
     * optimizable.
     */
    private enter;
    /**
     * Run the frame from a timer should animation frame `handle` not come
     * within wakeFallbackDelay. Not while the page is hidden: its animation
     * frames are paused on purpose.
     */
    private armFallback;
    /**
     * Request one animation frame unless one is pending, a frame is running
     * (its post-frame check reschedules while a frame is still needed), or the
     * loop is paused or stopped.
     */
    schedule(): void;
    /**
     * Stop once no animation is active (the frame an animation ends on is
     * drawn first), or with `immediate` at the next frame before anything is
     * drawn. A sleeping loop is woken once to notice.
     */
    pause(immediate: boolean): void;
    /**
     * Cancel a pending pause, or restart a paused loop: true when it was paused
     * (cancelling a pending pause returns false).
     */
    resume(): boolean;
    /** Stop for good (context loss, destroy). */
    stop(): void;
    private tick;
    /** Too early for the cap: come back in `ms` (a timer, then an animation frame). */
    private wait;
}
