import { Platform } from '../Platform.js';
import type { Stage } from '../../Stage.js';

/**
 * make fontface add not show errors
 */
interface FontFaceSetWithAdd extends FontFaceSet {
  add(font: FontFace): this;
}

/** `document.hidden`, where there is a document. */
const pageHidden = (): boolean =>
  typeof document !== 'undefined' && document.hidden === true;

export class WebPlatform extends Platform {
  ////////////////////////
  // Platform-specific methods
  ////////////////////////

  override createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    return canvas;
  }

  override getElementById(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  override sizeCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    logicalWidth: number,
    logicalHeight: number,
  ): void {
    canvas.width = width;
    canvas.height = height;
    // An OffscreenCanvas has no style block; a DOM canvas presents at the
    // logical size.
    if (canvas.style !== undefined && canvas.style !== null) {
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
    }
  }

  ////////////////////////
  // Update loop
  ////////////////////////

  /**
   * The loop is event driven: it runs while there is something to draw or to
   * step, and sleeps otherwise.
   *
   * @remarks
   * A tick that drew a frame always requests the next one. The first tick
   * that finds the scene without updates is where a burst settles: it emits
   * `idle`, does the idle maintenance, and then requests nothing at all (no
   * frame, no timer, no poll) unless an animation is still active or a
   * listener of that very tick asked for more. It marks the stage
   * `loopAsleep` instead, and from then on the loop exists only as that flag.
   * Whatever gives it work again calls `stage.wakeLoop()`, which requests
   * exactly one frame through `stage.loopResume`. The wake sources are listed
   * at `Stage.hasSceneUpdates` and `Stage.needsTick`.
   *
   * Some hosts stop delivering animation frames once none has been requested
   * for a while, until input arrives (seen on WPE WebKit; the old TV browsers
   * this backend runs on are where to expect it). The old loop never met
   * that, since it never stopped requesting; a loop that sleeps does, and a
   * wake whose frame never comes is a frozen picture. So a frame requested
   * while no animation frame is on its way (a wake, a resume, the first
   * frame, or the next frame of a tick the timer itself ran) also arms one
   * timer, `wakeFallbackDelay` ms long (50 by default, as in the WebGL
   * backend; 0 turns it off), which runs the tick if the frame has not come
   * by then. The frame arriving clears it. A tick that an animation frame
   * delivered requests the next one from inside it and arms nothing, so a
   * running loop has no timer, and a sleeping, paused, lost or destroyed one
   * has neither timer nor frame: it is not a poll.
   */
  override startLoop(stage: Stage): void {
    let isIdle = false;
    let lastFrameTime = 0;
    // True from the moment the next tick is requested (a frame, or the frame
    // cap's timer that requests one) until that tick starts. Read by
    // `runLoop`'s catch so a throw after scheduling never double-schedules
    // (which would compound into runaway frames if it threw every frame).
    let scheduled = false;
    const buffer = 4;
    // How early a frame may arrive and still count as on time. rAF timestamps
    // wobble around vsync, and on the reference TV `performance.now()` (which
    // the timestamps derive from) is clamped to whole milliseconds, so at a
    // 16.667ms target the measured gap reads 16 as often as 17. A strict
    // `elapsed < targetFrameTime` rejected every one of those and deferred the
    // draw to the following vsync: a 33ms frame in the middle of a 60fps run.
    // 2ms covers the 1ms clamp plus a late-then-on-time timestamp pair, and
    // stays well under half of any vsync interval (4.17ms at 120Hz), so the
    // cap still cannot draw on two consecutive faster-than-target frames.
    const tolerance = 2;

    // The next tick is the first after a sleep or a pause. Read by the frame
    // cap, which starts a new pacing grid there.
    let restarted = false;

    // What the loop has pending, kept so that `stopLoop` can take it back:
    // the animation frame requested and not yet run (0 when none), the frame
    // cap's timer, and the wake fallback's timer.
    let frameHandle = 0;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    // The tick running (or the last one, when it requested the next frame)
    // was delivered by an animation frame, so animation frames are coming and
    // a request needs no fallback. False for a tick the fallback ran, and
    // after a tick that requested nothing: the next request is a wake.
    let framed = false;
    // `tick` is running. A stop asked for from inside it (a listener calling
    // `destroy()`) has nothing pending to cancel and is left to the tick's
    // own end, which reads the request again.
    let inTick = false;

    const requestLoop = () => {
      // A lost context ends the loop: nothing is requested for it again.
      if (stage.isContextLost === true) {
        return;
      }
      scheduled = true;
      frameHandle = requestAnimationFrame(onFrame);
      if (framed === false) {
        armFallback();
      }
    };

    // Run the tick from a timer should the frame just requested not come
    // within `wakeFallbackDelay`. Not while the page is hidden: its animation
    // frames are held back on purpose, and come when it shows again.
    const armFallback = () => {
      const delay = stage.options.wakeFallbackDelay;
      if (delay === undefined || delay <= 0 || pageHidden() === true) {
        return;
      }
      fallbackTimer = setTimeout(onFallback, delay);
    };

    const onFrame = (time: number) => {
      frameHandle = 0;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      framed = true;
      runLoop(time);
    };

    // The awaited frame did not come in time. It is awaited no more: this
    // runs its tick, and a frame arriving late must not run a second one.
    const onFallback = () => {
      fallbackTimer = null;
      // Hidden since the timer was armed: wait for the frame after all.
      if (pageHidden() === true) {
        return;
      }
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      framed = false;
      // No frame, so no frame timestamp: read the clock they derive from.
      runLoop(stage.platform.getTimeStamp());
    };

    // The frame cap's timer ran: request the frame it was holding back.
    const onWait = () => {
      waitTimer = null;
      requestLoop();
    };

    // `stage.loopResume`: the one frame that wakes a sleeping loop or
    // restarts a paused one.
    const restartLoop = () => {
      restarted = true;
      requestLoop();
    };

    // `stage.loopStop`: take back whatever the loop has pending, so that an
    // immediate pause, a destroy or a lost context leaves no frame and no
    // timer behind. Returns false from inside a tick, which stops by itself.
    const stopLoop = (): boolean => {
      if (inTick === true) {
        return false;
      }
      if (frameHandle !== 0) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
      if (waitTimer !== null) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      scheduled = false;
      framed = false;
      return true;
    };

    // All per-frame work lives in `tick`, deliberately split out of `runLoop`.
    // `runLoop` carries the try/catch that keeps the loop alive, and some
    // optimizing compilers — notably Chrome 38's Crankshaft, our language floor —
    // refuse to optimize any function that contains a try/catch. Keeping that
    // guard in a near-empty shell confines the de-opt to the shell: every hot
    // operation (the `stage.*` calls below, run every frame) stays in fully
    // optimizable functions. `tick` is also where all client-supplied code runs
    // (synchronous event subscribers, the events drained by `flushFrameEvents`,
    // and animation steps) — i.e. everything that can actually throw.
    const tick = (currentTime: number) => {
      // The GL context is lost and the engine does not rebuild it in place.
      // Stop the loop entirely (no reschedule) so we issue no GL calls against
      // a dead context. Recovery is via app reload (see the `contextLost` event).
      if (stage.isContextLost === true) {
        return;
      }

      // An immediate pause stops here, before the frame clock moves or
      // anything is drawn. Animations stay where they are; `resumeLoop`
      // zeroes the frame clock, so they carry on with a nominal step.
      if (
        stage.loopPauseRequested === true &&
        stage.loopPauseImmediate === true
      ) {
        stage.isLoopPaused = true;
        return;
      }

      const targetFrameTime = stage.targetFrameTime;

      // Frame Limiting logic
      if (targetFrameTime > 0) {
        // Calculate elapsed time since the last frame
        const elapsed = currentTime - lastFrameTime;

        // If not enough time has passed, skip this frame
        if (elapsed < targetFrameTime - tolerance) {
          const wait = targetFrameTime - elapsed;

          if (wait > buffer) {
            scheduled = true;
            waitTimer = setTimeout(onWait, wait - buffer);
          } else {
            requestLoop();
          }
          return;
        }

        // Snap lastFrameTime forward to the target grid so the cap holds as
        // a long-run average: the grid advances by a whole number of frame
        // periods per draw, never by the raw elapsed time. An early frame
        // accepted under the tolerance must advance it a full period too,
        // hence the tolerance is folded into the modulo. Without that, a
        // frame arriving in `[target - tolerance, target)` left the grid where
        // it was, the next vsync then measured well over a period, and the
        // loop drew on both, doubling the rate whenever the vsync phase
        // landed in that window (30fps on a 60Hz panel rendered at 60).
        //
        // The first frame after a sleep or a pause starts a new grid instead.
        // The old grid's phase says nothing about a frame that comes seconds
        // later, and snapping to it would leave `lastFrameTime` up to a whole
        // period in the past: the very next vsync would then measure a full
        // period and draw, one frame early, at the start of every burst.
        if (restarted === true) {
          restarted = false;
          lastFrameTime = currentTime;
        } else {
          lastFrameTime =
            currentTime + tolerance - ((elapsed + tolerance) % targetFrameTime);
        }
      } else {
        lastFrameTime = currentTime;
      }

      // Hand the stage the frame's own timestamp rather than letting it read
      // the clock. Every path into `runLoop` but one arrives through
      // `requestAnimationFrame` — the frame cap's `setTimeout` requests a
      // frame rather than calling the loop directly, and so does a wake — so
      // this is a real vsync time. The one exception is the wake fallback,
      // which has no frame and passes the clock the timestamps derive from.
      stage.updateFrameTime(currentTime);
      const hasActiveAnimations = stage.updateAnimations();

      // A pause waits for animations to finish. `hasActiveAnimations` is also
      // true on an animation's final step, so that frame is drawn first.
      const pause =
        stage.loopPauseRequested === true && hasActiveAnimations === false;

      if (!stage.hasSceneUpdates()) {
        // Booked as a tick that drew nothing, so it never enters the rate.
        // The sample is not closed for the time the loop then sleeps:
        // `fpsUpdate` stops with the loop (see `Stage.calculateFps`).
        stage.calculateFps(false, false);

        if (isIdle === false) {
          // The render burst has settled. Probe for a GPU out-of-memory now
          // rather than every frame: GL errors accumulate and persist until
          // drained, so a single check here still catches any OOM raised during
          // the active frames, without paying the getError() CPU/GPU sync on
          // every frame. Queues the `outOfMemory` event, flushed below.
          if (stage.renderer.checkForOutOfMemory() === true) {
            stage.txMemManager.handleOutOfMemory();
          }
          stage.shManager.cleanup();
          stage.cleanupTextRenderers();
          // Marked before the listeners run, so `idle` fires once per settle
          // even when one of them throws: the catch below requests a tick,
          // and that tick must find the settle already announced. Marked
          // after, a listener that threw every time would be called again on
          // every frame, by a loop that could then never sleep.
          isIdle = true;
          stage.eventBus.emit('idle');
        }

        // Checked on every tick that draws nothing, the settle tick and any
        // later one a wake asks for. Nothing re-checks it while the loop
        // sleeps: a cleanup that turns due by memory wakes the loop
        // (`TextureMemoryManager.setTextureMemUse`); one that turns due only
        // by `cleanupInterval` elapsing waits for the next such tick.
        if (stage.txMemManager.checkCleanup() === true) {
          stage.txMemManager.cleanup();
        }

        stage.flushFrameEvents();

        // Marked last: if anything above throws, the catch reschedules and the
        // next tick pauses, so the flag never claims a stop that did not
        // happen. The immediate request is read again here because a listener
        // of this tick may have made it (`destroy()` does), and it must not
        // wait for a tick of its own.
        if (
          pause === true ||
          (stage.loopPauseRequested === true &&
            stage.loopPauseImmediate === true)
        ) {
          stage.isLoopPaused = true;
          return;
        }

        // Sleep, unless there is a reason to tick again: an animation is
        // active (it is stepped every frame, also through a delay in which it
        // changes nothing), or a listener above dirtied the scene, started
        // one, or queued an event. Those ran while the loop was awake, when a
        // wake is a no-op, so this read is what catches them; it is the last
        // thing the tick does so that nothing can slip in after it. Once
        // `loopAsleep` is set, every one of these conditions wakes the loop
        // where it turns true.
        if (stage.needsTick() === true) {
          requestLoop();
        } else if (stage.loopPauseRequested === true) {
          // A pause that waited on an animation, which took its last step in
          // this tick: `pause` above was still false, and no tick is coming
          // to find it true. With nothing left to wait for, it is a pause.
          stage.isLoopPaused = true;
        } else {
          stage.loopAsleep = true;
        }
        return;
      }

      isIdle = false;
      stage.drawFrame(hasActiveAnimations);
      stage.flushFrameEvents();

      // As in the idle path: an immediate pause asked for by a listener of
      // this tick stops the loop here rather than on a tick of its own.
      if (
        pause === true ||
        (stage.loopPauseRequested === true && stage.loopPauseImmediate === true)
      ) {
        stage.isLoopPaused = true;
        return;
      }

      // Schedule next frame. Always, after a drawn frame: the tick that finds
      // nothing left to draw is where the burst settles and the loop sleeps.
      requestLoop();
    };

    const runLoop = (currentTime: number) => {
      // `tick` runs client-supplied code every frame; a throw there would
      // otherwise propagate out of the rAF callback and permanently stop the
      // render loop — the whole app freezes until reload. Guard it and always
      // keep the loop alive: hand the error to `handleLoopError` (a no-op by
      // default; the app can override it to log/report) and reschedule unless
      // `tick` already queued the next frame before throwing.
      scheduled = false;
      inTick = true;
      try {
        tick(currentTime);
      } catch (error: unknown) {
        inTick = false;
        // Rescheduled before the handler runs: one that rethrows would
        // otherwise skip it, and a loop that neither has a frame pending nor
        // is marked asleep can be woken by nothing. The tick this requests
        // finishes what the throw cut short, and sleeps if that is all.
        // Unless an immediate pause was asked for in the tick that threw
        // (`destroy()` asks for one): that tick would only stop, so this is
        // the stop, with nothing requested.
        if (scheduled === false) {
          if (
            stage.loopPauseRequested === true &&
            stage.loopPauseImmediate === true
          ) {
            stage.isLoopPaused = true;
            framed = false;
          } else {
            requestLoop();
          }
        }
        const handleLoopError = stage.options.handleLoopError;
        if (handleLoopError !== undefined) {
          handleLoopError(error);
        }
      }
      inTick = false;
      // A tick that requested nothing slept, paused or ended the loop:
      // whatever requests the next frame is a wake.
      if (scheduled === false) {
        framed = false;
      }
    };

    stage.loopResume = restartLoop;
    stage.loopStop = stopLoop;
    requestLoop();
  }

  ////////////////////////
  // ImageBitmap
  ////////////////////////

  override createImageBitmap(
    blob: ImageBitmapSource,
    sxOrOptions?: number | ImageBitmapOptions,
    sy?: number,
    sw?: number,
    sh?: number,
    options?: ImageBitmapOptions,
  ): Promise<ImageBitmap> {
    if (typeof sxOrOptions === 'number') {
      return createImageBitmap(
        blob,
        sxOrOptions,
        sy ?? 0,
        sw ?? 0,
        sh ?? 0,
        options,
      );
    } else {
      return createImageBitmap(blob, sxOrOptions);
    }
  }

  getTimeStamp(): number {
    // `performance.now()`, not `Date.now()`: this clock drives `deltaTime`,
    // the animation step and the FPS sample, and `Date.now()` is a poor fit
    // because it tracks wall time, so an NTP correction during a long-running
    // TV session can step it or move it backwards and yield a negative delta.
    // `performance.now()` is monotonic, and the engine already depends on it
    // elsewhere (CoreAnimation's adaptive duration), so this also puts every
    // timing path on a single clock.
    //
    // Monotonicity is the entire reason, NOT precision. Measured on the
    // reference TV (WPE WebKit): `performance.now()` is clamped to whole
    // milliseconds, the same grid `Date.now()` gives, and costs ~980ns a call
    // against ~255ns for `Date.now()`. On the ship target this buys no extra
    // resolution at ~4x the price. Do not "optimize" it back: a backwards
    // step is a real bug on a set left powered for days, and the five calls a
    // frame behind the FPS sample are ~0.03% of a core at 60Hz.
    //
    // NOTE: the epoch changes with it. Values are measured from page load, not
    // from 1970; see `FrameTickPayload.time`.
    return performance.now();
  }

  override addFont(font: FontFace): void {
    (document.fonts as FontFaceSetWithAdd).add(font);
  }
}
