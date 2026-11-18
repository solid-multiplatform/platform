import type { KeyBridge } from './KeyBridge.js';

/** A native view that takes gesture recognizers. */
export interface RemoteContainer {
  addGestureRecognizer(recognizer: object): void;
  removeGestureRecognizer(recognizer: object): void;
}

/**
 * The app's window, `Application.ios.window`. The recognizers go on its
 * root view controller's view: UIKit gathers a press's recognizers from
 * the views between the focused item and that view, and the window's own
 * see no press at all (measured on the tvOS 26.4 simulator). The focused
 * item is the Canvas view, which `@nativescript/canvas` makes focusable, so
 * every press has a responder, and the system gets what the recognizers
 * leave.
 */
export interface RemoteWindow extends RemoteContainer {
  rootViewController: { view: RemoteContainer } | null;
}

/** What {@link RemoteOptions.onPress} receives. */
export interface RemotePress {
  /** The key name the bridge received. */
  key: string;
  /**
   * `down` and `up` for a button held and released, `tap` for a button that
   * raises a press with no hold (play/pause), `swipe` for the touch surface.
   */
  phase: 'down' | 'up' | 'tap' | 'swipe';
  /** True when a listener called `preventDefault()`. */
  handled: boolean;
  /**
   * True when the press was left to the system: an unhandled
   * {@link RemoteOptions.passThrough} key.
   */
  passed: boolean;
}

export interface RemoteOptions {
  /**
   * Keys whose unhandled press goes to the system. Default `["Backspace"]`,
   * the Menu button: tvOS review expects Menu on a screen the app cannot
   * leave to return to the Home screen, and that is what the system does
   * with a Menu press no recognizer consumed. A press is handled when a
   * `keydown` listener called `preventDefault()`; SolidTV's focus manager
   * does not do that for a handler, so a Back handler that navigates calls
   * it itself.
   */
  passThrough?: readonly string[];
  /** Called after every press the remote delivers, for logging. */
  onPress?: (press: RemotePress) => void;
}

export interface RemoteBinding {
  /** Removes the recognizers from the view. */
  unbind(): void;
}

interface PressKey {
  /** `UIPressType`. */
  type: number;
  key: string;
  /** The press is delivered as a tap: no hold, no repeats. */
  tap: boolean;
}

/**
 * The Siri Remote's buttons by `UIPressType`, and the key each one is.
 * Menu is `Backspace`, the name SolidTV maps to `Back`; play/pause is a
 * tap, since a media key that repeated while held would surprise.
 */
const PRESS_KEYS: readonly PressKey[] = [
  { type: 0, key: 'ArrowUp', tap: false },
  { type: 1, key: 'ArrowDown', tap: false },
  { type: 2, key: 'ArrowLeft', tap: false },
  { type: 3, key: 'ArrowRight', tap: false },
  { type: 4, key: 'Enter', tap: false },
  { type: 5, key: 'Backspace', tap: false },
  { type: 6, key: 'MediaPlayPause', tap: true },
];

interface SwipeKey {
  /** `UISwipeGestureRecognizerDirection`. */
  direction: number;
  key: string;
}

/**
 * The touch surface's swipes by direction, each a tap of an arrow. Swipes
 * are not supported: these are a courtesy, unverified, and nothing depends
 * on them.
 */
const SWIPE_KEYS: readonly SwipeKey[] = [
  { direction: 1, key: 'ArrowRight' },
  { direction: 2, key: 'ArrowLeft' },
  { direction: 4, key: 'ArrowUp' },
  { direction: 8, key: 'ArrowDown' },
];

// UIGestureRecognizerState
const STATE_BEGAN = 1;
const STATE_ENDED = 3;
const STATE_CANCELLED = 4;
const STATE_FAILED = 5;

const DEFAULT_PASS_THROUGH: readonly string[] = ['Backspace'];

// The slice of the NativeScript iOS runtime this module touches, typed by
// the members used so the package carries no dependency on its typings and
// the tests can stand the globals in.

interface NativeArray<T> {
  readonly count: number;
  objectAtIndex(index: number): T;
}

