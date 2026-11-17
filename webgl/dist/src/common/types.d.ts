import type { TextureError } from '../core/textures/TextureError.js';
import type { TimingFunction } from './easing.js';
export interface Dimensions {
    w: number;
    h: number;
}
/**
 * Public render-state values of a node, kept numerically identical to 1.10:
 * 0 Init, 2 OutOfBounds, 4 InBounds, 8 InViewport.
 */
export type RenderStateValue = 0 | 2 | 4 | 8;
/** 1.10's name for a node's render state (`node.renderState`). */
export type CoreNodeRenderState = RenderStateValue;
/**
 * The load state of the image a node's `src` or `texture` names
 * (`node.imageState`): `'none'` without either, `'loaded'` once its pixels
 * are uploaded, `'failed'` once its load failed for good (after the last
 * retry: the node's `failed` event), and `'loading'` otherwise.
 */
export type NodeImageState = 'none' | 'loading' | 'loaded' | 'failed';
export type NodeTextLoadedPayload = {
    type: 'text';
    dimensions: Dimensions;
};
export type NodeTextureLoadedPayload = {
    type: 'texture';
    dimensions: Dimensions;
};
export type NodeLoadedPayload = NodeTextLoadedPayload | NodeTextureLoadedPayload;
export type NodeTextFailedPayload = {
    type: 'text';
    error: Error;
};
export type NodeTextureFailedPayload = {
    type: 'texture';
    error: TextureError | Error;
};
export type NodeFailedPayload = NodeTextFailedPayload | NodeTextureFailedPayload;
export type NodeTextureFreedPayload = {
    type: 'texture';
};
export type NodeRenderablePayload = {
    type: 'renderable';
    isRenderable: boolean;
};
export type NodeViewportPayload = {
    previous: RenderStateValue;
    current: RenderStateValue;
};
export type NodeLoadedEventHandler = (target: any, payload: NodeLoadedPayload) => void;
export type NodeFailedEventHandler = (target: any, payload: NodeFailedPayload) => void;
export type NodeRenderableEventHandler = (target: any, payload: NodeRenderablePayload) => void;
/**
 * Bounds margin, per side, in logical pixels: `[top, right, bottom, left]`.
 */
export type BoundsMargin = [number, number, number, number];
/**
 * Normalize a `boundsMargin` setting (scalar or per-side tuple) into a
 * `[top, right, bottom, left]` tuple.
 */
export declare const normalizeBoundsMargin: (value: number | BoundsMargin) => BoundsMargin;
export interface TextureResizeMode {
    type: 'cover' | 'contain';
    clipX?: number;
    clipY?: number;
    x?: number;
    y?: number;
}
export interface TextureOptions {
    preload?: boolean;
    preventCleanup?: boolean;
    flipX?: boolean;
    flipY?: boolean;
    resizeMode?: TextureResizeMode;
}
export type AnimationControllerState = 'scheduled' | 'running' | 'paused' | 'stopped';
export interface IAnimationController {
    start(): IAnimationController;
    stop(): IAnimationController;
    pause(): IAnimationController;
    restore(): IAnimationController;
    /**
     * Resolves when the current run stops (naturally or via `stop()`). Each
     * run (a `start()` after a stop) has a fresh promise, made at its first
     * call and returned by every call until the run stops; when the animation
     * is already stopped this returns an already-resolved promise.
     */
    waitUntilStopped(): Promise<void>;
    readonly state: AnimationControllerState;
}
export interface AnimationSettings {
    duration: number;
    delay: number;
    easing: string | TimingFunction;
    loop: boolean;
    repeat: number;
    repeatDelay: number;
    stopMethod: 'reverse' | false;
    adaptiveDuration: boolean;
}
/**
 * Frame time histogram: 1 ms buckets from 0 to 32 ms, then 8 ms buckets up to
 * 128 ms, then one overflow bucket. 32 + 12 + 1 = 45 buckets.
 */
export declare const FRAME_TIME_FINE_MS = 1;
export declare const FRAME_TIME_SPLIT_MS = 32;
export declare const FRAME_TIME_COARSE_MS = 8;
export declare const FRAME_TIME_MAX_MS = 128;
export declare const FRAME_TIME_BUCKET_COUNT = 45;
/** The lowest frame time, in ms, that bucket `index` counts. */
export declare function frameTimeBucketLowerBound(index: number): number;
/**
 * The bucket a frame time of `ms` falls in (telemetry counts each paired
 * frame there): the inverse of {@link frameTimeBucketLowerBound}. A
 * negative time counts in bucket 0, and 128 ms and above in the last.
 */
