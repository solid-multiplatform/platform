// src/core/loop.ts
import type { Platform } from '../platform/Platform.js';

/** How early a frame may arrive and still count as on time (1.10 WebPlatform). */
const TOLERANCE = 2;
/**
 * How early a frame may arrive after the last drawn one and still draw,
 * whatever the grid says. WPE 601 (Xumo) delivers animation frames 13 to
 * 14 ms apart on a 60 Hz panel, which TOLERANCE held a whole vsync. Under
 * half a 120 Hz vsync (4.17 ms), so it never lets two 120 Hz frames draw
 * in a row. The grid keeps TOLERANCE: a frame that came late lets the grid
 * catch up, and a wider window there would let the next one through after
 * half a period.
 */
const LAST_FRAME_TOLERANCE = 4;
/** A capped wait shorter than this asks for the next frame instead of a timer. */
const BUFFER = 4;
/** The delta of the first frame after a sleep or a resume when uncapped (60 fps). */
const NOMINAL_FRAME = 100 / 6;
/** No animation frame requested and not yet run. */
const NO_FRAME = -1;

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
export class FrameLoop {
  /** Minimum ms between frames; 0 is uncapped. */
  targetFrameTime = 0;
  /**
   * ms a request made while no animation frame is on its way waits for one
   * before a timer runs the frame instead (settings.wakeFallbackDelay); 0
   * arms no timer.
   */
  wakeFallbackDelay = 0;
  /** Stopped by pause(): nothing is scheduled or drawn until resume(). */
  paused = false;
  /** Stopped by stop() (context loss, destroy): for good. */
  stopped = false;
  private pauseRequested = false;
  private pauseImmediate = false;
  /** An animation frame, or the timer that requests one, is pending. */
  private pending = false;
  /**
   * host.frame() is running: schedule() leaves a request made there to the
   * post-frame check, which reschedules while a frame is still needed.
   */
  private inFrame = false;
  /** The animation frame requested and not yet run; NO_FRAME when none. */
  private handle = NO_FRAME;
  /**
   * The tick running (or the last, when it asked for the next frame) came
   * from an animation frame, so animation frames are coming and a request
   * needs no fallback. False for a tick the fallback ran, and from a tick
   * that requested nothing (the loop slept or paused): the next request is
   * a wake.
   */
  private framed = false;
  /** Fallback timers armed and not yet run: only the last to run may act. */
  private fallbacks = 0;
  /** The animation frame the latest fallback timer stands in for. */
  private fallbackHandle = NO_FRAME;
  private asleep = true;
  /**
   * A maintenance timer is already queued: guards against a second one
   * queued for the same idle period (a wake that goes idle again before the
   * first timer's callback has run stacks redundant `host.maintain()` calls
   * otherwise). Cleared when the timer runs.
   */
  private maintenanceQueued = false;
  /** Pacing grid (1.10 WebPlatform lastFrameTime). */
  private grid = 0;
  /** Time of the last drawn frame; -1 after a sleep or a resume. */
  private last = -1;
  private readonly platform: Platform;
  private readonly host: LoopHost;
  private readonly run: (time: number) => void;
  private readonly request: () => void;
  private readonly fallback: () => void;
  private readonly maintain: () => void;

  constructor(platform: Platform, host: LoopHost) {
    this.platform = platform;
    this.host = host;
    this.run = (time: number): void => {
      this.enter(time, true);
    };
    this.request = (): void => {
      if (this.stopped === true) {
        return;
      }
      const handle = this.platform.requestAnimationFrame(this.run);
      this.handle = handle;
      if (this.framed === false) {
        this.armFallback(handle);
      }
    };
    this.fallback = (): void => {
      this.fallbacks--;
      // Only the last timer to run acts, so never before the latest
      // arming's deadline; and only while the animation frame it stands in
      // for is still awaited (not run, replaced or cancelled by stop()).
      const handle = this.fallbackHandle;
      if (this.fallbacks > 0 || this.handle !== handle) {
        return;
      }
      this.platform.cancelAnimationFrame(handle);
      // No timestamp: the frame reads the clock.
      this.enter(0, false);
    };
    this.maintain = (): void => {
      this.maintenanceQueued = false;
      if (this.asleep === true && this.stopped === false) {
        this.host.maintain();
      }
    };
  }

  /**
   * Run one tick from an animation frame (`framed`) or the fallback timer.
   * The try/catch sits in this small shell so that Crankshaft (Chrome 38),
   * which does not optimize a function containing one, leaves tick()
   * optimizable.
   */
  private enter(time: number, framed: boolean): void {
    this.pending = false;
    this.handle = NO_FRAME;
    this.framed = framed;
    // 1.10's Stage.updateFrameTime fell back to the clock when the
    // timestamp was missing or 0; a host that always passes one pays one
    // extra compare per frame for the ones that do not.
    const t = time > 0 ? time : this.platform.now();
    try {
      this.tick(t);
    } catch (error) {
      this.inFrame = false;
      // Schedule the retry before calling error(): a handleLoopError that
      // rethrows synchronously (the default just swallows, but an app's
      // override may log-and-rethrow) would otherwise skip the schedule()
      // below entirely, and nothing else re-requests a frame (a store
      // write only calls onDirty on the clean-to-dirty transition, and a
      // crashed update() can leave frameRequested latched true), freezing
      // the app.
      if (this.host.needsFrame() === true) {
        this.schedule();
      } else {
        // Nothing left to do: the loop sleeps without the idle transition
        // (no idle event, no maintenance until a later frame goes idle),
        // and the next frame takes the nominal delta rather than the time
        // since `time` above, which would be huge or negative.
        this.last = -1;
      }
      if (this.pending === false) {
        this.framed = false;
      }
      this.host.error(error);
      return;
    }
    // Nothing requested: the loop slept or paused, and its next request is
    // a wake.
    if (this.pending === false) {
      this.framed = false;
    }
  }

