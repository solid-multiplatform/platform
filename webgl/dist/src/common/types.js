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
 * Frame time histogram: 1 ms buckets from 0 to 32 ms, then 8 ms buckets up to
 * 128 ms, then one overflow bucket. 32 + 12 + 1 = 45 buckets.
 */
export const FRAME_TIME_FINE_MS = 1;
export const FRAME_TIME_SPLIT_MS = 32;
export const FRAME_TIME_COARSE_MS = 8;
export const FRAME_TIME_MAX_MS = 128;
export const FRAME_TIME_BUCKET_COUNT = 45;
/** The lowest frame time, in ms, that bucket `index` counts. */
export function frameTimeBucketLowerBound(index) {
    if (index < FRAME_TIME_SPLIT_MS) {
        return index * FRAME_TIME_FINE_MS;
    }
    return (FRAME_TIME_SPLIT_MS + (index - FRAME_TIME_SPLIT_MS) * FRAME_TIME_COARSE_MS);
}
/**
 * The bucket a frame time of `ms` falls in (telemetry counts each paired
 * frame there): the inverse of {@link frameTimeBucketLowerBound}. A
 * negative time counts in bucket 0, and 128 ms and above in the last.
 */
export function frameTimeBucketIndex(ms) {
    if (ms < FRAME_TIME_SPLIT_MS) {
        return ms < 0 ? 0 : Math.floor(ms);
    }
    if (ms >= FRAME_TIME_MAX_MS) {
        return FRAME_TIME_BUCKET_COUNT - 1;
    }
    return (FRAME_TIME_SPLIT_MS +
        Math.floor((ms - FRAME_TIME_SPLIT_MS) / FRAME_TIME_COARSE_MS));
}
//# sourceMappingURL=types.js.map