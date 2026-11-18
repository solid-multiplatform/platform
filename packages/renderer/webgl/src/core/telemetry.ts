import type { EventEmitter } from '../common/EventEmitter.js';
import {
  FRAME_TIME_BUCKET_COUNT,
  frameTimeBucketIndex,
  type FpsUpdatePayload,
  type RenderUpdatePayload,
} from '../common/types.js';
import type { FrameEvents } from './FrameEvents.js';
import type { ContextSpy } from './gl/contextSpy.js';

/**
 * The longest a timer waits, in ms. A longer interval is waited out a
 * minute at a time: setTimeout runs Infinity at once and wraps a delay
 * past 2^31 - 1 around, and a queued timer keeps the renderer reachable
 * (the platform has no clearTimeout), so a destroyed one is let go within
 * a minute, for one wake-up a minute at most.
 */
const MAX_TIMER_DELAY = 60000;

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
export class Telemetry {
  /** `fpsUpdateInterval` in effect, in ms. */
  interval: number;
  /** The label the samples carry (`setTelemetrySegment`). */
  segment = '';

  private readonly target: EventEmitter;
  private readonly events: FrameEvents;
  private readonly clock: TelemetryClock;
  private readonly spy: ContextSpy | null;
  /** Frame-clock time the sample started at. */
  private sampleStart: number;
  /**
   * Continuity, not sample state: the previous tick drew. A drawn frame is
   * paired with its delta only after a drawn tick, so the frame that
   * resumes drawing after an undrawn frame or a sleep is not.
   */
  private lastTickRendered = false;
  /** Bumped by every tick and every timer queued: a stale timer does nothing. */
  private beat = 0;
  /** The loop is paused (halt()): no timer is queued until idle(). */
  private halted = false;
  private stopped = false;
  private readonly heartbeat = (token: number): void => {
    if (token !== this.beat || this.stopped === true) {
      return;
    }
    const now = this.clock.now();
    if (now - this.sampleStart >= this.interval) {
      this.close(now);
    }
    this.arm(now);
  };

  private sampleFrames = 0;
  private sampleElapsed = 0;
  private renderedFrames = 0;
  private idleTicks = 0;
  private readonly buckets = new Uint32Array(FRAME_TIME_BUCKET_COUNT);
  private maxFrameTime = 0;
  private animatedFrames = 0;
  private animatedElapsed = 0;
  private readonly animatedBuckets = new Uint32Array(FRAME_TIME_BUCKET_COUNT);
  private animatedMaxFrameTime = 0;
  private animationSum = 0;
  private maxAnimations = 0;
  private uploadFrames = 0;
  private updateMs = 0;
  private renderMs = 0;
  private uploadMs = 0;
  private maxUpdateMs = 0;
  private maxRenderMs = 0;
  private maxUploadMs = 0;
  private uploadedTextures = 0;
  private maxUploadQueue = 0;
  /** The last drawn frame's counts (what 1.10's payload read from its renderer). */
  private quads = 0;
  private renderOps = 0;
  /** What renderUpdate last reported. */
  private reportedQuads = 0;
  private reportedOps = 0;

  constructor(
    target: EventEmitter,
    events: FrameEvents,
    clock: TelemetryClock,
    spy: ContextSpy | null,
    interval: number,
    start: number,
  ) {
    this.target = target;
    this.events = events;
    this.clock = clock;
    this.spy = spy;
    this.interval = interval;
    this.sampleStart = start;
  }

  /**
   * A drawn frame's phases in ms (the walks, then the draw), its counts
   * (quads, glyph quads not included, and ops) and the animations still
   * running after its step. Called before tick(), which may close the
   * sample this frame belongs to.
   */
  drawn(
    updateMs: number,
    renderMs: number,
    quads: number,
    renderOps: number,
    activeAnimations: number,
  ): void {
    this.updateMs += updateMs;
    this.renderMs += renderMs;
    if (updateMs > this.maxUpdateMs) {
      this.maxUpdateMs = updateMs;
    }
    if (renderMs > this.maxRenderMs) {
      this.maxRenderMs = renderMs;
    }
    this.animationSum += activeAnimations;
    if (activeAnimations > this.maxAnimations) {
      this.maxAnimations = activeAnimations;
    }
    this.quads = quads;
    this.renderOps = renderOps;
  }