export declare function frameTimeBucketIndex(ms: number): number;
/**
 * The `fpsUpdate` payload (spec 12.5), 1.10's field for field: the renderer
 * emits one every `fpsUpdateInterval` ms while the setting is above 0,
 * after the frame that closes the interval, or from a timer while the loop
 * sleeps (it does not poll, so an interval with nothing to draw still
 * closes on time).
 */
export interface FpsUpdatePayload {
    /**
     * Frames per second sustained while the renderer had work to do.
     *
     * @remarks
     * Measured over continuous drawing time only: the frames that drew
     * nothing (an animation's delay, a frame that only uploaded textures) and
     * the frame that resumes drawing after them or after a sleep are
     * excluded, so an interval that was mostly idle still reports the rate
     * reached while drawing.
     *
     * `0` means no frame was paired with a delta (nothing was drawn during
     * the interval, as when an idle app's samples close from a timer, or
     * only single frames, each resuming drawing after a sleep or an undrawn
     * frame), or the rate rounds to 0 (paired frames averaging over 2 s).
     * 1.10's figure had the same meanings; {@link renderedFrames} and
     * {@link sampledFrames} tell them apart.
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
     * the rate (by more than a frame per second on a scene that dips in and out
     * of idle). Pooling intervals is `sum(sampledFrames) / sum(renderedMs)`.
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
     * Frames the loop ran during the interval that drew nothing: an
     * animation's delay, or a frame that only uploaded textures.
     *
     * @remarks
     * 1.10 counted its idle polls here (every 15 ms or so while the scene
     * had no updates). v2's loop does not poll: while it sleeps it runs no
     * frame at all, so an idle interval reports 0 here and 0
     * {@link renderedFrames}.
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
     * Frame time distribution behind {@link fps}, as a count per bucket.
     *
     * @remarks
     * Length is {@link FRAME_TIME_BUCKET_COUNT}; use
     * {@link frameTimeBucketLowerBound} to map an index to its millisecond
     * range. Covers exactly the frames behind {@link fps} and
     * {@link renderedMs}, so the frames that drew nothing and the frame that
     * resumes drawing after them are excluded and the buckets sum to that
     * paired frame count rather than to {@link renderedFrames}.
     *
     * Report percentiles from this rather than an average: p95 and p99 frame
     * time are what a viewer experiences as jank, and both are invisible in
     * {@link fps}.
     */
    frameTimeBuckets: number[];
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
     * Longest frame in the sample, in milliseconds. `0` when nothing rendered.
     *
     * @remarks
     * Exact, unlike a percentile read off {@link frameTimeBuckets}, and the only
     * way to see past the overflow bucket, which lumps a 130ms frame together
     * with a multi-second one.
     */
    maxFrameTime: number;
    /**
     * Longest animated frame in the interval, in milliseconds. `0` when none
     * were sampled. See {@link maxFrameTime}.
     */
    animatedMaxFrameTime: number;
    /**
     * Milliseconds spent in the scene walks (update, cull and emit, with any
     * chunk drawn mid-walk), summed across the interval's
     * {@link renderedFrames}.
     *
     * @remarks
     * {@link updateMs}, {@link renderMs} and {@link uploadMs} split a drawn
     * frame's work three ways, which is what turns "this build is 12%
     * slower" into a cause. The animation step runs before the walk and is
     * reported separately, as {@link meanActiveAnimations}.
     *
     * These cover every drawn frame, not the paired subset behind
     * {@link fps}: the phases are timed directly around the work rather than
     * inferred from frame deltas, so the frame that resumes drawing after an
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
     * Milliseconds spent on the draw (the vertex upload and the draw calls)
     * and on starting the texture loads after it, summed across the
     * interval's {@link renderedFrames}. See {@link updateMs}.
     */
    renderMs: number;
    /**
     * Milliseconds spent uploading decoded textures, summed across every
     * frame of the interval that ran the uploader, drawn or not (a frame
     * that only uploads draws nothing). See {@link updateMs}.
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
     * Longest single-frame draw (the vertex upload, the draw calls and the
     * texture loads started after them) in the interval, in milliseconds.
     * See {@link maxUpdateMs}.
     */
    maxRenderMs: number;
    /**
     * Longest single-frame texture upload in the interval, in milliseconds. See
     * {@link maxUpdateMs}.
     *
     * @remarks
     * A frame's uploads stop at `textureProcessingTimeLimit`, and while
     * animating a large texture waits behind the smaller ones, so a spike here
     * is usually one large `texImage2D` on the device: compare it against
     * your source image dimensions.
     */
    maxUploadMs: number;
    /**
     * Texture uploads that ran during the interval.
     *
     * @remarks
     * The denominator that makes {@link uploadMs} actionable: `uploadMs /
     * uploadedTextures` is the mean cost of one `texImage2D` on the device,
     * whether a frame uploaded several textures or one. Compare it against
     * your source image dimensions when frames spike.
     *
     * A texture whose upload failed (larger than the device's
     * `MAX_TEXTURE_SIZE`, or one that threw) counts: it cost the attempt. A
     * decoded texture released because nobody wanted it any more moved no
     * bytes and does not.
     */
    uploadedTextures: number;
    /**
     * Frames during the interval that ran the uploader with decoded textures
     * waiting, drawn or not.
     *
     * @remarks
     * Counts frames whether or not an upload ran in them (one may have waited
     * for room in memory): {@link uploadedTextures} counts the uploads that
     * ran. `uploadMs / uploadFrames` is the mean upload cost of a frame that
     * did any, rather than an average smeared across frames that uploaded
     * nothing.
     */
    uploadFrames: number;
    /**
     * Most decoded textures waiting for upload during the interval, measured
     * at the start of each frame's uploads.
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
     * Sampled once per drawn frame, after its animation step, so it shares
     * the {@link renderedFrames} denominator with the phase totals. `0` when
     * nothing was drawn.
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
     * Quads drawn in the most recent drawn frame, glyph quads not included
     * (1.10 kept glyphs in a buffer of their own and did not count them).
     */
    quads: number;
    /**
     * Ops (draw calls) issued in the most recent drawn frame, text ops
     * included.
     */
    renderOps: number;
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
     * Per-method context (i.e. WebGL) call counts over the interval, or `null`
     * when the context spy is off.
     *
     * @remarks
     * Populated only while `enableContextSpy` is set, which costs enough
     * performance that it is a debugging tool, not something to leave on. Keys
     * are context method names; values are the call count over the interval.
     */
    contextSpyData: Record<string, number> | null;
}
export interface FrameTickPayload {
    time: number;
    delta: number;
}
/**
 * The `renderUpdate` payload: the counts of the frame just drawn, emitted
 * when either changed and is not 0, while `fpsUpdateInterval` is above 0.
 */
