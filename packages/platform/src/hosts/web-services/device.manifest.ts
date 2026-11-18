// Browser providers for: clipboard, share, haptics, device info, battery, memory, keep-awake, orientation, system bars, external links, locale, colour scheme, key events, lifecycle, connectivity, deep links, notifications, network requests.
//
// Lazy entries load ./device.ts on first use. Eager entries are the plain
// objects of ./device.sync.ts, for two reasons:
//
// - Browsers allow clipboard access, the share sheet, a new tab, the
//   notification prompt and orientation and wake locks only while handling a
//   user gesture. An `import()` between the app's call and the browser's
//   would lose the gesture on the first use, so these must already be loaded.
// - `deviceMemory`, `applySystemBarStyle`, `createI18n`, `bindColorScheme`,
//   `createShortcuts` and `bindMediaKeys` are synchronous.
//
// Not here: app review and secure storage (a browser has neither); settings,
// push and background jobs, which need the application's namespace or its
// service worker (`webAppServices` in ./index.ts).
import type { ProviderMap } from '../../sdk/registry.js';
import {
  clipboard,
  colorScheme,
  keepAwake,
  keyEvents,
  locale,
  memory,
  notifications,
  openExternal,
  orientation,
  share,
  systemBars,
} from './device.sync.js';

const load = () => import('./device.js');

export const deviceServices: ProviderMap = {
  // Eager: needs the user's gesture.
  clipboard,
  share,
  openExternal,
  orientation,
  keepAwake,
  notifications,
  // Eager: read by synchronous SDK functions.
  memory,
  systemBars,
  locale,
  colorScheme,
  keyEvents,
  // Lazy.
  haptics: () => load().then((m) => m.haptics),
  deviceInfo: () => load().then((m) => m.deviceInfo),
  battery: () => load().then((m) => m.battery),
  lifecycle: () => load().then((m) => m.lifecycle),
  connectivity: () => load().then((m) => m.connectivity),
  links: () => load().then((m) => m.links),
  request: () => load().then((m) => m.request),
};
