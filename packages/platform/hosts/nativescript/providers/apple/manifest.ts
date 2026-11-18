// Apple providers for: settings, secure storage, device info, locale, colour
// scheme, lifecycle, connectivity, memory, keep-awake, external links and key
// events; on iOS also clipboard, share sheet, haptics and battery.
//
// Installing the map does no work. A lazy entry imports its module on first
// use. `locale`, `colorScheme`, `memory` and `keyEvents` are read by
// synchronous SDK functions (`createI18n`, `bindColorScheme`, `deviceMemory`,
// `createShortcuts`), so their factories are imported here and run on first
// use. No module of this directory touches a native class when it is
// imported: only inside the functions of the port it returns.
//
// A service tvOS cannot provide is absent from the TV map, never a stub.
import type { ProviderMap } from '@solid-multiplatform/platform/services';
import { colorScheme } from './color-scheme.js';
import { keyEvents } from './key-events.js';
import { locale } from './locale.js';
import { memory } from './memory.js';

export interface AppleServiceOptions {
  form: 'phone' | 'tv';
  /** Prefix of every settings key and the Keychain service name. */
  namespace?: string;
}

/** The services iOS has and tvOS does not. */
export const phoneOnlyServices = [
  'battery',
  'clipboard',
  'haptics',
  'share',
] as const;

export function appleServices({
  form,
  namespace = 'solid',
}: AppleServiceOptions): ProviderMap {
  const shared: ProviderMap = {
    settings: () => import('./settings.js').then((m) => m.settings(namespace)),
    secureStorage: () =>
      import('./secure-storage.js').then((m) => m.secureStorage(namespace)),
    deviceInfo: () =>
      import('./device-info.js').then((m) => m.deviceInfo(form)),
    lifecycle: () => import('./lifecycle.js').then((m) => m.lifecycle()),
    connectivity: () =>
      import('./connectivity.js').then((m) => m.connectivity()),
    keepAwake: () => import('./keep-awake.js').then((m) => m.keepAwake()),
    openExternal: () =>
      import('./open-external.js').then((m) => m.openExternal()),
    // Synchronous: see above.
    locale,
    colorScheme,
    memory,
    keyEvents,
  };
  if (form === 'tv') return shared;
  return {
    ...shared,
    battery: () => import('./battery.js').then((m) => m.battery()),
    clipboard: () => import('./clipboard.js').then((m) => m.clipboard()),
    haptics: () => import('./haptics.js').then((m) => m.haptics()),
    share: () => import('./share.js').then((m) => m.share()),
  };
}
