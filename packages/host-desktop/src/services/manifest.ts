// Every service the desktop host provides, as providers for the platform's
// registry. A provider is a function: installing these does nothing, and a
// service is made when an app first uses it.
//
// Provided: clipboard, openExternal, deviceInfo, battery, memory, keepAwake,
// colorScheme, locale, keyEvents, lifecycle, settings, fileSystem,
// filePicker, download, request, links (the link the app was opened with).
//
// Not provided, so `unavailable`: connectivity (the system offers no event
// for it through SDL, and watching would mean polling), secureStorage,
// notifications, share, haptics, orientation, systemBars, appReview, push,
// jobs.
//
// On a browser some of these must be there before the user's gesture; here
// there is no such rule. They are functions that return the port at once all
// the same, because several SDK functions (`deviceMemory`, `createI18n`,
// `bindColorScheme`, `createShortcuts`) are synchronous.
import type { ProviderMap } from '@solid-multiplatform/platform/services';
import {
  battery,
  clipboard,
  colorScheme,
  deviceInfo,
  keepAwake,
  keyEvents,
  lifecycle,
  locale,
  memory,
  openExternal,
} from './device.js';
import { download, filePicker, fileSystem } from './files.js';
import { links } from './links.js';
import { desktopFetch } from './request.js';
import { settings } from './storage.js';

export interface DesktopApp {
  /** Names the app's settings file and directories. */
  id: string;
  version?: string;
  /** Where the window's key events are raised; absent without a window. */
  keys?: EventTarget;
}

export function desktopServices(app: DesktopApp): ProviderMap {
  const keys = app.keys;
  return {
    openExternal,
    deviceInfo: () => deviceInfo(app.version),
    battery,
    memory,
    locale,
    settings: () => settings(app.id),
    fileSystem: () => fileSystem(app.id),
    request: () => ({ fetch: desktopFetch }),
    links,
    // These need the window.
    ...(__solid.window === undefined
      ? {}
      : {
          clipboard,
          keepAwake,
          colorScheme,
          lifecycle,
          filePicker,
          download,
          ...(keys === undefined ? {} : { keyEvents: () => keyEvents(keys) }),
        }),
  };
}