interface NativeSet<T> {
  readonly allObjects: NativeArray<T>;
}

interface NativePress {
  readonly type: number;
}

interface NativeRecognizer {
  allowedPressTypes: number[];
  delegate: object | null;
  state: number;
}

interface NativeSwipeRecognizer extends NativeRecognizer {
  direction: number;
}

interface NativeClassOptions {
  name?: string;
  protocols?: object[];
  exposedMethods?: Record<string, { returns: unknown; params: unknown[] }>;
}

interface NativeClass<T extends object> {
  new (): T;
  alloc(): { initWithTargetAction(target: object, action: string): T };
  extend(methods: object, options?: NativeClassOptions): NativeClass<T>;
}

interface NativeRuntime {
  NSObject: NativeClass<object>;
  UIGestureRecognizer: NativeClass<NativeRecognizer>;
  UISwipeGestureRecognizer: NativeClass<NativeSwipeRecognizer>;
  UIGestureRecognizerDelegate: object;
  interop: { types: { void: unknown; id: unknown } };
}

function nativeRuntime(): NativeRuntime {
  const host = globalThis as unknown as Partial<NativeRuntime>;
  if (
    host.NSObject === undefined ||
    host.UIGestureRecognizer === undefined ||
    host.UISwipeGestureRecognizer === undefined ||
    host.UIGestureRecognizerDelegate === undefined ||
    host.interop === undefined
  ) {
    throw new Error(
      'bindRemote needs the NativeScript iOS or tvOS runtime: UIGestureRecognizer is not defined',
    );
  }
  return host as NativeRuntime;
}

/**
 * One button of the remote: what its recognizer tells the bridge. The
 * recognizer calls it from `pressesBegan`, `pressesEnded` and
 * `pressesCancelled`, and takes the state each returns.
 */
class PressChannel {
  private down = false;

  constructor(
    readonly type: number,
    readonly key: string,
    private readonly tap: boolean,
    private readonly passThrough: boolean,
    private readonly bridge: KeyBridge,
    private readonly report: (press: RemotePress) => void,
  ) {}

  began(): number {
    if (this.tap === true) {
      const handled = this.bridge.tap(this.key) === false;
      this.report({ key: this.key, phase: 'tap', handled, passed: false });
      return STATE_BEGAN;
    }
    const handled = this.bridge.down(this.key) === false;
    if (handled === false && this.passThrough === true) {
      // Nothing took it: fail, so the press reaches the responder chain and
      // the system as one no recognizer consumed. A failed recognizer is
      // not told when the press ends, hence the release here.
      this.bridge.up(this.key);
      this.report({ key: this.key, phase: 'down', handled, passed: true });
      return STATE_FAILED;
    }
    this.down = true;
    this.report({ key: this.key, phase: 'down', handled, passed: false });
    return STATE_BEGAN;
  }

  ended(): number {
    return this.release(STATE_ENDED);
  }

  cancelled(): number {
    return this.release(STATE_CANCELLED);
  }

  private release(state: number): number {
    if (this.down === false) {
      return state;
    }
    this.down = false;
    const handled = this.bridge.up(this.key) === false;
    this.report({ key: this.key, phase: 'up', handled, passed: false });
    return state;
  }
}

interface PressRecognizer extends NativeRecognizer {
  channel?: PressChannel | null;
}

interface SwipeTarget {
  onSwipe?: ((recognizer: NativeSwipeRecognizer) => void) | null;
}

interface RemoteClasses {
  /** The runtime the classes were made for. */
  base: NativeClass<NativeRecognizer>;
  press: NativeClass<PressRecognizer>;
  swipeTarget: NativeClass<SwipeTarget>;
  delegate: NativeClass<object>;
}

/**
 * The bindings in force. The runtime keeps a native object's JavaScript
 * side only while JavaScript holds it: a recognizer whose wrapper was
 * collected gets a fresh one, with no channel, when UIKit calls it, and
 * then sits undecided, which holds up the end of every press for the
 * responder chain and the system too. So a binding stays referenced here
 * until it is unbound, whatever the caller does with it.
 */
const liveBindings: RemoteBinding[] = [];

let classes: RemoteClasses | null = null;

