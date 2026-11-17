import type { EventEmitter } from '../common/EventEmitter.js';
import type { FrameEvents } from './FrameEvents.js';
import type { ContextSpy } from './gl/contextSpy.js';
/** The clock and timers telemetry reads (the platform's). */
export interface TelemetryClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): void;
}
/**
 * Frame telemetry (spec 12.5): 1.10's fps sampling, frame time histograms
 * and phase attribution, and its `fpsUpdate` and `renderUpdate` payloads.
 * The Renderer attaches one while `fpsUpdateInterval` is above 0 and none
 * otherwise, so nothing is sampled when it is off.
 *
 * 1.10 counted its idle polls apart from its rendered frames. v2's loop
 * does not poll (spec 12.1): the ticks that draw nothing are the frames it
 * runs for an animation's delay or for texture uploads alone, and while it
 * sleeps a timer closes the sample at the interval boundary, so `fpsUpdate`
 * keeps coming, as it did from 1.10's polls. While it is paused nothing is
 * sampled, as in 1.10. The interval is wall-clock time on the frame clock.
 *
 * Per frame it costs a few increments and compares; a payload is built
 * once per interval, and only with a listener.
 */
export declare class Telemetry {
    /** `fpsUpdateInterval` in effect, in ms. */
    interval: number;
    /** The label the samples carry (`setTelemetrySegment`). */
    segment: string;
    private readonly target;
    private readonly events;
    private readonly clock;
    private readonly spy;
    /** Frame-clock time the sample started at. */
    private sampleStart;
    /**
     * Continuity, not sample state: the previous tick drew. A drawn frame is
     * paired with its delta only after a drawn tick, so the frame that
     * resumes drawing after an undrawn frame or a sleep is not.
     */
    private lastTickRendered;
    /** Bumped by every tick and every timer queued: a stale timer does nothing. */
    private beat;
    /** The loop is paused (halt()): no timer is queued until idle(). */
    private halted;
    private stopped;
    private readonly heartbeat;
    private sampleFrames;
    private sampleElapsed;
    private renderedFrames;
    private idleTicks;
    private readonly buckets;
    private maxFrameTime;
    private animatedFrames;
    private animatedElapsed;
    private readonly animatedBuckets;
    private animatedMaxFrameTime;
    private animationSum;
    private maxAnimations;
    private uploadFrames;
    private updateMs;
    private renderMs;
    private uploadMs;
    private maxUpdateMs;
    private maxRenderMs;
    private maxUploadMs;
    private uploadedTextures;
    private maxUploadQueue;
    /** The last drawn frame's counts (what 1.10's payload read from its renderer). */
    private quads;
    private renderOps;
    /** What renderUpdate last reported. */
    private reportedQuads;
    private reportedOps;
    constructor(target: EventEmitter, events: FrameEvents, clock: TelemetryClock, spy: ContextSpy | null, interval: number, start: number);
    /**
     * A drawn frame's phases in ms (the walks, then the draw), its counts
     * (quads, glyph quads not included, and ops) and the animations still
     * running after its step. Called before tick(), which may close the
     * sample this frame belongs to.
     */
    drawn(updateMs: number, renderMs: number, quads: number, renderOps: number, activeAnimations: number): void;
    /**
     * The uploader ran, on a drawn frame or an upload-only one: `queued`
     * decoded textures waited, `uploaded` went up, in `ms`.
     */
    uploaded(queued: number, uploaded: number, ms: number): void;
    /**
     * One frame of the loop at frame-clock `time`, `dt` ms after the last:
     * drawn, or not (an animation's delay, an upload alone). Closes the
     * sample once the interval has passed, then reports a drawn frame's
     * counts to renderUpdate when they changed.
     */
    tick(time: number, dt: number, rendered: boolean, animating: boolean): void;
    /**
     * The loop went to sleep at frame-clock `time`, or resumed from a pause:
     * its next frame resumes drawing, and a timer closes the sample at the
     * interval boundary.
     */
    idle(time: number): void;
    /**
     * The loop paused: a timer still queued does nothing, and none is queued
     * until idle() (1.10 emitted nothing while paused).
     */
    halt(): void;
    /** Label the samples that follow, closing the one in progress under the old label. */
    relabel(label: string, time: number): void;
    /**
     * A new interval: the sample in progress is discarded, and the next one
     * closes on time even if no frame comes (halted, once idle() ends it).
     */
    restart(interval: number, time: number): void;
    /** Detached: a timer still queued does nothing. */
    stop(): void;
    /**
     * A drawn frame after a drawn tick: its delta goes into the rate and the
     * histogram, and into their animated subset when an animation ran in it.
     */
    private pair;
    private arm;
    /** Emit the sample (with a listener) and start the next one at `time`. */
    private close;
    /** The sample as 1.10 emitted it, field for field and in its order. */
    private payload;
    /** 1.10 calculateRenderInfo: the drawn counts, when they changed and are not zero. */
    private renderInfo;
    /**
     * Clear the sample's accumulators. Not lastTickRendered: that is about
     * the previous tick, and clearing it here would drop a frame from the
     * rate at every interval boundary.
     */
    private reset;
}
