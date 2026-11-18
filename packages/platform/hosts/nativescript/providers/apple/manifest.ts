// Apple providers for: settings, secure storage, device info, locale, colour
// scheme, lifecycle, connectivity, memory, keep-awake, external links, key
// events, files, the media session and (with the host's delegate hook) deep
// links; on iOS also clipboard, share sheet, haptics, battery, biometrics,
// local notifications, location and (with its delegate hook) orientation.
//
// Installing the map does no work. A lazy entry imports its module on first
// use. `locale`, `colorScheme`, `memory`, `keyEvents`, `fileSystem`,
// `mediaSession` and `geolocation` are read by synchronous SDK functions
// (`createI18n`, `bindColorScheme`, `deviceMemory`, `createShortcuts`,
// `fileDirectories`, `configureMediaSession`, `watchPosition`), so their
// factories are imported here and run on first use. No module of this directory touches a native class when it is
// imported: only inside its factory and the functions of the port it returns.
//
// A service tvOS cannot provide is absent from the TV map, never a stub.
import type {
  LinksPort,
  ProviderMap,
} from '@solid-multiplatform/platform/services';
import { colorScheme } from './color-scheme.js';
import { fileSystem } from './file-system.js';
import { geolocation } from './geolocation.js';
import { keyEvents } from './key-events.js';
import { locale } from './locale.js';
import { mediaSession } from './media-session.js';
import { memory } from './memory.js';
import type { OrientationHook } from './orientation.js';

export interface AppleServiceOptions {
  form: 'phone' | 'tv';
  /** Prefix of every settings key and the Keychain service name. */
  namespace?: string;
  /**
   * The port the host's application-delegate hook delivers opened URLs to
   * (`captureAppleLinks`, which has to run before the application starts).
   * Without it there is no `links` service.
   */
  links?: LinksPort;
  /**
   * The delegate hook rotation is locked through (`captureAppleOrientation`,
   * also run before the application starts). Without it there is no
   * `orientation` service. Not used on a TV.
   */
  orientation?: OrientationHook;
}

/** The services iOS has and tvOS does not. `orientation` also needs its hook. */
export const phoneOnlyServices = [
  'battery',
  'biometrics',
  'clipboard',
  'geolocation',
  'haptics',
  'notifications',
  'orientation',
  'share',
] as const;

export function appleServices({
  form,
  namespace = 'solid',
  links,
  orientation,
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
    mediaSession,
    fileSystem: () => fileSystem(form),
    ...(links ? { links } : {}),
  };
  if (form === 'tv') return shared;
  return {
    ...shared,
    battery: () => import('./battery.js').then((m) => m.battery()),
    biometrics: () => import('./biometrics.js').then((m) => m.biometrics()),
    clipboard: () => import('./clipboard.js').then((m) => m.clipboard()),
    // Synchronous: `watchPosition` returns its disposer at once.
    geolocation,
    haptics: () => import('./haptics.js').then((m) => m.haptics()),
    ...(orientation
      ? {
          orientation: () =>
            import('./orientation.js').then((m) => m.orientation(orientation)),
        }
      : {}),
    notifications: () =>
      import('./notifications.js').then((m) => m.notifications()),
    share: () => import('./share.js').then((m) => m.share()),
  };
}
