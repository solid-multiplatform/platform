/**
 * The part of `KeyboardEvent` a focus manager reads, raised by
 * {@link KeyBridge} on hosts that have no DOM to raise the real thing.
 */
export interface KeyBridgeEvent {
  /** `keydown` or `keyup`. */
  readonly type: string;
  /** DOM key name: `ArrowLeft`, `Enter`, `Backspace`, ... */
  readonly key: string;
  /** Legacy key code for the key, 0 when unknown. */
  readonly keyCode: number;
  /** True on the key-downs a held key repeats. */
  readonly repeat: boolean;
  /** Milliseconds on the `performance.now()` clock. */
  readonly timeStamp: number;
  /** Set by {@link KeyBridgeEvent.preventDefault}. */
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

export type KeyBridgeEventType = 'keydown' | 'keyup';

export type KeyBridgeListener = (event: KeyBridgeEvent) => void;

/** Where {@link KeyBridgeOptions.target} takes the bridge's events. */
export interface KeyBridgeTarget {
  dispatchEvent(event: KeyBridgeEvent): boolean;
}

export interface KeyBridgeOptions {
  /**
   * Milliseconds a key is held before its first repeat. 0 turns repeats off.
   * Default 400.
   */
  repeatDelay?: number;
  /** Milliseconds between repeats. Default 80. */
  repeatInterval?: number;
  /**
   * An event target every event is also dispatched to, after the bridge's
   * own listeners: `document`, for a focus manager that listens there as a
   * browser app's does. Its listeners get the same event object, so a
   * `preventDefault()` there counts too.
   */
  target?: KeyBridgeTarget;
}

/**
 * Legacy `keyCode` values for the key names a TV remote produces, for
 * listeners that identify keys by code.
 */
export const KEY_CODES: Readonly<Record<string, number>> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  Backspace: 8,
  Escape: 27,
  ' ': 32,
  MediaPlayPause: 179,
};

const DEFAULT_REPEAT_DELAY = 400;
const DEFAULT_REPEAT_INTERVAL = 80;

const codeOf = (key: string): number => {
  const code = KEY_CODES[key];
  return code === undefined ? 0 : code;
};

class KeyEvent implements KeyBridgeEvent {
  defaultPrevented = false;

  constructor(
    readonly type: KeyBridgeEventType,
    readonly key: string,
    readonly keyCode: number,
    readonly repeat: boolean,
    readonly timeStamp: number,
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class HeldKey {
  timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly key: string,
    readonly keyCode: number,
    readonly tick: () => void,
  ) {}
}

/**
 * Turns native presses into key events for a focus manager.
 *
 * @remarks
 * The host calls {@link KeyBridge.down} when a press starts and
 * {@link KeyBridge.up} when it ends; the bridge raises `keydown` and `keyup`
 * events on the listeners it was given, shaped like a browser's. While a key
 * is down it repeats the `keydown` with `repeat` set, keyboard style: first
 * after `repeatDelay`, then every `repeatInterval`, so hold logic written
 * against browser auto-repeat works unchanged. Which native input maps to
 * which key name is the host's business; a Menu button is `Backspace`, the
 * name SolidTV maps to `Back`.
 *
 * The bridge is the event target: pass it where a focus manager would take
 * `document`.
 *
 * `down`, `up` and `tap` return what `dispatchEvent` would: `false` when a
 * listener called `preventDefault()`, so the host can tell an unhandled press
 * from a consumed one.
 */
export class KeyBridge {
  readonly repeatDelay: number;
  readonly repeatInterval: number;
  private readonly target: KeyBridgeTarget | null;
  private readonly keydownListeners: KeyBridgeListener[] = [];
  private readonly keyupListeners: KeyBridgeListener[] = [];
  private readonly held: HeldKey[] = [];

