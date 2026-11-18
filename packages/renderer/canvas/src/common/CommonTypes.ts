import type { CoreNodeRenderState } from '../core/CoreNode.js';
import type { TextureError } from '../core/TextureError.js';

/**
 * Types shared between Main Space and Core Space
 *
 * @remarks
 *
 * @module
 */

/**
 * Represents a width and height.
 */
export interface Dimensions {
  w: number;
  h: number;
}

/**
 * Payload for when text is loaded
 */
export type NodeTextLoadedPayload = {
  type: 'text';
  dimensions: Dimensions;
};

/**
 * Payload for when texture is loaded
 */
export type NodeTextureLoadedPayload = {
  type: 'texture';
  dimensions: Dimensions;
};

/**
 * Combined type for all loaded payloads
 */
export type NodeLoadedPayload =
  | NodeTextLoadedPayload
  | NodeTextureLoadedPayload;

/**
 * Payload for when text failed to load
 */
export type NodeTextFailedPayload = {
  type: 'text';
  error: Error;
};

/**
 * Payload for when texture failed to load
 */
export type NodeTextureFailedPayload = {
  type: 'texture';
  error: TextureError;
};

/**
 * Payload for when texture failed to load
 */
export type NodeTextureFreedPayload = {
  type: 'texture';
};

/**
 * Payload for when node renderable status changes
 */
export type NodeRenderablePayload = {
  type: 'renderable';
  isRenderable: boolean;
};

/**
 * Combined type for all failed payloads
 */
export type NodeFailedPayload =
  | NodeTextFailedPayload
  | NodeTextureFailedPayload;

/**
 * Event handler for when the texture/text of a node has loaded
 */
export type NodeLoadedEventHandler = (
  target: any,
  payload: NodeLoadedPayload,
) => void;

/**
 * Event handler for when the texture/text of a node has failed to load
 */
export type NodeFailedEventHandler = (
  target: any,
  payload: NodeFailedPayload,
) => void;

/**
 * Event handler for when the renderable status of a node changes
 */
export type NodeRenderableEventHandler = (
  target: any,
  payload: NodeRenderablePayload,
) => void;

/**
 * Bounds margin, per side, in logical pixels: `[top, right, bottom, left]`.
 */
export type BoundsMargin = [number, number, number, number];

/**
 * Normalize a `boundsMargin` setting (scalar or per-side tuple) into a
 * `[top, right, bottom, left]` tuple.
 */
export const normalizeBoundsMargin = (
  value: number | BoundsMargin,
): BoundsMargin => {
  if (Array.isArray(value) === true) {
    const arr = value as BoundsMargin;
    return [arr[0] || 0, arr[1] || 0, arr[2] || 0, arr[3] || 0];
  }
  const m = (value as number) || 0;
  return [m, m, m, m];
};

/**
 * Event payload for the `inViewport` / `outOfViewport` node events
 *
 * @remarks
 * Applied with `satisfies` at the emit site so the declaration cannot drift
 * from what is actually sent — `EventEmitter.on` is untyped, so nothing else
 * would catch a mismatch.
 */
export type NodeViewportPayload = {
  previous: CoreNodeRenderState;
  current: CoreNodeRenderState;
};

/**
 * Frame time histogram layout.
 *
 * @remarks
 * Frame times are bucketed rather than averaged because the numbers that
 * matter live in the tail: an average is specifically the statistic that hides
 * the handful of long frames a viewer actually notices.
 *
 * Buckets are {@link FRAME_TIME_FINE_MS} wide up to {@link FRAME_TIME_SPLIT_MS},
 * which is the region containing both the 60fps and 30fps budgets and so the
 * one worth spending resolution on, then widen to {@link FRAME_TIME_COARSE_MS}
 * up to {@link FRAME_TIME_MAX_MS}, followed by a single overflow bucket.
 *
 * Percentiles read off the histogram are approximations bounded by the bucket
 * width: exact to 1ms below the split, to 8ms above it. The overflow bucket
 * cannot distinguish a 130ms frame from a 2s one, so read it alongside
 * `maxFrameTime`.
 */
export const FRAME_TIME_FINE_MS = 1;

/** Frame time in ms at which buckets widen from fine to coarse. */
export const FRAME_TIME_SPLIT_MS = 32;

/** Width in ms of the buckets above {@link FRAME_TIME_SPLIT_MS}. */
export const FRAME_TIME_COARSE_MS = 8;

