import { pressKey, type KeyEventLike } from '../core/focusManager.js';
import { peekService } from './registry.js';

export interface Shortcut {
  /** `Mod+K`, `Shift+?`, `ArrowLeft`. `Mod` is Cmd on macOS, Ctrl elsewhere. */
  combo: string;
  handler(event: KeyboardEvent): boolean | void;
  /** Prevent the browser default even when the handler returns false. */
  preventDefault?: boolean;
}

export interface ParsedCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  space: ' ',
  spacebar: ' ',
  back: 'Backspace',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  tab: 'Tab',
  plus: '+',
};

const normalizeKey = (key: string): string => {
  if (key.length === 1) return key.toLowerCase();
  return KEY_ALIASES[key.toLowerCase()] ?? key;
};

/** Parse a shortcut combo into its modifiers and key. */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+');
  // A trailing '+' is the plus key itself (`Mod++`).
  let key = parts.pop() ?? '';
  if (key === '' && combo.endsWith('++')) key = '+';
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  return {
    key: normalizeKey(key || '+'),
    mod: modifiers.has('mod'),
    ctrl: modifiers.has('ctrl') || modifiers.has('control'),
    meta:
      modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
    alt: modifiers.has('alt') || modifiers.has('option'),
    shift: modifiers.has('shift'),
  };
}

/**
 * The host's hardware keys: where their events arrive, and which key its
 * keyboard uses for shortcuts.
 */
export interface KeyEventsPort {
  /** The target that receives `keydown`/`keyup`: the page's window on the web. */
  target(): EventTarget;
  /**
   * The key `Mod` stands for in a combo: `meta` (Command) on Apple keyboards,
   * `ctrl` elsewhere. A host that leaves it out gets `ctrl`.
   */
  primaryModifier?(): 'meta' | 'ctrl';
}

declare module './registry.js' {
  interface ServiceProviders {
    keyEvents: KeyEventsPort;
  }
}

const isMac = (): boolean =>
  peekService('keyEvents')?.primaryModifier?.() === 'meta';

/** Whether a keyboard event satisfies a parsed combo. */
export function matchesCombo(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
  >,
  combo: ParsedCombo,
  mac = isMac(),
): boolean {
  const keyMatches =
    normalizeKey(event.key) === combo.key ||
    event.key.toLowerCase() === combo.key.toLowerCase();
  if (!keyMatches) return false;
  if (combo.mod) {
    if (mac ? !event.metaKey : !event.ctrlKey) return false;
  }
  if (combo.ctrl && !event.ctrlKey) return false;
  if (combo.meta && !event.metaKey) return false;
  // A native key event may carry no modifier fields at all.
  if (combo.alt !== Boolean(event.altKey)) return false;
  if (combo.shift !== Boolean(event.shiftKey)) return false;
  return true;
}

export interface ShortcutLayer {
  /** Match a keydown event. Returns true when a shortcut handled it. */
  handle(event: KeyboardEvent): boolean;
  dispose(): void;
}

/**
 * App-wide keyboard shortcuts in the React Hotkeys / Flutter `Shortcuts`
 * style. Only the registered combos are inspected, so normal Tab/arrow/Enter
 * focus navigation is untouched. Pass `target` to scope shortcuts to a pane;
 * without one they listen where the host's `keyEvents` service delivers keys,
 * and only `handle` works on a host that has none.
 */
export function createShortcuts(
  shortcuts: readonly Shortcut[],
  target: EventTarget | undefined = peekService('keyEvents')?.target(),
): ShortcutLayer {
  const parsed = shortcuts.map((shortcut) => ({
    shortcut,
    combo: parseCombo(shortcut.combo),
  }));
  const handle = (event: KeyboardEvent): boolean => {
    for (const entry of parsed) {
      if (!matchesCombo(event, entry.combo)) continue;
      const handled = entry.shortcut.handler(event) === true;
      if (handled || entry.shortcut.preventDefault) event.preventDefault();
      return true;
    }
    return false;
  };
  const listener = (event: Event) => {
    // Native hosts deliver key events that are not browser KeyboardEvents.
    if (typeof (event as KeyboardEvent).key === 'string')
      handle(event as KeyboardEvent);
  };
  target?.addEventListener('keydown', listener);
  return {
    handle,
    dispose() {
      target?.removeEventListener('keydown', listener);
    },
  };
}

export type BackHandler = () => boolean | void;

export interface BackHandlerOptions {
  /**
   * Runs before the focus path and before navigation: a pending stream or
   * admission can consume Back while cancelling itself. Most recent first.
   */
  beforeFocus?: boolean;
}