  constructor(options?: KeyBridgeOptions) {
    this.repeatDelay =
      options === undefined || options.repeatDelay === undefined
        ? DEFAULT_REPEAT_DELAY
        : options.repeatDelay;
    this.repeatInterval =
      options === undefined || options.repeatInterval === undefined
        ? DEFAULT_REPEAT_INTERVAL
        : options.repeatInterval;
    this.target =
      options === undefined || options.target === undefined
        ? null
        : options.target;
  }

  addEventListener(
    type: KeyBridgeEventType,
    listener: KeyBridgeListener,
  ): void {
    const list =
      type === 'keydown' ? this.keydownListeners : this.keyupListeners;
    if (list.indexOf(listener) !== -1) {
      return;
    }
    list.push(listener);
  }

  removeEventListener(
    type: KeyBridgeEventType,
    listener: KeyBridgeListener,
  ): void {
    const list =
      type === 'keydown' ? this.keydownListeners : this.keyupListeners;
    const index = list.indexOf(listener);
    if (index === -1) {
      return;
    }
    list.splice(index, 1);
  }

  /**
   * A press started. Raises `keydown` and starts the repeat timer. A key
   * that is already down starts over as a fresh press.
   */
  down(key: string, keyCode?: number): boolean {
    const code = keyCode === undefined ? codeOf(key) : keyCode;
    let entry = this.find(key);
    if (entry === null) {
      const created: HeldKey = new HeldKey(key, code, () => {
        this.repeat(created);
      });
      entry = created;
      this.held.push(entry);
    } else {
      this.stopTimer(entry);
    }
    if (this.repeatDelay > 0) {
      entry.timer = setTimeout(entry.tick, this.repeatDelay);
    }
    return this.dispatch('keydown', key, code, false);
  }

  /** A press ended. Stops its repeats and raises `keyup`. */
  up(key: string, keyCode?: number): boolean {
    let code = keyCode;
    const entry = this.find(key);
    if (entry !== null) {
      this.stopTimer(entry);
      this.held.splice(this.held.indexOf(entry), 1);
      if (code === undefined) {
        code = entry.keyCode;
      }
    }
    return this.dispatch(
      'keyup',
      key,
      code === undefined ? codeOf(key) : code,
      false,
    );
  }

  /** A press with no hold: `down` then `up`. Returns the `down` result. */
  tap(key: string, keyCode?: number): boolean {
    const result = this.down(key, keyCode);
    this.up(key, keyCode);
    return result;
  }

  /** Whether `key` is between `down` and `up`. */
  isDown(key: string): boolean {
    return this.find(key) !== null;
  }

  /**
   * Releases every held key, raising its `keyup`. For the host's suspend
   * event: a press that was down when the app left the foreground has no
   * release coming.
   */
  releaseAll(): void {
    while (this.held.length > 0) {
      const entry = this.held[this.held.length - 1] as HeldKey;
      this.up(entry.key, entry.keyCode);
    }
  }

  private find(key: string): HeldKey | null {
    const held = this.held;
    for (let i = 0; i < held.length; i++) {
      const entry = held[i] as HeldKey;
      if (entry.key === key) {
        return entry;
      }
    }
    return null;
  }

  private stopTimer(entry: HeldKey): void {
    if (entry.timer === null) {
      return;
    }
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  private repeat(entry: HeldKey): void {
    // Schedule before dispatching, so an `up` from inside a listener clears
    // this timer rather than racing a timer set after it.
    entry.timer = setTimeout(entry.tick, this.repeatInterval);
    this.dispatch('keydown', entry.key, entry.keyCode, true);
  }

  private dispatch(
    type: KeyBridgeEventType,
    key: string,
    keyCode: number,
    repeat: boolean,
  ): boolean {
    const event = new KeyEvent(type, key, keyCode, repeat, performance.now());
    // A copy: a listener may remove itself, or another, while this runs.
    const listeners = (
      type === 'keydown' ? this.keydownListeners : this.keyupListeners
    ).slice();
    for (let i = 0; i < listeners.length; i++) {
      (listeners[i] as KeyBridgeListener)(event);
    }
    if (this.target !== null) {
      this.target.dispatchEvent(event);
    }
    return event.defaultPrevented === false;
  }
}
