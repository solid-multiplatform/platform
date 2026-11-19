/**
 * Every device service the Android phone and Android TV hosts provide.
 *
 *     installServices(androidServices({ form: 'tv', app: Application.android }));
 *
 * Building the map does no work beyond reading what the device has (see
 * `detectAndroidFeatures`): each entry is a function that makes its port the
 * first time an app uses the service. Most load their module then, with
 * `import()`, so an app that never uses a service never loads its code. The
 * ports a synchronous SDK function reads cannot wait for a load; their
 * factories are imported here, and still make nothing until first use.
 *
 * A service the device, the form or the app's manifest cannot support is left
 * out, so the SDK reports it `unavailable`. Not provided on Android at all:
 * `push` (it needs Firebase, which is the app's to add), `microphone` (the
 * SDK's port returns a browser `MediaStream`), `thumbnails`, and `request`.
 * The runtime's `fetch` (OkHttp, off the UI thread) answers over HTTPS and,
 * where the app's network security configuration allows the host, over
 * cleartext; it rejects a host the configuration blocks. Against an HTTP/1.0
 * server it neither resolved nor rejected on the emulator, and it has no
 * timeout of its own, so there is no `request` provider until one bounds it.
 *
 * The services in `ANDROID_PREVIEW_SERVICES` are written but have no device
 * evidence yet; those in `ANDROID_TV_PREVIEW_SERVICES` have it on a phone
 * only. They are offered only when the app asks with `preview`.
 */
import type {
  ServiceName,
  ServiceProvider,
} from '../../../../src/sdk/registry.js';
import type { ProviderMap } from '../../../../src/sdk/services.js';
import type { KeyEventsPort } from '../../../../src/sdk/shortcuts.js';
import { colorScheme } from './color-scheme.js';
import { download } from './download.js';
import { detectAndroidFeatures, type AndroidFeatures } from './features.js';
import { fileSystem } from './file-system.js';
import { geolocation } from './geolocation.js';
import type { AndroidJobs } from './jobs.js';
import { locale } from './locale.js';
import { mediaSession } from './media-session.js';
import { memory } from './memory.js';
import type { AndroidApp } from './runtime.js';
import { sensors } from './sensors.js';
import { systemBars } from './system-bars.js';

export {
  ANDROID_SERVICES,
  androidManifestRequirements,
  androidServiceSupported,
  applyAndroidManifestRequirements,
  type AndroidManifestRequirements,
} from './requirements.mjs';
export { androidPermissions } from './permission.js';
export { detectAndroidFeatures, type AndroidFeatures } from './features.js';
export type { AndroidApp } from './runtime.js';
export type { AndroidJob, AndroidJobs } from './jobs.js';

export interface AndroidServicesOptions {
  /** A phone or tablet, or a TV: decides which services make sense. */
  form: 'phone' | 'tv';
  /** NativeScript's `Application.android`. */
  app: AndroidApp;
  /** Names the settings and secure-storage files. Default `app`. */
  namespace?: string;
  /** The app's background jobs by name. Without it there is no `jobs`. */
  jobs?: AndroidJobs;
  /**
   * Where the host's key bridge raises `keydown` and `keyup`. Without it
   * there is no `keyEvents`.
   */
  keyTarget?: EventTarget;
  /** What the device supports. Read from the device when left out. */
  features?: AndroidFeatures;
  /** Also offer the services not yet verified on a device. */
  preview?: boolean;
}

/**
 * Services whose providers have not been verified on a device. A service
 * leaves this list with a passing check in the device verification
 * (`tests/native-device/android-probe.mjs verify`).
 */
export const ANDROID_PREVIEW_SERVICES: readonly ServiceName[] = [
  'appReview',
  'biometrics',
  'camera',
  'filePicker',
  'keyEvents',
];

/**
 * Services verified on a phone that a TV could also offer, where the TV
 * emulator could not show it: still a preview on a TV.
 */
export const ANDROID_TV_PREVIEW_SERVICES: readonly ServiceName[] = [
  'battery',
  'fullscreen',
  'geolocation',
  'sensors',
];

type Providers = { -readonly [K in ServiceName]?: ServiceProvider<K> };

const PERMISSION = 'android.permission.';