export interface BackHandleOptions {
  /**
   * The location already moved (a browser toolbar/gesture Back). Focus
   * handlers still run; navigation and exit do not, because the host already
   * performed the traversal. The router compensates the URL when this
   * returns true.
   */
  traversal?: boolean;
  /** The caller already delivered Back through the focus path. */
  synthesize?: boolean;
  /** How many entries the host moved, for a traversal. */
  delta?: number;
  /**
   * The real key event, where the press has one. The synthetic mapped Back
   * the focus path sees carries it, so raw `onKeyPress` handlers read the
   * key the user pressed. A press without an event (Android's hardware
   * Back) uses a plain Back event.
   */
  event?: KeyEventLike;
}

export interface BackDispatcher {
  /** Register a handler. The most recently registered handler runs first. */
  push(handler: BackHandler, options?: BackHandlerOptions): () => void;
  /**
   * Register the navigation fallback: a screen history's `back()`. It runs
   * after the focus path declines and before exit, and only once per press.
   */
  onBack(handler: BackHandler): () => void;
  /** Run the precedence chain. Returns true when one consumer took the press. */
  handle(options?: BackHandleOptions): boolean;
}

// One mapped Back per press: an event like a host's, mapped to `Back` so the
// focus path's `onBack`/`onKeyPress` handlers see it.
const SYNTHETIC_BACK = Object.freeze({
  key: 'Backspace',
  keyCode: 8,
  repeat: false,
  preventDefault() {},
});

/**
 * App-wide hardware-back contract. Screens push handlers while mounted; the
 * topmost can consume Back. Then one synthetic mapped Back goes through the
 * focus path (a modal or a fullscreen player's chrome consumes it). Then
 * navigation's own `back()` runs, and at the root the host exit action does.
 * This mirrors Android `OnBackPressedDispatcher`.
 */
export function createBackDispatcher(
  options: { onExit?(): void } = {},
): BackDispatcher {
  const handlers: BackHandler[] = [];
  const beforeFocus: BackHandler[] = [];
  let navigation: BackHandler | undefined;

  const run = (list: BackHandler[]): boolean => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!() === true) return true;
    }
    return false;
  };

  return {
    push(handler, registration = {}) {
      const list = registration.beforeFocus ? beforeFocus : handlers;
      list.push(handler);
      return () => {
        const index = list.lastIndexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    onBack(handler) {
      navigation = handler;
      return () => {
        if (navigation === handler) navigation = undefined;
      };
    },
    handle(handleOptions = {}) {
      // 1. Work already in flight consumes Back while it cancels.
      if (run(beforeFocus)) return true;
      // Explicit screen handlers, most recent first.
      if (run(handlers)) return true;
      // 2. One synthetic mapped Back through the focus path.
      if (
        handleOptions.synthesize !== false &&
        pressKey('Back', handleOptions.event ?? SYNTHETIC_BACK)
      )
        return true;
      // A traversal has already happened: there is nothing left to navigate.
      if (handleOptions.traversal === true) return false;
      // 3. Screen history's back(), exactly once.
      if (navigation !== undefined && navigation() === true) return true;
      // 4. Root policy: the host exit action, where it has one.
      if (options.onExit) {
        options.onExit();
        return true;
      }
      return false;
    },
  };
}

/**
 * Translate Escape/Backspace/GoBack keydowns into `dispatcher.handle()`.
 * Hosts with a browser key target call this once after creating their
 * dispatcher; the dispatcher's synthetic pass is the focus path's one
 * delivery, so the real key never reaches the scene's own key handler.
 */
export function bindBackKey(
  target: EventTarget,
  dispatcher: BackDispatcher,
): () => void {
  const listener = (input: Event) => {
    // Native hosts deliver key events that are not browser KeyboardEvents.
    const event = input as KeyboardEvent;
    if (typeof event.key !== 'string') return;
    if (
      event.key !== 'Escape' &&
      event.key !== 'Backspace' &&
      event.key !== 'GoBack' &&
      event.key !== 'BrowserBack' &&
      event.keyCode !== 166
    ) {
      return;
    }
    // The dispatcher owns Back on the target it is bound to: it delivers the
    // one synthetic mapped Back to the focus path itself, so the real key
    // must not reach the scene's own key handler and deliver it a second
    // time. Swallowing it whatever the result keeps one consumer per press.
    dispatcher.handle({ event });
    event.preventDefault();
    event.stopImmediatePropagation?.();
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