  /**
   * The uploader ran, on a drawn frame or an upload-only one: `queued`
   * decoded textures waited, `uploaded` went up, in `ms`.
   */
  uploaded(queued: number, uploaded: number, ms: number): void {
    this.uploadFrames++;
    this.uploadedTextures += uploaded;
    this.uploadMs += ms;
    if (ms > this.maxUploadMs) {
      this.maxUploadMs = ms;
    }
    if (queued > this.maxUploadQueue) {
      this.maxUploadQueue = queued;
    }
  }

  /**
   * One frame of the loop at frame-clock `time`, `dt` ms after the last:
   * drawn, or not (an animation's delay, an upload alone). Closes the
   * sample once the interval has passed, then reports a drawn frame's
   * counts to renderUpdate when they changed.
   */
  tick(time: number, dt: number, rendered: boolean, animating: boolean): void {
    this.beat++;
    if (rendered === true) {
      this.renderedFrames++;
      if (this.lastTickRendered === true) {
        this.pair(dt, animating);
      }
    } else {
      this.idleTicks++;
    }
    this.lastTickRendered = rendered;
    if (time - this.sampleStart >= this.interval) {
      this.close(time);
    }
    if (rendered === true) {
      this.renderInfo();
    }
  }

  /**
   * The loop went to sleep at frame-clock `time`, or resumed from a pause:
   * its next frame resumes drawing, and a timer closes the sample at the
   * interval boundary.
   */
  idle(time: number): void {
    this.lastTickRendered = false;
    this.halted = false;
    this.arm(time);
  }

  /**
   * The loop paused: a timer still queued does nothing, and none is queued
   * until idle() (1.10 emitted nothing while paused).
   */
  halt(): void {
    this.halted = true;
    this.beat++;
  }

  /** Label the samples that follow, closing the one in progress under the old label. */
  relabel(label: string, time: number): void {
    if (label === this.segment) {
      return;
    }
    // Nothing measured yet means nothing worth emitting.
    if (this.renderedFrames > 0 || this.idleTicks > 0) {
      this.close(time);
    }
    this.segment = label;
  }

  /**
   * A new interval: the sample in progress is discarded, and the next one
   * closes on time even if no frame comes (halted, once idle() ends it).
   */
  restart(interval: number, time: number): void {
    this.interval = interval;
    this.reset();
    this.sampleStart = time;
    this.arm(time);
  }

  /** Detached: a timer still queued does nothing. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * A drawn frame after a drawn tick: its delta goes into the rate and the
   * histogram, and into their animated subset when an animation ran in it.
   */
  private pair(dt: number, animating: boolean): void {
    this.sampleFrames++;
    this.sampleElapsed += dt;
    const bucket = frameTimeBucketIndex(dt);
    const buckets = this.buckets;
    buckets[bucket] = buckets[bucket]! + 1;
    if (dt > this.maxFrameTime) {
      this.maxFrameTime = dt;
    }
    if (animating === false) {
      return;
    }
    this.animatedFrames++;
    this.animatedElapsed += dt;
    const animated = this.animatedBuckets;
    animated[bucket] = animated[bucket]! + 1;
    if (dt > this.animatedMaxFrameTime) {
      this.animatedMaxFrameTime = dt;
    }
  }

  private arm(time: number): void {
    if (this.halted === true) {
      return;
    }
    const token = ++this.beat;
    // A wait over a minute (an interval of Infinity) is capped: the timer
    // that ends it finds the interval still running and waits again, for
    // what is left of it.
    const wait = this.sampleStart + this.interval - time;
    this.clock.setTimeout(
      () => this.heartbeat(token),
      wait > 0 ? Math.min(wait, MAX_TIMER_DELAY) : 0,
    );
  }

  /** Emit the sample (with a listener) and start the next one at `time`. */
  private close(time: number): void {
    if (this.target.hasListener('fpsUpdate') === true) {
      this.events.queue(this.target, 'fpsUpdate', this.payload());
    }
    const spy = this.spy;
    if (spy !== null) {
      spy.reset();
    }
    this.reset();
    this.sampleStart = time;
  }

