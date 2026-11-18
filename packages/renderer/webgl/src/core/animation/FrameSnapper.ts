/**
 * How late a frame may come, as a fraction of a period, and still count as
 * one display frame: a frame whose callback a busy main thread held back
 * still reaches the next vsync, and its catch-up frame follows the vsync
 * after (the 25.5 + 5.5 ms pairs a TV reported on 2.0.5 step one frame
 * each). Lateness is one-sided, so an early frame is allowed a quarter.
 */
const LATE = 0.75;
/**
 * ms of the remainder let go each frame, which moves the bins to where
 * frames come: the drift of a panel at 59.94 Hz (0.017 ms a frame) would
 * otherwise walk a bin edge under the frames and alternate zero and double
 * steps. The animation clock moves at most this much a frame against the
 * wall clock (0.6% at 60 Hz), and only while frames come off its phase.
 */
const SLEW = 0.1;
/**
 * Frames after a wake whose deltas the callback rate leaves out: after a
 * wake a 2020 Samsung TU8000 stamps its 2nd to 5th frames 3 to 10 ms apart
 * (35 ms over 4 frames the screen shows over 66.7 ms).
 */
const WAKE_FRAMES = 6;
/** Intervals the callback rate averages: a mean until then, then a moving one (about 4 s at 60 Hz). */
const RATE_FRAMES = 256;
/** Intervals measured before the rate may say the host outpaces the panel. */
const RATE_MIN = 16;
/**
 * The callbacks keep pace with the panel while their mean interval is at
 * least this share of a period. Past a wake, Samsung Tizen TVs measured 0.92
 * of a period or more; a host calling back at 74 Hz on a 60 Hz panel is 0.81.
 */
const PACE = 0.875;

/**
 * Turns frame deltas into animation steps of whole display frames
 * (settings.animationSnapRate). A host whose animation-frame timestamps
 * jitter around the panel's vsync (a callback a busy main thread delayed, a
 * host that calls back faster than the panel) would otherwise step
 * animations by a delta that the panel never shows, and motion speeds up and
 * slows down between frames. The time not stepped is carried to the next
 * frame, so animations keep wall-clock time.
 *
 * A frame steps zero only on a host that calls back faster than the panel.
 * While the callbacks keep pace with it, each one takes its own vsync (on a
 * Samsung Tizen TV, even one 3 ms after the last), so a zero step would show
 * as a held frame: such a frame steps one display frame instead, and the
 * time its timestamp under-reports is dropped, not repaid.
 */
export class FrameSnapper {
  /** ms per display frame; 0 steps by the delta unchanged. */
  period = 0;
  /** Time elapsed and not yet stepped, in ms. */
  private remainder = 0;
  /** Frames stepped since the last wake (reset), counted up to WAKE_FRAMES. */
  private woken = 0;
  /** Mean callback interval past a wake's first frames, in ms. */
  private interval = 0;
  /** Intervals in `interval`, counted up to RATE_FRAMES. */
  private samples = 0;

  /** The step for a frame `dt` ms after the last. */
  step(dt: number): number {
    const period = this.period;
    if (period === 0) {
      return dt;
    }
    const time = this.remainder + dt;
    const frames = Math.floor(time / period + (1 - LATE));
    const woken = this.woken;
    if (woken < WAKE_FRAMES) {
      this.woken = woken + 1;
    } else if (dt > 0) {
      // A stall counts as two frames, so one does not hide a fast host.
      const sample = dt < 2 * period ? dt : 2 * period;
      const samples = this.samples < RATE_FRAMES ? ++this.samples : RATE_FRAMES;
      this.interval += (sample - this.interval) / samples;
    }
    // A clock that went back (a fallback timer's frame reads the clock,
    // which can be later than the next animation frame's timestamp).
    if (frames < 0) {
      this.remainder = 0;
      return 0;
    }
    // The frame after a wake. WPE runs a wake's frame off the display's
    // cycle, about 2 ms after the request, and the next on the vsync, often
    // under 13 ms later: an early one steps a display frame and the cadence
    // starts there. A late one (after a heavy first frame) carries on.
    if (woken === 1 && time < period) {
      this.remainder = 0;
      return period;
    }
    // A frame that would step zero, while the callbacks keep pace with the
    // panel (or before there are enough of them to say).
    if (
      frames === 0 &&
      (this.samples < RATE_MIN || this.interval >= PACE * period)
    ) {
      this.remainder = 0;
      return period;
    }
    let remainder = time - frames * period;
    if (remainder > SLEW) {
      remainder -= SLEW;
    } else if (remainder < -SLEW) {
      remainder += SLEW;
    } else {
      remainder = 0;
    }
    this.remainder = remainder;
    return frames * period;
  }

  /**
   * Drop the carried time: the next frame is a wake, a new cadence. The
   * callback rate, the host's, is kept.
   */
  reset(): void {
    this.remainder = 0;
    this.woken = 0;
  }
}
