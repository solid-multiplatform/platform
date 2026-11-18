import type { EventEmitter } from '../common/EventEmitter.js';

/**
 * App-facing events raised while a frame runs (a node's or a texture's
 * `loaded`, `failed` and `freed`, the memory events), delivered after the
 * draw, as 1.10's queueFrameEvent / flushFrameEvents did, so app code never
 * runs in the middle of a walk over slots the walk is using or freeing.
 * That is RendererCore's `events`. Its `textEvents` (a text's `loaded`) is
 * another queue, which `update()` flushes between the frame's walks rather
 * than after the draw: outside a walk too, and before the re-walk decision,
 * so what a listener writes is drawn in the same frame.
 *
 * A flush delivers the events queued before it started, in queue order. An
 * event a listener queues during a flush waits for the next flush, and a
 * flush called from a listener (renderer.cleanup() in a
 * criticalCleanupFailed listener) returns at once, its events waiting too,
 * so a flush never recurses; so does one called while a frame holds its
 * events, which its own flush delivers after the draw. A listener that
 * throws is reported to `onError` and the flush goes on (headless, with no
 * `onError`, the error propagates and the rest of its batch goes out with
 * the next flush). Outside a frame and outside a flush (a retry timer, an
 * idle cleanup) a queued event schedules a flush of its own through
 * `schedule`, so delivering it costs no walk and no draw. One a listener
 * queues schedules nothing: a listener that raises the event it listens to
 * (a cleanup that fails again) would otherwise spin on timers, so it waits
 * for the next flush, as 1.10's queued events waited for the next frame.
 */
export class FrameEvents {
  /**
   * Set while a frame runs, until its flush (the Renderer): events queued
   * meanwhile wait for that flush instead of scheduling one.
   */
  holding = false;
  /**
   * Runs `callback` soon, outside the current task (the Renderer: a
   * zero-delay timer). Null (headless): flushes only when called.
   */
  schedule: ((callback: () => void) => void) | null = null;
  /**
   * Receives what a listener threw (the Renderer: the loop's
   * handleLoopError), and the flush goes on with the next event. It must
   * not throw: what escapes it escapes the flush, and the rest of the batch
   * waits for the next one (the Renderer raises a rethrow again from a
   * timer of its own).
   */
  onError: ((error: unknown) => void) | null = null;
  private targets: (EventEmitter | null)[] = [];
  private names: string[] = [];
  private data: unknown[] = [];
  /** Events [head, tail) wait for delivery. */
  private head = 0;
  private tail = 0;
  private flushing = false;
  private scheduled = false;
  /** destroy() ran: nothing is queued, and a flush in progress stops. */
  private destroyed = false;
  private readonly scheduledFlush = (): void => {
    this.scheduled = false;
    this.flush();
  };

  /** Events waiting for delivery. */
  get count(): number {
    return this.tail - this.head;
  }

  queue(target: EventEmitter, name: string, data: unknown): void {
    if (this.destroyed === true) {
      return;
    }
    const i = this.tail;
    if (i === this.targets.length) {
      this.targets.push(target);
      this.names.push(name);
      this.data.push(data);
    } else {
      this.targets[i] = target;
      this.names[i] = name;
      this.data[i] = data;
    }
    this.tail = i + 1;
    if (
      this.holding === false &&
      this.flushing === false &&
      this.scheduled === false &&
      this.schedule !== null
    ) {
      this.scheduled = true;
      this.schedule(this.scheduledFlush);
    }
  }

  /**
   * Emit the events queued so far, in queue order. A nested call returns at
   * once, and so does one while a frame holds its events.
   */
  flush(): void {
    // Most drawn frames raise no event: no try/finally to enter for them.
    if (this.head === this.tail) {
      return;
    }
    if (this.flushing === true || this.holding === true) {
      return;
    }
    this.flushing = true;
    try {
      this.drain();
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The delivery loop, kept out of flush's try/finally so that it stays
   * optimizable (Crankshaft, the optimizer up to Chrome 58, gives up on a
   * function that contains one).
   */
  private drain(): void {
    const end = this.tail;
    const targets = this.targets;
    const names = this.names;
    const data = this.data;
    while (this.head < end) {
      const i = this.head;
      // Advanced before the emit: a throwing listener loses no other
      // event, since the rest of the batch waits for the next flush.
      this.head = i + 1;
      const target = targets[i]!;
      const payload = data[i];
      // Dropped before the emit: nothing outlives its delivery here.
      targets[i] = null;
      data[i] = null;
      this.deliver(target, names[i]!, payload);
      // The listener destroyed the renderer: destroy() dropped the rest of
      // the batch and reset the indexes, so `end` no longer means anything.
      if (this.destroyed === true) {
        return;
      }
    }
    // Events queued during this flush move to the front, for the next one.
    const tail = this.tail;
    let w = 0;
    for (let r = end; r < tail; r++) {
      targets[w] = targets[r]!;
      names[w] = names[r]!;
      data[w] = data[r];
      targets[r] = null;
      data[r] = null;
      w++;
    }
    this.head = 0;
    this.tail = w;
  }

  /**
   * One emit, in a try/catch shell of its own, outside drain for the same
   * reason as flush's: a listener's error goes to onError and the flush goes
   * on, so it never escapes from a timer and never leaves the rest of its
   * batch queued, flush after flush.
   */
  private deliver(target: EventEmitter, name: string, data: unknown): void {
    const onError = this.onError;
    if (onError === null) {
      target.emit(name, data);
      return;
    }
    try {
      target.emit(name, data);
    } catch (error) {
      onError(error);
    }
  }

  /**
   * Renderer.destroy: drop what is queued, and queue and schedule nothing
   * more. Called from a listener, the flush stops after that listener.
   */
  destroy(): void {
    this.destroyed = true;
    this.schedule = null;
    const targets = this.targets;
    const data = this.data;
    for (let i = this.head; i < this.tail; i++) {
      targets[i] = null;
      data[i] = null;
    }
    this.head = 0;
    this.tail = 0;
  }
}