  /** The sample as 1.10 emitted it, field for field and in its order. */
  private payload(): FpsUpdatePayload {
    // The consumer keeps the arrays: fresh ones, once per interval.
    const frameTimeBuckets = new Array<number>(FRAME_TIME_BUCKET_COUNT);
    const animatedFrameTimeBuckets = new Array<number>(FRAME_TIME_BUCKET_COUNT);
    for (let i = 0; i < FRAME_TIME_BUCKET_COUNT; i++) {
      frameTimeBuckets[i] = this.buckets[i]!;
      animatedFrameTimeBuckets[i] = this.animatedBuckets[i]!;
    }
    const renderedFrames = this.renderedFrames;
    const spy = this.spy;
    return {
      fps:
        this.sampleElapsed > 0
          ? Math.round((this.sampleFrames * 1000) / this.sampleElapsed)
          : 0,
      sampledFrames: this.sampleFrames,
      renderedFrames,
      idleTicks: this.idleTicks,
      renderedMs: this.sampleElapsed,
      frameTimeBuckets,
      maxFrameTime: this.maxFrameTime,
      animatedFps:
        this.animatedElapsed > 0
          ? Math.round((this.animatedFrames * 1000) / this.animatedElapsed)
          : 0,
      animatedFrames: this.animatedFrames,
      animatedMs: this.animatedElapsed,
      animatedFrameTimeBuckets,
      animatedMaxFrameTime: this.animatedMaxFrameTime,
      segment: this.segment,
      meanActiveAnimations:
        renderedFrames > 0 ? this.animationSum / renderedFrames : 0,
      maxActiveAnimations: this.maxAnimations,
      updateMs: this.updateMs,
      renderMs: this.renderMs,
      uploadMs: this.uploadMs,
      maxUpdateMs: this.maxUpdateMs,
      maxRenderMs: this.maxRenderMs,
      maxUploadMs: this.maxUploadMs,
      uploadFrames: this.uploadFrames,
      uploadedTextures: this.uploadedTextures,
      maxUploadQueueSize: this.maxUploadQueue,
      // Live in the spy until its reset swaps in a new object, so handing
      // it over copies nothing.
      contextSpyData: spy !== null ? spy.data : null,
      renderOps: this.renderOps,
      quads: this.quads,
    };
  }

  /** 1.10 calculateRenderInfo: the drawn counts, when they changed and are not zero. */
  private renderInfo(): void {
    const quads = this.quads;
    const ops = this.renderOps;
    if (
      (quads !== 0 && quads !== this.reportedQuads) ||
      (ops !== 0 && ops !== this.reportedOps)
    ) {
      this.reportedQuads = quads;
      this.reportedOps = ops;
      if (this.target.hasListener('renderUpdate') === true) {
        const payload: RenderUpdatePayload = { quads, renderOps: ops };
        this.events.queue(this.target, 'renderUpdate', payload);
      }
    }
  }

  /**
   * Clear the sample's accumulators. Not lastTickRendered: that is about
   * the previous tick, and clearing it here would drop a frame from the
   * rate at every interval boundary.
   */
  private reset(): void {
    this.sampleFrames = 0;
    this.sampleElapsed = 0;
    this.renderedFrames = 0;
    this.idleTicks = 0;
    this.maxFrameTime = 0;
    this.animatedFrames = 0;
    this.animatedElapsed = 0;
    this.animatedMaxFrameTime = 0;
    this.animationSum = 0;
    this.maxAnimations = 0;
    this.uploadFrames = 0;
    this.updateMs = 0;
    this.renderMs = 0;
    this.uploadMs = 0;
    this.maxUpdateMs = 0;
    this.maxRenderMs = 0;
    this.maxUploadMs = 0;
    this.uploadedTextures = 0;
    this.maxUploadQueue = 0;
    // A loop: typed-array fill is Chrome 45, above the Chrome 38 floor.
    const buckets = this.buckets;
    const animatedBuckets = this.animatedBuckets;
    for (let i = 0; i < FRAME_TIME_BUCKET_COUNT; i++) {
      buckets[i] = 0;
      animatedBuckets[i] = 0;
    }
  }
}
