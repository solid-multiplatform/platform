import { Platform } from '../Platform.js';
import type { Stage } from '../../Stage.js';

/**
 * make fontface add not show errors
 */
interface FontFaceSetWithAdd extends FontFaceSet {
  add(font: FontFace): void;
}

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

  override startLoop(stage: Stage): void {
    let isIdle = false;
    let lastFrameTime = 0;
    // Set by `tick` once it has queued the next frame; read by `runLoop`'s catch
    // so a throw after scheduling never double-schedules (which would compound
    // into runaway frames if it threw every frame). Reset at the top of each frame.
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

    const requestLoop = () => requestAnimationFrame(runLoop);

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
            setTimeout(requestLoop, wait - buffer);
          } else {
            requestAnimationFrame(runLoop);
          }
          scheduled = true;
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
        lastFrameTime =
          currentTime + tolerance - ((elapsed + tolerance) % targetFrameTime);
      } else {
        lastFrameTime = currentTime;
      }

      // Hand the stage the frame's own timestamp rather than letting it read
      // the clock. Every path into `runLoop` arrives through
      // `requestAnimationFrame` — the idle path's `setTimeout` schedules
      // `requestLoop`, which requests a frame rather than calling the loop
      // directly — so this is always a real vsync time, never the `= 0` default.
      stage.updateFrameTime(currentTime);
      const hasActiveAnimations = stage.updateAnimations();

      // A pause waits for animations to finish. `hasActiveAnimations` is also
      // true on an animation's final step, so that frame is drawn first.
      const pause =
        stage.loopPauseRequested === true && hasActiveAnimations === false;

      if (!stage.hasSceneUpdates()) {
        // Still sample here, else the app reads as frozen: the interval is
        // wall clock, so an idle stretch keeps emitting `fpsUpdate` as a
        // heartbeat. `false` books the tick as an idle poll rather than a
        // rendered frame, so the ~15ms poll cadence never enters the rate.
        stage.calculateFps(false, false);

        if (pause === false) {
          // We use 15ms instead of 16.6ms to provide a safety buffer.
          // This ensures we wake up slightly before the next frame to check for updates,
          // preventing us from missing a frame due to timer variances.
          setTimeout(requestLoop, Math.max(targetFrameTime, 15));
          scheduled = true;
        }

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
          stage.eventBus.emit('idle');
          isIdle = true;
        }

        if (stage.txMemManager.checkCleanup() === true) {
          stage.txMemManager.cleanup();
        }

        stage.flushFrameEvents();
        // Marked last: if anything above throws, the catch reschedules and the
        // next tick pauses, so the flag never claims a stop that did not happen.
        if (pause === true) {
          stage.isLoopPaused = true;
        }
        return;
      }

      isIdle = false;
      stage.drawFrame(hasActiveAnimations);
      stage.flushFrameEvents();

      if (pause === true) {
        stage.isLoopPaused = true;
        return;
      }

      // Schedule next frame
      requestAnimationFrame(runLoop);
      scheduled = true;
    };

    const runLoop = (currentTime: number = 0) => {
      // `tick` runs client-supplied code every frame; a throw there would
      // otherwise propagate out of the rAF callback and permanently stop the
      // render loop — the whole app freezes until reload. Guard it and always
      // keep the loop alive: hand the error to `handleLoopError` (a no-op by
      // default; the app can override it to log/report) and reschedule unless
      // `tick` already queued the next frame before throwing.
      scheduled = false;
      try {
        tick(currentTime);
      } catch (error: unknown) {
        const handleLoopError = stage.options.handleLoopError;
        if (handleLoopError !== undefined) {
          handleLoopError(error);
        }
        if (scheduled === false) {
          requestAnimationFrame(runLoop);
        }
      }
    };

    stage.loopResume = requestLoop;
    requestAnimationFrame(runLoop);
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