export function androidServices(options: AndroidServicesOptions): ProviderMap {
  const map = everyService(options);
  if (options.preview) return map;
  for (const name of ANDROID_PREVIEW_SERVICES) delete map[name];
  if (options.form === 'tv')
    for (const name of ANDROID_TV_PREVIEW_SERVICES) delete map[name];
  return map;
}

function everyService(options: AndroidServicesOptions): Providers {
  const { app, form, keyTarget } = options;
  const namespace = options.namespace ?? 'app';
  const has = options.features ?? detectAndroidFeatures(app);
  const phone = form === 'phone';
  const declares = (...names: string[]): boolean =>
    names.some((name) => has.permissions.includes(PERMISSION + name));

  const map: Providers = {
    // Loaded on first use.
    clipboard: () => import('./clipboard.js').then((m) => m.clipboard(app)),
    deviceInfo: () =>
      import('./device-info.js').then((m) => m.deviceInfo(app, form)),
    keepAwake: () => import('./keep-awake.js').then((m) => m.keepAwake(app)),
    settings: () =>
      import('./settings.js').then((m) => m.settings(app, namespace)),
    secureStorage: () =>
      import('./secure-storage.js').then((m) =>
        m.secureStorage(app, namespace),
      ),
    lifecycle: () => import('./lifecycle.js').then((m) => m.lifecycle(app)),
    links: () => import('./links.js').then((m) => m.links(app)),
    audio: () => import('./audio.js').then((m) => m.audio(app)),
    mediaCapabilities: () =>
      import('./media-capabilities.js').then((m) => m.mediaCapabilities(app)),
    // Read by synchronous SDK functions: made on first use, without a load.
    memory: () => memory(app),
    locale: () => locale(app),
    colorScheme: () => colorScheme(app),
    fileSystem: () => fileSystem(app),
    mediaSession: () => mediaSession(app),
  };

  if (has.battery)
    map.battery = () => import('./battery.js').then((m) => m.battery(app));
  if (declares('ACCESS_NETWORK_STATE'))
    map.connectivity = () =>
      import('./connectivity.js').then((m) => m.connectivity(app));
  if (has.share)
    map.share = () => import('./share.js').then((m) => m.share(app));
  if (has.browser)
    map.openExternal = () =>
      import('./open-external.js').then((m) => m.openExternal(app));
  if (has.documents)
    map.filePicker = () =>
      import('./file-picker.js').then((m) => m.filePicker(app));
  if (has.camera)
    map.camera = () => import('./camera.js').then((m) => m.camera(app));
  if (options.jobs) {
    const registry = options.jobs;
    map.jobs = () => import('./jobs.js').then((m) => m.jobs(app, registry));
  }
  if (keyTarget) {
    const keyEvents: KeyEventsPort = { target: () => keyTarget };
    map.keyEvents = keyEvents;
  }
  // MediaStore's Downloads collection arrived with Android 10.
  if (has.sdk >= 29) map.download = () => download(app);
  if (
    has.location &&
    declares('ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION')
  )
    map.geolocation = () => geolocation(app);
  if (has.sensors) map.sensors = () => sensors(app);
  // A TV window is always full screen; it gets the port only for
  // picture-in-picture.
  if (phone || has.pictureInPicture)
    map.fullscreen = () =>
      import('./fullscreen.js').then((m) =>
        m.fullscreen(app, has.pictureInPicture && has.sdk >= 26),
      );

  if (!phone) return map;

  map.systemBars = () => systemBars(app);
  map.orientation = () =>
    import('./orientation.js').then((m) => m.orientation(app));
  if (has.vibrator && declares('VIBRATE'))
    map.haptics = () => import('./haptics.js').then((m) => m.haptics(app));
  if (has.sdk < 33 || declares('POST_NOTIFICATIONS'))
    map.notifications = () =>
      import('./notifications.js').then((m) => m.notifications(app));
  if (has.biometrics && has.sdk >= 28 && declares('USE_BIOMETRIC'))
    map.biometrics = () =>
      import('./biometrics.js').then((m) => m.biometrics(app));
  if (has.maps) map.maps = () => import('./maps.js').then((m) => m.maps(app));
  if (declares('READ_CONTACTS'))
    map.contacts = () => import('./contacts.js').then((m) => m.contacts(app));
  if (declares('READ_CALENDAR'))
    map.calendar = () => import('./calendar.js').then((m) => m.calendar(app));
  if (has.playReview)
    map.appReview = () =>
      import('./app-review.js').then((m) => m.appReview(app));
  return map;
}
