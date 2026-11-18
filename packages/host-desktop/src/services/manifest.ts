// Every service the desktop host provides, as providers for the platform's
// registry. A provider is a function: installing these does nothing, and a
// service is made when an app first uses it.
//
// Provided: clipboard, openExternal, deviceInfo, battery, memory, keepAwake,
// colorScheme, locale, keyEvents, lifecycle, settings, fileSystem,
// filePicker, download, request, links (the link the app was opened with),
// and notifications where the session bus has a notification service.
//
// Not provided, so `unavailable`: connectivity (the system offers no event
// for it through SDL, and watching would mean polling), secureStorage,
// share, haptics, orientation, systemBars, appReview, push, jobs.
//
// One thing is asked when these are installed: whether the session bus has
// a notification service, because whether `notifications` is there at all
// depends on it. That is one question to the bus (under a millisecond on a
// running desktop, nothing where there is no bus).
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
import { notifications, notificationsAvailable } from './notifications.js';
import { desktopFetch } from './request.js';
import { settings } from './storage.js';

export interface DesktopApp {
  /** Names the app's settings file and directories. */
  id: string;
  /** What the app is called where the system names it; its id if absent. */
  name?: string;
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
    ...(notificationsAvailable()
      ? { notifications: () => notifications(app.name ?? app.id) }
      : {}),
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
