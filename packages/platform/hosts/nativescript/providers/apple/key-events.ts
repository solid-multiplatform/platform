import type { KeyEventsPort } from '@solid-multiplatform/platform/shortcuts';

/** The host's key bridge dispatches on the scene's document; Command is `Mod`. */
export function keyEvents(): KeyEventsPort {
  return {
    target: () => document,
    primaryModifier: () => 'meta',
  };
}