export interface RenderUpdatePayload {
    quads: number;
    renderOps: number;
}
export interface MemoryInfo {
    criticalThreshold: number;
    targetThreshold: number;
    renderableMemUsed: number;
    memUsed: number;
    renderableTexturesLoaded: number;
    loadedTextures: number;
    baselineMemoryAllocation: number;
}
export interface RendererCapabilities {
    renderMode: 'webgl';
    webGlVersion: 1 | 2;
    vertexArrayObject: boolean;
    maxTextureSize: number;
    maxTextureUnits: number;
}
/** SDF font metrics in font units (spec 10.1). */
export interface FontMetrics {
    ascender: number;
    descender: number;
    lineGap: number;
    unitsPerEm: number;
    /** Baseline to the top of a capital (OS/2 sCapHeight); derived from glyph `H` when absent. */
    capHeight?: number;
    /** Baseline to the top of a lowercase letter (OS/2 sxHeight); derived from glyph `x` when absent. */
    xHeight?: number;
}
/** `renderer.loadFont` options (spec 10.1): an MSDF or SSDF atlas and its JSON. */
export interface FontLoadOptions {
    /**
     * The family a text node names, or several (1.10's array form): the
     * first is the font's own name, the rest are aliases, as in `aliases`.
     */
    fontFamily: string | string[];
    /** The atlas image. */
    atlasUrl: string;
    /** The atlas description (msdf-bmfont-xml JSON). */
    atlasDataUrl: string;
    /** Overrides the JSON's `lightningMetrics`. */
    metrics?: FontMetrics;
    /** More family names for the same font: one load, one atlas. */
    aliases?: string[];
}
