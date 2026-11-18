// `Event` and `EventTarget` (DOM Standard), without a tree: an event reaches
// the listeners of the target it is dispatched on and nothing else. Legacy
// members (`initEvent`, `returnValue`, `cancelBubble`, `srcElement`) and
// `CustomEvent` are not here.
import { DOMException } from './dom-exception.js';

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export type EventListener =
  | ((event: Event) => void)
  | { handleEvent(event: Event): void };

/** What `addEventListener` needs of an `AbortSignal`, ours or another. */
interface ListenerSignal {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options: { once: boolean },
  ): void;
}

export interface AddEventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: ListenerSignal;
}

interface Entry {
  readonly callback: EventListener;
  readonly capture: boolean;
  readonly once: boolean;
  readonly passive: boolean;
  removed: boolean;
}

/**
 * A subclass may define a method under this key: it is called when the first
 * listener of a type is added (`true`) and when the last one goes (`false`).
 * `AbortSignal` keeps a signal that somebody listens to alive with it.
 */
export const listenersChanged: unique symbol = Symbol('listenersChanged');

// Event flags.
const BUBBLES = 1;
const CANCELABLE = 2;
const COMPOSED = 4;
const STOP = 8;
const STOP_NOW = 16;
const CANCELED = 32;
const IN_PASSIVE = 64;
const DISPATCHING = 128;

// Each class hands the other what it needs of its private state.
let dispatch: (
  target: EventTarget,
  event: Event,
  entries: Entry[] | undefined,
) => boolean;
let removeEntry: (target: EventTarget, type: string, entry: Entry) => void;

export class Event {
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;
  declare readonly NONE: 0;
  declare readonly CAPTURING_PHASE: 1;
  declare readonly AT_TARGET: 2;
  declare readonly BUBBLING_PHASE: 3;

  readonly #type: string;
  readonly #time = performance.now();
  #flags: number;
  #phase = 0;
  #target: EventTarget | null = null;
  #current: EventTarget | null = null;

  constructor(type: string, init?: EventInit) {
    if (arguments.length === 0)
      throw new TypeError('Event: the type argument is required');
    this.#type = String(type);
    this.#flags =
      (init?.bubbles ? BUBBLES : 0) |
      (init?.cancelable ? CANCELABLE : 0) |
      (init?.composed ? COMPOSED : 0);
  }

  get type(): string {
    return this.#type;
  }
  get target(): EventTarget | null {
    return this.#target;
  }
  get currentTarget(): EventTarget | null {
    return this.#current;
  }
  get eventPhase(): number {
    return this.#phase;
  }
  get bubbles(): boolean {
    return (this.#flags & BUBBLES) !== 0;
  }
  get cancelable(): boolean {
    return (this.#flags & CANCELABLE) !== 0;
  }
  get composed(): boolean {
    return (this.#flags & COMPOSED) !== 0;
  }
  get defaultPrevented(): boolean {
    return (this.#flags & CANCELED) !== 0;
  }
  /** Always false: every event here is made by a script. */
  get isTrusted(): boolean {
    return false;
  }
  get timeStamp(): number {
    return this.#time;
  }
  get [Symbol.toStringTag](): string {
    return 'Event';
  }

  composedPath(): EventTarget[] {
    return this.#current === null ? [] : [this.#current];
  }
  stopPropagation(): void {
    this.#flags |= STOP;
  }
  stopImmediatePropagation(): void {
    this.#flags |= STOP | STOP_NOW;
  }
  preventDefault(): void {
    if ((this.#flags & (CANCELABLE | IN_PASSIVE)) === CANCELABLE)
      this.#flags |= CANCELED;
  }

  static {
    for (const [name, value] of Object.entries(Event))
      Object.defineProperty(Event.prototype, name, { value, enumerable: true });

    dispatch = (target, event, entries) => {
      if (event.#flags & DISPATCHING)
        throw new DOMException(
          'The event is already being dispatched',
          'InvalidStateError',
        );
      event.#flags |= DISPATCHING;
      event.#target = event.#current = target;
      event.#phase = Event.AT_TARGET;
      // `entries` is never changed in place, so listeners added while it is
      // walked are not called and removed ones are told by their flag.
      // Capturing listeners first, as at any target.
      if (entries !== undefined)
        passes: for (let pass = 0; pass < 2; pass++) {
          if (event.#flags & STOP) break;
          for (const entry of entries) {
            if (entry.removed || entry.capture !== (pass === 0)) continue;
            if (entry.once) removeEntry(target, event.#type, entry);
            if (entry.passive) event.#flags |= IN_PASSIVE;
            try {
              const callback = entry.callback;
              if (typeof callback === 'function') callback.call(target, event);
              else callback.handleEvent(event);
            } catch (error) {
              // "Report the exception": the other listeners still run.
              console.error(error);
            }
            event.#flags &= ~IN_PASSIVE;
            if (event.#flags & STOP_NOW) break passes;
          }
        }
      event.#phase = Event.NONE;
      event.#current = null;
      event.#flags &= ~(DISPATCHING | STOP | STOP_NOW);
      return !(event.#flags & CANCELED);
    };
  }
}

export class EventTarget {
  #listeners?: Map<string, Entry[]>;

  [listenersChanged]?(type: string, present: boolean): void;

  addEventListener(
    type: string,
    callback: EventListener | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (callback === null || callback === undefined) return;
    const flags: AddEventListenerOptions =
      typeof options === 'object' && options !== null ? options : {};
    const capture = typeof options === 'boolean' ? options : !!flags.capture;
    const signal = flags.signal;
    if (signal?.aborted) return;
    const listeners = (this.#listeners ??= new Map<string, Entry[]>());
    const entries = listeners.get(type);
    if (entries?.some((e) => e.callback === callback && e.capture === capture))
      return;
    const entry: Entry = {
      callback,
      capture,
      once: !!flags.once,
      passive: !!flags.passive,
      removed: false,
    };
    listeners.set(type, entries === undefined ? [entry] : [...entries, entry]);
    if (entries === undefined) this[listenersChanged]?.(type, true);
    signal?.addEventListener('abort', () => removeEntry(this, type, entry), {
      once: true,
    });
  }

  removeEventListener(
    type: string,
    callback: EventListener | null,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const entry = this.#listeners
      ?.get(type)
      ?.find((e) => e.callback === callback && e.capture === capture);
    if (entry !== undefined) removeEntry(this, type, entry);
  }

  dispatchEvent(event: Event): boolean {
    if (!(event instanceof Event))
      throw new TypeError(
        'EventTarget.dispatchEvent: the argument is not an Event',
      );
    return dispatch(this, event, this.#listeners?.get(event.type));
  }

  get [Symbol.toStringTag](): string {
    return 'EventTarget';
  }

  static {
    removeEntry = (target, type, entry) => {
      if (entry.removed) return;
      entry.removed = true;
      const listeners = target.#listeners!;
      const rest = listeners.get(type)!.filter((e) => e !== entry);
      if (rest.length > 0) {
        listeners.set(type, rest);
      } else {
        listeners.delete(type);
        target[listenersChanged]?.(type, false);
      }
    };
  }
}