  /**
   * Run the frame from a timer should animation frame `handle` not come
   * within wakeFallbackDelay. Not while the page is hidden: its animation
   * frames are paused on purpose.
   */
  private armFallback(handle: number): void {
    const delay = this.wakeFallbackDelay;
    if (delay <= 0 || this.platform.hidden() === true) {
      return;
    }
    this.fallbackHandle = handle;
    this.fallbacks++;
    this.platform.setTimeout(this.fallback, delay);
  }

  /**
   * Request one animation frame unless one is pending, a frame is running
   * (its post-frame check reschedules while a frame is still needed), or the
   * loop is paused or stopped.
   */
  schedule(): void {
    if (
      this.pending === true ||
      this.inFrame === true ||
      this.paused === true ||
      this.stopped === true
    ) {
      return;
    }
    this.pending = true;
    this.request();
  }

  /**
   * Stop once no animation is active (the frame an animation ends on is
   * drawn first), or with `immediate` at the next frame before anything is
   * drawn. A sleeping loop is woken once to notice.
   */
  pause(immediate: boolean): void {
    this.pauseRequested = true;
    this.pauseImmediate = immediate;
    this.schedule();
  }

  /**
   * Cancel a pending pause, or restart a paused loop: true when it was paused
   * (cancelling a pending pause returns false).
   */
  resume(): boolean {
    this.pauseRequested = false;
    this.pauseImmediate = false;
    if (this.paused === false) {
      return false;
    }
    this.paused = false;
    this.last = -1;
    return true;
  }

  /** Stop for good (context loss, destroy). */
  stop(): void {
    this.stopped = true;
    this.pending = false;
    // Awaited no more: a fallback timer armed for it does nothing.
    const handle = this.handle;
    if (handle !== NO_FRAME) {
      this.handle = NO_FRAME;
      this.platform.cancelAnimationFrame(handle);
    }
  }

  private tick(time: number): void {
    if (this.stopped === true || this.paused === true) {
      return;
    }
    const host = this.host;
    if (this.pauseRequested === true && this.pauseImmediate === true) {
      this.paused = true;
      host.paused();
      return;
    }
    if (host.needsFrame() === true) {
      const target = this.targetFrameTime;
      if (target > 0) {
        const elapsed = time - this.grid;
        if (
          elapsed < target - TOLERANCE &&
          (this.last < 0 || time - this.last < target - LAST_FRAME_TOLERANCE)
        ) {
          this.wait(target - elapsed);
          return;
        }
        // Snap to the target grid so that the cap holds as a long-run
        // average: an early frame accepted under the tolerance advances a
        // full period too. The first frame after a sleep or a resume starts
        // a new grid: snapping it to the old one could let the next frame
        // through a period early.
        //
        // Never past this frame, though: a grid snapped ahead of an early
        // frame measured the next on-time vsync short and held it a whole
        // vsync. With whole-ms timestamps that wobble about a 60 Hz vsync
        // (WPE 601), 16 read as 14.3 after a 15: a 33 ms frame, half the
        // slow frames on Xumo. A frame at least a period less the tolerance
        // after the last one now always draws, so a panel within the
        // tolerance of the target runs at its own rate (up to 79 Hz at a
        // 60 cap, with LAST_FRAME_TOLERANCE).
        const snapped =
          this.last < 0
            ? time
            : time + TOLERANCE - ((elapsed + TOLERANCE) % target);
        this.grid = snapped > time ? time : snapped;
      } else {
        // Keep the grid current while uncapped too: a runtime switch to a
        // cap (setOptions) reads it on the very next tick, and a stale grid
        // (0, or wherever it was left before the switch) would compute a
        // huge elapsed and let that tick through a full period early.
        this.grid = time;
      }
      const last = this.last;
      this.last = time;
      this.asleep = false;
      const nominal = target > 0 ? target : NOMINAL_FRAME;
      this.inFrame = true;
      host.frame(time, last < 0 ? nominal : time - last, nominal);
      this.inFrame = false;
      // host.frame() can call stop() reentrantly (a destroy() from an event
      // handler or a hook): the cast defeats TypeScript's flow analysis,
      // which otherwise keeps trusting the top-of-function check that
      // narrowed this.stopped to false and flags this comparison as
      // unreachable even though the field can genuinely have changed here.
      const stoppedDuringFrame = this.stopped as boolean;
      if (stoppedDuringFrame === true) {
        // The post-frame steps below must not run for a loop that just
        // ended: they would emit idle and queue maintenance for it.
        return;
      }
    }
    if (this.pauseRequested === true && host.animating() === false) {
      this.paused = true;
      host.paused();
      return;
    }
    if (host.needsFrame() === true) {
      this.schedule();
      return;
    }
    if (this.asleep === false) {
      this.asleep = true;
      this.last = -1;
      if (this.maintenanceQueued === false) {
        this.maintenanceQueued = true;
        this.platform.setTimeout(this.maintain, 0);
      }
      host.idle();
    }
  }

  /** Too early for the cap: come back in `ms` (a timer, then an animation frame). */
  private wait(ms: number): void {
    this.pending = true;
    if (ms > BUFFER) {
      this.platform.setTimeout(this.request, ms - BUFFER);
    } else {
      this.request();
    }
  }
}
