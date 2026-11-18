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
  if (combo.alt !== event.altKey) return false;
  if (combo.shift !== event.shiftKey) return false;
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

export interface BackDispatcher {
  /** Register a handler. The most recently registered handler runs first. */
  push(handler: BackHandler): () => void;
  /** Run the top handler. Returns true when one consumed the press. */
  handle(): boolean;
}

/**
 * App-wide hardware-back contract. Screens push handlers while mounted; the
 * topmost can consume Back, otherwise navigation's own `back()` or the host
 * exit action runs. This mirrors Android `OnBackPressedDispatcher`.
 */
export function createBackDispatcher(
  options: { onExit?(): void } = {},
): BackDispatcher {
  const handlers: BackHandler[] = [];
  return {
    push(handler) {
      handlers.push(handler);
      return () => {
        const index = handlers.lastIndexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    handle() {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i]!() === true) return true;
      }
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
 * Hosts call this once after creating their dispatcher; the browser/desktop
 * key bridge already delivers these keys.
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
      event.key !== 'GoBack'
    ) {
      return;
    }
    if (dispatcher.handle()) event.preventDefault();
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
