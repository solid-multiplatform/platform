// Keys: the runtime's key events as `KeyboardEvent`s on an event target, for
// the focus manager (`HostContext.keys`) and the `keyEvents` service alike.
import { Event, EventTarget, type EventInit } from './web/events.js';

export interface KeyboardEventInit extends EventInit {
  key?: string;
  code?: string;
  keyCode?: number;
  which?: number;
  location?: number;
  repeat?: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * `KeyboardEvent` (UI Events): what a key event of this host is. `key`,
 * `code` and the legacy `keyCode` come from the runtime's key table
 * (native/src/keys.rs). `location`, `getModifierState` for locks and
 * `charCode` are not implemented: 0, the four modifiers only, and absent.
 */
export class DesktopKeyboardEvent extends Event {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly which: number;
  readonly location: number;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init);
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.keyCode = init.keyCode ?? 0;
    this.which = init.which ?? this.keyCode;
    this.location = init.location ?? 0;
    this.repeat = init.repeat ?? false;
    this.isComposing = init.isComposing ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.altKey = init.altKey ?? false;
    this.metaKey = init.metaKey ?? false;
  }

  getModifierState(name: string): boolean {
    switch (name) {
      case 'Control':
        return this.ctrlKey;
      case 'Shift':
        return this.shiftKey;
      case 'Alt':
        return this.altKey;
      case 'Meta':
        return this.metaKey;
      default:
        return false;
    }
  }
}

/** The runtime's key event as the event apps and the focus manager get. */
export function keyboardEvent(native: SolidInputEvent): DesktopKeyboardEvent {
  // The runtime's object has the fields of the init dictionary already.
  return new DesktopKeyboardEvent(native.type, {
    key: native.key,
    code: native.code,
    keyCode: native.keyCode,
    repeat: native.repeat,
    ctrlKey: native.ctrlKey,
    shiftKey: native.shiftKey,
    altKey: native.altKey,
    metaKey: native.metaKey,
    bubbles: true,
    cancelable: true,
  });
}

/** Where key events are raised: `keydown` and `keyup`. */
export class KeySource extends EventTarget {}
