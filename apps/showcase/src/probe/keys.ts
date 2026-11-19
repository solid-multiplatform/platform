/**
 * A tap on a host's key target, so that the probe can raise the keys a remote
 * would. `HostContext.keys` only listens (`KeyEventTarget` has no way to raise
 * an event), so the entry wraps its host with `withKeyTap`: the focus manager
 * then listens to the tap, which passes the host's own keys through and adds
 * the probe's. Nothing is listened for until the focus manager asks.
 */
import type {
  KeyEventLike,
  KeyEventTarget,
} from '@solid-multiplatform/platform';
import type { HostDefinition } from '@solid-multiplatform/platform/host';

type KeyType = 'keydown' | 'keyup';
type Listener = (event: KeyEventLike) => void;

export interface KeyTap extends KeyEventTarget {
  /** A key down and up, with the platform's key name (`ArrowDown`, `Enter`). */
  press(key: string): void;
}

export function tapKeys(source: KeyEventTarget): KeyTap {
  const listeners: Record<KeyType, Set<Listener>> = {
    keydown: new Set(),
    keyup: new Set(),
  };
  const emit = (type: KeyType, event: KeyEventLike) => {
    for (const listener of Array.from(listeners[type])) listener(event);
  };
  const forward: Record<KeyType, Listener> = {
    keydown: (event) => emit('keydown', event),
    keyup: (event) => emit('keyup', event),
  };
  return {
    addEventListener(type, listener) {
      if (listeners[type].size === 0)
        source.addEventListener(type, forward[type]);
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
      if (listeners[type].size === 0)
        source.removeEventListener(type, forward[type]);
    },
    press(key) {
      const event: KeyEventLike = { key, keyCode: 0, repeat: false };
      emit('keydown', event);
      emit('keyup', event);
    },
  };
}

/** `host`, with its keys tapped; `onTap` receives the tap of each launch. */
export function withKeyTap<Surface>(
  host: HostDefinition<Surface>,
  onTap: (tap: KeyTap) => void,
): HostDefinition<Surface> {
  return {
    ...host,
    launch: (run) =>
      host.launch((context) => {
        const tap = tapKeys(context.keys);
        onTap(tap);
        return run({ ...context, keys: tap });
      }),
  };
}
