/**
 * The Roku remote as a key event target.
 *
 * SceneGraph reports a key as `(key, press)`. Each becomes one `keydown` or
 * `keyup` object carrying the fields the focus manager reads. Arrows, Select
 * and Back use the names the framework's default key map already knows
 * (`ArrowLeft`, `Enter`, `Backspace` for Back); the other keys use the W3C
 * `KeyboardEvent.key` names, which an app maps with {@link rokuKeyMap}.
 *
 * Nothing here keeps a timer. On Roku OS 16 a held key arrives as one press
 * and, when let go, one release, with nothing in between (run-host.mjs holds
 * a key through ECP to check). Should a remote send further presses before
 * the release, they are marked `repeat`.
 */
import type {
  KeyEventLike,
  KeyEventTarget,
  KeyMap,
} from '@solid-multiplatform/platform';
import { reportError } from './report';

type Listener = (event: KeyEventLike) => void;

/** Firmware key name (lower case) to `[key, keyCode]`. */
const KEYS: Record<string, readonly [string, number]> = {
  left: ['ArrowLeft', 37],
  right: ['ArrowRight', 39],
  up: ['ArrowUp', 38],
  down: ['ArrowDown', 40],
  ok: ['Enter', 13],
  enter: ['Enter', 13],
  back: ['Backspace', 8],
  backspace: ['Backspace', 8],
  play: ['MediaPlayPause', 179],
  playonly: ['MediaPlay', 0],
  pause: ['MediaPause', 0],
  stop: ['MediaStop', 178],
  rewind: ['MediaRewind', 0],
  fastforward: ['MediaFastForward', 0],
  replay: ['InstantReplay', 0],
  options: ['Info', 0],
  search: ['Search', 0],
  guide: ['Guide', 0],
  channelup: ['ChannelUp', 0],
  channeldown: ['ChannelDown', 0],
};

/**
 * Handler names for the remote's media keys, for `startApp`'s `keyMap`:
 * `onPlayPause`, `onRewind`, `onFastForward`, `onInfo`, `onInstantReplay`.
 * Arrows, Enter and Back need no entry.
 */
export const rokuKeyMap: Partial<KeyMap> = {
  PlayPause: 'MediaPlayPause',
  Play: 'MediaPlay',
  Pause: 'MediaPause',
  Stop: 'MediaStop',
  Rewind: 'MediaRewind',
  FastForward: 'MediaFastForward',
  InstantReplay: 'InstantReplay',
  Info: 'Info',
};

class RokuKeyEvent implements KeyEventLike {
  defaultPrevented = false;
  constructor(
    readonly type: 'keydown' | 'keyup',
    readonly key: string,
    readonly keyCode: number,
    public repeat: boolean,
  ) {}
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

export interface RokuKeySource extends KeyEventTarget {
  /**
   * Raises one remote key event. True when a handler consumed it: the focus
   * manager calls `preventDefault` on a handled key when
   * `Config.preventDefaultOnHandledKeys` is set, which the host sets.
   */
  dispatch(key: string, press: boolean): boolean;
  /**
   * Forgets the keys that are down. Called when a system dialog takes the
   * remote: the release of the key that opened it goes to the dialog.
   */
  releaseAll(): void;
}

export function createKeySource(): RokuKeySource {
  const listeners: Record<'keydown' | 'keyup', Listener[]> = {
    keydown: [],
    keyup: [],
  };
  const held = new Set<string>();
  return {
    addEventListener(type, listener) {
      const list = listeners[type];
      if (list && !list.includes(listener)) list.push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners[type];
      const at = list ? list.indexOf(listener) : -1;
      if (at !== -1) list.splice(at, 1);
    },
    dispatch(key, press) {
      const known = KEYS[key.toLowerCase()];
      const name = known ? known[0] : key;
      const repeat = press && held.has(name);
      if (press) held.add(name);
      // A release whose press went elsewhere (it closed a system dialog) is
      // not this app's key.
      else if (!held.delete(name)) return false;
      const event = new RokuKeyEvent(
        press ? 'keydown' : 'keyup',
        name,
        known ? known[1] : 0,
        repeat,
      );
      // A copy: a handler may remove itself.
      const list = listeners[event.type].slice();
      for (let i = 0; i < list.length; i++) {
        try {
          list[i]!(event);
        } catch (error) {
          reportError('ROKU_KEY handler failed', error);
        }
      }
      return event.defaultPrevented;
    },
    releaseAll() {
      held.clear();
    },
  };
}