function hasType(presses: NativeSet<NativePress>, type: number): boolean {
  const all = presses.allObjects;
  for (let i = 0; i < all.count; i++) {
    if (all.objectAtIndex(i).type === type) {
      return true;
    }
  }
  return false;
}

function channelOf(recognizer: PressRecognizer): PressChannel | null {
  const channel = recognizer.channel;
  return channel === undefined || channel === null ? null : channel;
}

function isPressRecognizer(recognizer: object): boolean {
  return channelOf(recognizer as PressRecognizer) !== null;
}

/**
 * The native classes, made once per runtime. A `UIGestureRecognizer`
 * subclass that overrides the press methods is the one recognizer that
 * reports a press began and ended per press type; `UITapGestureRecognizer`
 * reports neither, and the tvOS runtime has no press handling of its own.
 */
function remoteClasses(runtime: NativeRuntime): RemoteClasses {
  if (classes !== null && classes.base === runtime.UIGestureRecognizer) {
    return classes;
  }
  // Each override declares both parameters: the runtime matches a JS
  // method to a selector by name and parameter count, and one declared
  // with fewer is no override at all.
  const pressMethods: ThisType<PressRecognizer> & {
    pressesBeganWithEvent(presses: NativeSet<NativePress>, event: object): void;
    pressesEndedWithEvent(presses: NativeSet<NativePress>, event: object): void;
    pressesCancelledWithEvent(
      presses: NativeSet<NativePress>,
      event: object,
    ): void;
  } = {
    pressesBeganWithEvent(presses, _event) {
      const channel = channelOf(this);
      if (channel === null || hasType(presses, channel.type) === false) {
        return;
      }
      this.state = channel.began();
    },
    pressesEndedWithEvent(presses, _event) {
      const channel = channelOf(this);
      if (channel === null || hasType(presses, channel.type) === false) {
        return;
      }
      this.state = channel.ended();
    },
    pressesCancelledWithEvent(presses, _event) {
      const channel = channelOf(this);
      if (channel === null || hasType(presses, channel.type) === false) {
        return;
      }
      this.state = channel.cancelled();
    },
  };
  const press = runtime.UIGestureRecognizer.extend(pressMethods, {
    name: 'SolidTVPressRecognizer',
  }) as NativeClass<PressRecognizer>;

  const swipeMethods: ThisType<SwipeTarget> & {
    swiped(recognizer: NativeSwipeRecognizer): void;
  } = {
    swiped(recognizer) {
      const onSwipe = this.onSwipe;
      if (onSwipe !== undefined && onSwipe !== null) {
        onSwipe(recognizer);
      }
    },
  };
  const swipeTarget = runtime.NSObject.extend(swipeMethods, {
    name: 'SolidTVSwipeTarget',
    exposedMethods: {
      swiped: {
        returns: runtime.interop.types.void,
        params: [runtime.interop.types.id],
      },
    },
  }) as NativeClass<SwipeTarget>;

  const delegateMethods = {
    // Two buttons at once, one held while another is pressed, recognize
    // together. Swipes stay exclusive with everything, so a diagonal swipe
    // raises one arrow, not two.
    gestureRecognizerShouldRecognizeSimultaneouslyWithGestureRecognizer(
      recognizer: object,
      other: object,
    ): boolean {
      return (
        isPressRecognizer(recognizer) === true &&
        isPressRecognizer(other) === true
      );
    },
  };
  const delegate = runtime.NSObject.extend(delegateMethods, {
    name: 'SolidTVRecognizerDelegate',
    protocols: [runtime.UIGestureRecognizerDelegate],
  });

  classes = {
    base: runtime.UIGestureRecognizer,
    press,
    swipeTarget,
    delegate,
  };
  return classes;
}

function swipeKey(direction: number): string | null {
  for (let i = 0; i < SWIPE_KEYS.length; i++) {
    const entry = SWIPE_KEYS[i] as SwipeKey;
    if (entry.direction === direction) {
      return entry.key;
    }
  }
  return null;
}

const noReport = (): void => {};

