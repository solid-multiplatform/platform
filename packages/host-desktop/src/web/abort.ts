// `AbortController` and `AbortSignal` (DOM Standard).
import { DOMException } from './dom-exception.js';
import { Event, EventTarget, listenersChanged } from './events.js';

type AbortHandler = (this: AbortSignal, event: Event) => unknown;

// Only this module can construct a signal.
const KEY = {};

let signalAbort: (signal: AbortSignal, reason: unknown) => void;

export class AbortSignal extends EventTarget {
  // Undefined until aborted: an abort without a reason gets an `AbortError`.
  #reason: unknown = undefined;
  #onabort: AbortHandler | null = null;
  #handlerAdded = false;
  // `any()` makes a dependent signal. It names its sources; a source holds
  // its dependents weakly, so a long-lived signal does not collect every
  // signal ever combined with it, and strongly (`#kept`) while a dependent
  // has `abort` listeners, which nothing else may be holding.
  #sources?: AbortSignal[];
  #dependents?: Set<WeakRef<AbortSignal>>;
  #kept?: Set<AbortSignal>;

  constructor(key?: unknown) {
    if (key !== KEY) throw new TypeError('AbortSignal: illegal constructor');
    super();
  }

  static abort(reason?: unknown): AbortSignal {
    const signal = new AbortSignal(KEY);
    signalAbort(signal, reason);
    return signal;
  }

  /** The timer is the only work, and it ends when it fires. */
  static timeout(milliseconds: number): AbortSignal {
    const delay = Number(milliseconds);
    if (!(delay >= 0 && delay < Infinity))
      throw new TypeError(
        `AbortSignal.timeout: ${String(milliseconds)} is not a duration`,
      );
    const signal = new AbortSignal(KEY);
    setTimeout(
      () =>
        signalAbort(
          signal,
          new DOMException('The operation timed out', 'TimeoutError'),
        ),
      delay,
    );
    return signal;
  }

  static any(signals: Iterable<AbortSignal>): AbortSignal {
    const result = new AbortSignal(KEY);
    const list = Array.from(signals);
    for (const signal of list) {
      if (!(#reason in signal))
        throw new TypeError('AbortSignal.any: not an AbortSignal');
      if (signal.#reason !== undefined) {
        result.#reason = signal.#reason;
        return result;
      }
    }
    const sources: AbortSignal[] = (result.#sources = []);
    for (const signal of list)
      // A dependent signal never aborts by itself: its sources are followed.
      for (const source of signal.#sources ?? [signal]) {
        if (sources.includes(source)) continue;
        sources.push(source);
        const dependents = (source.#dependents ??= new Set());
        // Drops the references to signals that are gone, at sizes that keep
        // the cost of doing so constant per signal added.
        const size = dependents.size;
        if (size >= 16 && (size & (size - 1)) === 0)
          for (const ref of dependents) {
            const dependent = ref.deref();
            if (dependent === undefined || dependent.#sources === undefined)
              dependents.delete(ref);
          }
        dependents.add(new WeakRef(result));
      }
    return result;
  }

  get aborted(): boolean {
    return this.#reason !== undefined;
  }

  get reason(): unknown {
    return this.#reason;
  }

  throwIfAborted(): void {
    if (this.#reason !== undefined) throw this.#reason;
  }

  get onabort(): AbortHandler | null {
    return this.#onabort;
  }

  set onabort(handler: AbortHandler | null) {
    this.#onabort = typeof handler === 'function' ? handler : null;
    // The handler keeps the place among the listeners it first got.
    if (this.#onabort !== null && !this.#handlerAdded) {
      this.#handlerAdded = true;
      this.addEventListener('abort', (event) =>
        this.#onabort?.call(this, event),
      );
    }
  }

  override [listenersChanged](type: string, present: boolean): void {
    if (type !== 'abort' || this.#sources === undefined) return;
    for (const source of this.#sources)
      if (present) (source.#kept ??= new Set()).add(this);
      else source.#kept?.delete(this);
  }

  override get [Symbol.toStringTag](): string {
    return 'AbortSignal';
  }

  static {
    signalAbort = (signal, reason) => {
      if (signal.#reason !== undefined) return;
      signal.#reason =
        reason !== undefined
          ? reason
          : new DOMException('The operation was aborted', 'AbortError');
      // Every signal is marked before any listener runs.
      const aborted = [signal];
      if (signal.#dependents !== undefined)
        for (const ref of signal.#dependents) {
          const dependent = ref.deref();
          if (dependent !== undefined && dependent.#reason === undefined) {
            dependent.#reason = signal.#reason;
            aborted.push(dependent);
          }
        }
      signal.#dependents = signal.#kept = undefined;
      for (const each of aborted) {
        if (each.#sources !== undefined)
          for (const source of each.#sources) source.#kept?.delete(each);
        each.#sources = undefined;
        each.dispatchEvent(new Event('abort'));
      }
    };
  }
}

export class AbortController {
  readonly #signal = new AbortSignal(KEY);

  get signal(): AbortSignal {
    return this.#signal;
  }

  abort(reason?: unknown): void {
    signalAbort(this.#signal, reason);
  }

  get [Symbol.toStringTag](): string {
    return 'AbortController';
  }
}