/** Frame time in ms at or above which samples land in the overflow bucket. */
export const FRAME_TIME_MAX_MS = 128;

/** Number of buckets in a frame time histogram, overflow bucket included. */
export const FRAME_TIME_BUCKET_COUNT = 45;

/**
 * Inclusive lower bound, in milliseconds, of the frame time bucket at `index`.
 *
 * @remarks
 * The bucket's exclusive upper bound is the lower bound of `index + 1`. The
 * last bucket is the overflow bucket and has no upper bound.
 */
export const frameTimeBucketLowerBound = (index: number): number =>
  index < FRAME_TIME_SPLIT_MS
    ? index * FRAME_TIME_FINE_MS
    : FRAME_TIME_SPLIT_MS +
      (index - FRAME_TIME_SPLIT_MS) * FRAME_TIME_COARSE_MS;

/**
 * Event payload for when an FpsUpdate event is emitted by either the Stage or
 * MainRenderer
 */
export interface FpsUpdatePayload {
  /**
   * Frames per second sustained while the renderer had work to do.
   *
   * @remarks
   * Measured over continuous rendering time only: idle polls (and the single
   * frame that resumes rendering after them) are excluded, so an interval that
   * was mostly idle still reports the rate reached while drawing rather than
   * the ~15ms idle poll cadence.
   *
   * `0` means nothing rendered during the interval. Read it together with
   * {@link idleTicks} to tell an idle scene from a stalled one.
   */
  fps: number;
  /**
   * Frames behind {@link fps} and {@link renderedMs}, i.e. the numerator of
   * that rate.
   *
   * @remarks
   * Use this, not {@link renderedFrames}, whenever dividing by
   * {@link renderedMs}. The two counts differ by one frame per rendering burst,
   * and pairing the larger one with a denominator that excludes it overstates
   * the rate — by more than a frame per second on a scene that dips in and out
   * of idle. Pooling intervals is `sum(sampledFrames) / sum(renderedMs)`.
   */
  sampledFrames: number;
  /**
   * Frames actually drawn during the interval.
   *
   * @remarks
   * The true count, unlike {@link sampledFrames}, which omits one frame per
   * rendering burst. This is the number to report as "frames drawn"; it is
   * **not** a rate numerator, and dividing it by {@link renderedMs} is a bug.
   */
  renderedFrames: number;
  /**
   * Idle polls during the interval, i.e. ticks where the scene had no updates.
   *
   * @remarks
   * These are throttled to roughly 15ms and do no rendering work. A high count
   * next to a low {@link renderedFrames} is a quiet app, not a slow one.
   */
  idleTicks: number;
  /**
   * Milliseconds of continuous rendering time behind {@link fps}, i.e. the
   * denominator of that rate. Included so the figure can be audited and so
   * samples can be pooled correctly across intervals.
   *
   * @remarks
   * Its numerator is {@link sampledFrames}, not {@link renderedFrames}.
   */
  renderedMs: number;
  /**
   * Frame time distribution behind {@link fps}, as a count per bucket.
   *
   * @remarks
   * Length is {@link FRAME_TIME_BUCKET_COUNT}; use
   * {@link frameTimeBucketLowerBound} to map an index to its millisecond
   * range. Covers exactly the frames behind {@link fps} and
   * {@link renderedMs}, so idle polls and the frame that resumes rendering
   * after them are excluded and the buckets sum to that paired frame count
   * rather than to {@link renderedFrames}.
   *
   * Report percentiles from this rather than an average: p95 and p99 frame
   * time are what a viewer experiences as jank, and both are invisible in
   * {@link fps}.
   */
  frameTimeBuckets: number[];
  /**
   * Longest frame in the sample, in milliseconds. `0` when nothing rendered.
   *
   * @remarks
   * Exact, unlike a percentile read off {@link frameTimeBuckets}, and the only
   * way to see past the overflow bucket, which lumps a 130ms frame together
   * with a multi-second one.
   */
  maxFrameTime: number;
  /**
   * Frames per second sustained while animations were running.
   *
   * @remarks
   * This is the number to watch. Smoothness only matters while something is
   * moving: a scene that renders once for a texture load and then sits still
   * can post a dreadful frame time that no viewer ever perceives, and it
   * drags {@link fps} down with it. Restricting the rate to animated frames
   * measures the thing a user actually experiences as smooth or not.
   *
   * `0` when no animated frame was sampled during the interval.
   */
  animatedFps: number;
  /**
   * Frames sampled with animations running, i.e. the count behind
   * {@link animatedFps}. A subset of the frames behind {@link fps}.
   */
  animatedFrames: number;
  /**
   * Milliseconds of rendering time behind {@link animatedFps}, i.e. that
   * rate's denominator.
   */
  animatedMs: number;
  /**
   * Frame time distribution restricted to animated frames, in the same bucket
   * layout as {@link frameTimeBuckets}.
   *
   * @remarks
   * Take p95 and p99 from here rather than from {@link frameTimeBuckets} when
   * the question is whether motion was smooth. Buckets sum to
   * {@link animatedFrames}.
   */
  animatedFrameTimeBuckets: number[];
  /**
   * Longest animated frame in the interval, in milliseconds. `0` when none
   * were sampled. See {@link maxFrameTime}.
   */
  animatedMaxFrameTime: number;
  /**
   * App-set label describing what the scene was doing, e.g. `'home'` or
   * `'detail-scroll'`. Empty when never set.
   *
   * @remarks
   * Set it with `renderer.setTelemetrySegment()`, which also closes the sample
   * in progress so no interval spans two segments. Without a label every
   * sample is a blend of whatever the session happened to be doing, and
   * segment-level comparison is impossible.
   */
  segment: string;
  /**
   * Mean number of animations running per rendered frame over the interval.
   *
   * @remarks
   * Animation load is reported as a count rather than a duration on purpose.
   * The animation step costs a few tens of microseconds even for a heavy
   * scene, far below the `performance.now()` clamp (100us in Chrome, and a
   * measured 1ms on the reference TV), so timing it would read as a flat zero
   * on most frames. The count is exact, costs no
   * clock reads, and answers the question that actually matters when comparing
   * builds: whether the two were doing the same amount of animation work. If
   * frame times differ while this does not, the animation system is not the
   * cause.
   *
   * Sampled once per rendered frame, so it shares the {@link renderedFrames}
   * denominator with the phase totals. `0` when nothing rendered.
   */
  meanActiveAnimations: number;
  /**
   * Peak number of animations running in any single rendered frame of the
   * interval. See {@link meanActiveAnimations}.
   *
   * @remarks
   * A spike here against a flat {@link meanActiveAnimations} points at a burst
   * (a screen transition firing everything at once) rather than steady load.
   */
  maxActiveAnimations: number;
  /**
   * Milliseconds spent in the scene graph update walk, summed across the
   * interval's {@link renderedFrames}.
   *
   * @remarks
   * {@link updateMs}, {@link renderMs} and {@link uploadMs} split the work
   * inside `drawFrame` three ways, which is what turns "this build is 12%
   * slower" into a cause. The animation step runs before the draw and is
   * reported separately, as {@link meanActiveAnimations}.
   *
   * These cover every rendered frame, not the paired subset behind
   * {@link fps}: the phases are timed directly around the work rather than
   * inferred from tick deltas, so the frame that resumes rendering after an
   * idle stretch has no distortion to exclude.
   *
   * Their sum is measured frame work, whereas {@link renderedMs} is wall time
   * between rendered ticks. The gap between the two is what remains
   * unmeasured: rAF scheduling, browser compositing, `frameTick` subscribers,
   * and any other main thread work. A large gap points outside the renderer.
   *
   * RESOLUTION: browsers clamp `performance.now()`, and a phase shorter than
   * that grid reads as a flat `0` on most frames. Chrome clamps to 100us
   * without cross-origin isolation and 5us with it, but do not size the grid
   * from those numbers: the reference TV (WPE WebKit) measured a full 1ms, so
   * on the ship target the grid is 10x coarser than the Chrome figure and any
   * phase under a millisecond reads as zero. Do NOT divide these by
   * {@link renderedFrames} and read the result as a per-frame cost: for
   * {@link updateMs} on a small scene that quotient is mostly quantization.
   * The totals themselves stay sound, because flooring both ends of a
   * difference is unbiased in expectation and the sum over an interval
   * converges on the true value. Treat these as interval
   * totals to compare against each other and across builds, not as per-frame
   * timings.
   */
  updateMs: number;
  /**
   * Milliseconds spent building the render list and issuing the render pass,
   * summed across the interval's {@link renderedFrames}. See {@link updateMs}.
   */
  renderMs: number;
  /**
   * Milliseconds spent uploading queued textures, summed across the interval's
   * {@link renderedFrames}. See {@link updateMs}.
   *
   * @remarks
   * `texImage2D` is a synchronous driver-side copy and historically the single
   * largest stall in a scroll frame, so this is usually the first phase to
   * check when frame times spike.
   */
  uploadMs: number;
  /**
   * Longest single-frame update walk in the interval, in milliseconds.
   *
   * @remarks
   * {@link maxUpdateMs}, {@link maxRenderMs} and {@link maxUploadMs} are the
   * per-frame peaks of the three phase totals. The totals average a spike
   * away; the peaks tie a fat tail in {@link frameTimeBuckets} to the phase
   * that caused it: the phase whose peak approaches {@link maxFrameTime} is
   * where the worst frame went.
   *
   * The same clock resolution caveat as {@link updateMs} applies: a peak of a
   * fraction of a millisecond is mostly quantization. Peaks worth acting on
   * are several milliseconds and well clear of the clamp.
   */
  maxUpdateMs: number;
  /**
   * Longest single-frame render-list build + render pass in the interval, in
   * milliseconds. See {@link maxUpdateMs}.
   */
  maxRenderMs: number;
  /**
   * Longest single-frame texture upload in the interval, in milliseconds. See
   * {@link maxUpdateMs}.
   *
   * @remarks
   * While animating the renderer uploads at most one texture per frame, so a
   * spike here is the cost of a single `texImage2D` on the device — compare it
   * against your source image dimensions.
   */
  maxUploadMs: number;
  /**
   * Frames during the interval that entered the texture upload path.
   *
   * @remarks
   * Counts frames that reached the upload path with a non-empty queue,
   * whether or not the dequeued texture was still alive to upload —
   * {@link uploadedTextures} counts the uploads that actually ran. `uploadMs /
   * uploadFrames` is the mean upload cost of a frame that did any, rather
   * than an average smeared across frames that uploaded nothing.
   */
  uploadFrames: number;
  /**
   * Textures actually uploaded to the GPU during the interval.
   *
   * @remarks
   * The denominator that makes {@link uploadMs} actionable: `uploadMs /
   * uploadedTextures` is the mean cost of one `texImage2D` on the device,
   * regardless of whether the frames batched several uploads
   * (`processUntil` while idle) or paced one per frame (while animating).
   * Compare it against your source image dimensions when frames spike.
   *
   * Skips are excluded: a texture found dead at the point of upload, or one
   * handed to the async refetch path, moved no bytes on this frame and is not
   * counted.
   */
  uploadedTextures: number;
  /**
   * Deepest the pending texture upload queue got during the interval,
   * measured at the start of each frame's drain.
   *
   * @remarks
   * The backpressure signal for `textureProcessingTimeLimit`: a peak that
   * climbs interval over interval means textures are arriving faster than the
   * per-frame budget drains them, so queued images appear late. A small,
   * steady peak means the budget is keeping up. Read it against
   * {@link maxUploadMs} to pick a budget that drains the queue without
   * blowing the frame.
   */
  maxUploadQueueSize: number;
  /**
   * Per-method context (i.e. WebGL) call counts over the interval, or `null`
   * when the context spy is off.
   *
   * @remarks
   * Populated only while `enableContextSpy` is set, which costs enough
   * performance that it is a debugging tool, not something to leave on. Keys
   * are context method names; values are the call count over the interval.
   */
  contextSpyData: Record<string, number> | null;
  /**
   * Draw calls (render operations) submitted for the most recent frame.
   * `0` on the Canvas backend, which does not batch into render ops.
   */
  renderOps: number;
  /**
   * Quads rendered in the most recent frame. `0` on the Canvas backend.
   */
  quads: number;
}

/**
 * Event payload for when a frame tick event is emitted by the Stage
 */
export interface FrameTickPayload {
  /**
   * Monotonic timestamp of the current frame, in milliseconds, measured from
   * page load rather than from the Unix epoch. See
   * {@link Platform.getTimeStamp}.
   */
  time: number;
  /** Time delta since the previous frame, in milliseconds. */
  delta: number;
}

/**
 * Event payload for when an RenderUpdate event is emitted by the Stage
 */
export interface RenderUpdatePayload {
  quads: number;
  renderOps: number;
}