/**
 * Turns the Siri Remote into bridge calls.
 *
 * @remarks
 * One recognizer per button, each allowed its own `UIPressType`, calls
 * {@link KeyBridge.down} when the press begins and {@link KeyBridge.up}
 * when it ends, so a held arrow repeats through the bridge's timer. The
 * arrows are `ArrowUp` to `ArrowRight`, select is `Enter`, Menu is
 * `Backspace` and play/pause is a tap of `MediaPlayPause`. Four swipe
 * recognizers tap the matching arrow, but swipes on the touch surface are
 * not supported: they need not work and nothing depends on them.
 *
 * A recognizer that recognizes consumes its press, so the app, not the
 * system, gets it. The exception is an unhandled
 * {@link RemoteOptions.passThrough} key, Menu by default: its recognizer
 * fails and the press goes on to the responder chain and the system, which
 * on tvOS returns to the Home screen. The app decides per press by calling
 * `preventDefault()` on the `keydown` it handles.
 *
 * tvOS only: it needs the runtime's `UIGestureRecognizer`, and throws
 * without it. Remote input on iOS is a hardware keyboard, which this does
 * not bind. The Canvas view raises `keydown` and `keyup` of its own for
 * the presses the recognizers leave to it. Keep nothing: the binding stays
 * alive until {@link RemoteBinding.unbind}.
 */
export function bindRemote(
  bridge: KeyBridge,
  view: RemoteWindow,
  options?: RemoteOptions,
): RemoteBinding {
  const runtime = nativeRuntime();
  const native = remoteClasses(runtime);
  const passThrough =
    options === undefined || options.passThrough === undefined
      ? DEFAULT_PASS_THROUGH
      : options.passThrough;
  const report =
    options === undefined || options.onPress === undefined
      ? noReport
      : options.onPress;
  const container = view.rootViewController;
  const host: RemoteContainer = container === null ? view : container.view;

  const delegate = new native.delegate();
  const pressRecognizers: PressRecognizer[] = [];
  for (let i = 0; i < PRESS_KEYS.length; i++) {
    const entry = PRESS_KEYS[i] as PressKey;
    const recognizer = new native.press();
    recognizer.channel = new PressChannel(
      entry.type,
      entry.key,
      entry.tap,
      passThrough.indexOf(entry.key) !== -1,
      bridge,
      report,
    );
    recognizer.allowedPressTypes = [entry.type];
    recognizer.delegate = delegate;
    host.addGestureRecognizer(recognizer);
    pressRecognizers.push(recognizer);
  }

  const swipeTarget = new native.swipeTarget();
  swipeTarget.onSwipe = (recognizer: NativeSwipeRecognizer): void => {
    const key = swipeKey(recognizer.direction);
    if (key === null) {
      return;
    }
    const handled = bridge.tap(key) === false;
    report({ key, phase: 'swipe', handled, passed: false });
  };
  const swipeRecognizers: NativeSwipeRecognizer[] = [];
  for (let i = 0; i < SWIPE_KEYS.length; i++) {
    const entry = SWIPE_KEYS[i] as SwipeKey;
    const recognizer =
      runtime.UISwipeGestureRecognizer.alloc().initWithTargetAction(
        swipeTarget,
        'swiped',
      );
    recognizer.direction = entry.direction;
    recognizer.delegate = delegate;
    host.addGestureRecognizer(recognizer);
    swipeRecognizers.push(recognizer);
  }

  const binding: RemoteBinding = {
    unbind(): void {
      const index = liveBindings.indexOf(binding);
      if (index !== -1) {
        liveBindings.splice(index, 1);
      }
      for (let i = 0; i < pressRecognizers.length; i++) {
        const recognizer = pressRecognizers[i] as PressRecognizer;
        host.removeGestureRecognizer(recognizer);
        recognizer.delegate = null;
        recognizer.channel = null;
      }
      for (let i = 0; i < swipeRecognizers.length; i++) {
        const recognizer = swipeRecognizers[i] as NativeSwipeRecognizer;
        host.removeGestureRecognizer(recognizer);
        recognizer.delegate = null;
      }
      swipeTarget.onSwipe = null;
    },
  };
  liveBindings.push(binding);
  return binding;
}
