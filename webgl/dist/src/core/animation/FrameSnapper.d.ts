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
export declare class FrameSnapper {
    /** ms per display frame; 0 steps by the delta unchanged. */
    period: number;
    /** Time elapsed and not yet stepped, in ms. */
    private remainder;
    /** Frames stepped since the last wake (reset), counted up to WAKE_FRAMES. */
    private woken;
    /** Mean callback interval past a wake's first frames, in ms. */
    private interval;
    /** Intervals in `interval`, counted up to RATE_FRAMES. */
    private samples;
    /** The step for a frame `dt` ms after the last. */
    step(dt: number): number;
    /**
     * Drop the carried time: the next frame is a wake, a new cadence. The
     * callback rate, the host's, is kept.
     */
    reset(): void;
}
