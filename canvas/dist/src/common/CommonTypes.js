/**
 * Normalize a `boundsMargin` setting (scalar or per-side tuple) into a
 * `[top, right, bottom, left]` tuple.
 */
export const normalizeBoundsMargin = (value) => {
    if (Array.isArray(value) === true) {
        const arr = value;
        return [arr[0] || 0, arr[1] || 0, arr[2] || 0, arr[3] || 0];
    }
    const m = value || 0;
    return [m, m, m, m];
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
export const frameTimeBucketLowerBound = (index) => index < FRAME_TIME_SPLIT_MS
    ? index * FRAME_TIME_FINE_MS
    : FRAME_TIME_SPLIT_MS +
        (index - FRAME_TIME_SPLIT_MS) * FRAME_TIME_COARSE_MS;
//# sourceMappingURL=CommonTypes.js.map