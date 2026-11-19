/**
 * The one table of device services: every name in the registry
 * (`ServiceProviders`), the SDK call that exercises it harmlessly and how the
 * result is judged. The Services screen and probe mode are both generated
 * from it. `Record<ServiceName, …>` makes a service added to the SDK and not
 * to this table a type error.
 *
 * A probe runs unattended only when it is safe: it opens nothing, prompts for
 * nothing and leaves nothing behind. A service whose only honest exercise
 * needs a person, a permission prompt or another app carries `manual` (why)
 * and reports `unverified` unattended; where a harmless attended exercise
 * exists it is `activate`, run only when the row is activated by hand.
 */
import {
  applySystemBarStyle,
  batteryState,
  deviceInfo,
  deviceMemory,
  fileDirectories,
  fileExists,
  getCurrentPosition,
  impact,
  keepAwake,
  mediaCapabilities,
  readClipboard,
  readFileText,
  removeFile,
  sensorAvailable,
  writeClipboard,
  writeFileText,
} from '@solid-multiplatform/platform';
import {
  loadService,
  useService,
  type ServiceName,
  type Store,
} from '@solid-multiplatform/platform/services';
import { failed, ok, unverified, type Outcome } from '../probe/result';

export interface ServiceSpec {
  /** The SDK call, as an app author writes it. */
  call: string;
  /** How the result is judged. */
  judge: string;
  /** Runs unattended. Throwing is `failed` (or `denied`: see `runProbe`). */
  probe?: () => Outcome | Promise<Outcome>;
  /** Why it cannot run unattended. */
  manual?: string;
  /** Runs only when a person activates the row. */
  activate?: () => Outcome | Promise<Outcome>;
}

const MARKER = 'showcase-probe-marker';
const KEY = 'showcase.probe';

const expect = (value: boolean, detail: string, wrong: string): Outcome =>
  value ? ok(detail) : failed(wrong);

async function storeRoundTrip(store: Store): Promise<Outcome> {
  await store.set(KEY, MARKER);
  const read = await store.get(KEY);
  await store.remove(KEY);
  const after = await store.get(KEY);
  if (read !== MARKER) return failed(`read back ${JSON.stringify(read)}`);
  if (after !== null)
    return failed(`still ${JSON.stringify(after)} after remove`);
  return ok('set, get, remove');
}

const needsPerson = (what: string) => `${what}; not run unattended`;

export const serviceTable: Record<ServiceName, ServiceSpec> = {
  // ---- Application services (sdk/services.ts)
  settings: {
    call: "loadService('settings'): set, get, remove",
    judge: 'the marker reads back and is gone after remove',
    probe: async () => storeRoundTrip(await loadService('settings')),
  },
  secureStorage: {
    call: "loadService('secureStorage'): set, get, remove",
    judge: 'the marker reads back and is gone after remove',
    probe: async () => storeRoundTrip(await loadService('secureStorage')),
  },
  lifecycle: {
    call: "loadService('lifecycle').active()",
    judge: 'a boolean',
    probe: async () => {
      const active = (await loadService('lifecycle')).active();
      return expect(
        typeof active === 'boolean',
        `active=${active}`,
        'no state',
      );
    },
  },
  connectivity: {
    call: "loadService('connectivity').online()",
    judge: 'a boolean',
    probe: async () => {
      const online = (await loadService('connectivity')).online();
      return expect(
        typeof online === 'boolean',
        `online=${online}`,
        'no state',
      );
    },
  },
  links: {
    call: "loadService('links').initial()",
    judge: 'the launch link, or null',
    probe: async () => {
      const link = (await loadService('links')).initial();
      return expect(
        link === null || typeof link === 'string',
        link === null ? 'no launch link' : 'has a launch link',
        `initial() returned ${typeof link}`,
      );
    },
  },
  notifications: {
    call: "loadService('notifications'): permission(), request(), show()",
    judge: 'attended: permission granted and show() resolves',
    manual: needsPerson('asks for permission and shows a notification'),
    activate: async () => {
      const port = await loadService('notifications');
      let permission = await port.permission();
      if (permission === 'prompt') permission = await port.request();
      if (permission !== 'granted')
        return { status: 'denied', detail: `permission=${permission}` };
      await port.show({ title: 'Showcase', body: 'Notification probe' });
      return unverified('show() resolved; a person must see it');
    },
  },
  push: {
    call: "loadService('push').register(key)",
    judge: 'a subscription from the push server',
    manual: needsPerson('registers this device with a push server'),
  },
  jobs: {
    call: "loadService('jobs').schedule(id)",
    judge: 'the job runs in the background later',
    manual: needsPerson('schedules background work that outlives the probe'),
  },
  request: {
    call: "loadService('request').fetch('data:text/plain,…')",
    judge: 'the body of a data: URL reads back; no network is used',
    probe: async () => {
      const { fetch } = await loadService('request');
      const response = await fetch('data:text/plain,' + MARKER);
      const text = await response.text();
      return expect(text === MARKER, 'data: URL fetched', `got "${text}"`);
    },
  },

  // ---- Device (sdk/device.ts)
  clipboard: {
    call: 'writeClipboard(marker), readClipboard()',
    judge: 'the marker reads back',
    probe: async () => {
      await writeClipboard(MARKER);
      const text = await readClipboard();
      return expect(text === MARKER, 'round trip', `read back "${text}"`);
    },
  },
  share: {
    call: 'share({ title, text })',
    judge: 'the share sheet opens',
    manual: needsPerson('opens the system share sheet'),
  },
  haptics: {
    call: "impact('light')",
    judge: 'the device taps; nothing reports it back',
    manual: needsPerson('vibrates the device, and only a person can feel it'),
    activate: async () => {
      await impact('light');
      return unverified('impact() resolved; a person must feel it');
    },
  },
  deviceInfo: {
    call: 'deviceInfo()',
    judge: 'an object with a platform name',
    probe: async () => {
      const info = await deviceInfo();
      return expect(
        typeof info.platform === 'string',
        `platform=${info.platform}`,
        'no platform',
      );
    },
  },
  battery: {
    call: 'batteryState()',
    judge: 'a level in 0..1 and a charging flag, or no battery',
    probe: async () => {
      const state = await batteryState();
      if (state === undefined) return ok('no battery reported');
      return expect(
        state.level >= 0 && state.level <= 1,
        `level=${state.level} charging=${state.charging}`,
        `level=${state.level}`,
      );
    },
  },
  memory: {
    call: 'deviceMemory()',
    judge: 'a low-memory flag',
    probe: () => {
      const info = deviceMemory();
      return expect(
        typeof info.lowMemory === 'boolean',
        `lowMemory=${info.lowMemory} gb=${info.deviceMemoryGb ?? 'unknown'}`,
        'no flag',
      );
    },
  },
  keepAwake: {
    call: 'keepAwake(true), keepAwake(false)',
    judge: 'both resolve; the lock is released again',
    probe: async () => {
      await keepAwake(true);
      await keepAwake(false);
      return ok('acquired and released');
    },
  },
  openExternal: {
    call: 'openExternal(url)',
    judge: 'another app opens',
    manual: needsPerson('opens another application'),
  },
  orientation: {
    call: "lockOrientation('any')",
    judge: 'the screen follows the lock',
    manual: needsPerson('rotates the screen'),
  },
  systemBars: {
    call: 'applySystemBarStyle(style), then its restore function',
    judge: 'a restore function is returned and runs',
    probe: () => {
      const restore = applySystemBarStyle({ statusBarColor: 0xff0b1118 });
      if (typeof restore !== 'function') return failed('no restore function');
      restore();
      return ok('applied and restored');
    },
  },
  appReview: {
    call: 'requestAppReview()',
    judge: 'the store review prompt appears',
    manual: needsPerson('shows the store review prompt'),
  },

  // ---- Locale, appearance, keys
  locale: {
    call: "useService('locale').current()",
    judge: 'a BCP 47 tag',
    probe: () => {
      const tag = useService('locale').current();
      return expect(
        typeof tag === 'string' && tag !== '',
        `locale=${tag}`,
        'no tag',
      );
    },
  },
  colorScheme: {
    call: "useService('colorScheme').current()",
    judge: '"light" or "dark"',
    probe: () => {
      const scheme = useService('colorScheme').current();
      return expect(
        scheme === 'light' || scheme === 'dark',
        `scheme=${scheme}`,
        `got "${String(scheme)}"`,
      );
    },
  },
  keyEvents: {
    call: "useService('keyEvents').target()",
    judge: 'a target that can be listened to',
    probe: () => {
      const target = useService('keyEvents').target();
      return expect(
        typeof target?.addEventListener === 'function',
        'has a key target',
        'no key target',
      );
    },
  },

  // ---- Media
  audio: {
    call: 'createAudioPlayer().play(track)',
    judge: 'sound is heard',
    manual: needsPerson('plays sound'),
  },
  mediaSession: {
    call: 'configureMediaSession(metadata, handlers)',
    judge: 'the system media controls show the track',
    manual: needsPerson('changes the system media controls'),
  },
  fullscreen: {
    call: 'enterFullscreen(), exitFullscreen()',
    judge: 'the window fills the screen',
    manual: needsPerson('changes the window and needs a user gesture'),
  },
  thumbnails: {
    call: 'captureThumbnail(source, time)',
    judge: 'an image URL for the frame',
    manual: needsPerson('needs a video to decode, which the app does not ship'),
  },
  mediaCapabilities: {
    call: 'mediaCapabilities()',
    judge: 'lists of DRM systems and codecs, and an HDR flag',
    probe: async () => {
      const caps = await mediaCapabilities();
      return expect(
        Array.isArray(caps.drm) && Array.isArray(caps.codecs),
        `drm=${caps.drm.length} codecs=${caps.codecs.length} hdr=${caps.hdr}`,
        'wrong shape',
      );
    },
  },
  camera: {
    call: 'capturePhoto()',
    judge: 'a photo',
    manual: needsPerson('asks for the camera'),
  },
  microphone: {
    call: 'openMicrophone(), stopMicrophone(stream)',
    judge: 'a live stream',
    manual: needsPerson('asks for the microphone'),
  },
  download: {
    call: 'downloadText(text, { name })',
    judge: 'a file is saved',
    manual: needsPerson('saves a file on the device'),
  },
  filePicker: {
    call: 'pickFiles()',
    judge: 'the files a person chose',
    manual: needsPerson('opens the file picker'),
  },
  fileSystem: {
    call: 'writeFileText, readFileText, removeFile in the cache directory',
    judge: 'the marker reads back and the file is gone after remove',
    probe: async () => {
      const directory = fileDirectories().cache;
      if (!directory) return unverified('the host names no cache directory');
      const path = directory + '/' + KEY + '.txt';
      await writeFileText(path, MARKER);
      const text = await readFileText(path);
      await removeFile(path);
      if (text !== MARKER) return failed(`read back "${text}"`);
      return expect(
        !(await fileExists(path)),
        'write, read, remove',
        'the file is still there',
      );
    },
  },

  // ---- Location and sensors
  geolocation: {
    call: 'getCurrentPosition()',
    judge: 'a latitude and a longitude',
    manual: needsPerson('asks for the location permission'),
    activate: async () => {
      const position = await getCurrentPosition({ timeout: 10000 });
      return expect(
        Number.isFinite(position.latitude) &&
          Number.isFinite(position.longitude),
        'has a position',
        'no coordinates',
      );
    },
  },
  sensors: {
    call: "sensorAvailable('accelerometer' | 'gyroscope')",
    judge: 'a boolean for each; nothing is subscribed',
    probe: () => {
      const accelerometer = sensorAvailable('accelerometer');
      const gyroscope = sensorAvailable('gyroscope');
      return expect(
        typeof accelerometer === 'boolean' && typeof gyroscope === 'boolean',
        `accelerometer=${accelerometer} gyroscope=${gyroscope}`,
        'no answer',
      );
    },
  },
  maps: {
    call: 'openMap(options)',
    judge: 'the maps app opens',
    manual: needsPerson('opens the maps application'),
  },

  // ---- Personal data
  contacts: {
    call: 'getContacts()',
    judge: 'the contacts a person allowed',
    manual: needsPerson('asks for the contacts permission'),
  },
  calendar: {
    call: 'getCalendarEvents(query)',
    judge: 'the events a person allowed',
    manual: needsPerson('asks for the calendar permission'),
  },
  biometrics: {
    call: 'authenticate(reason)',
    judge: 'the person is recognised',
    manual: needsPerson('shows the biometric prompt'),
  },

  // ---- Desktop and updates
  menus: {
    call: 'setApplicationMenu(menu)',
    judge: 'the application menu changes',
    manual: needsPerson('replaces the application menu'),
  },
  updateDelivery: {
    call: 'createUpdateDelivery(…)',
    judge: 'an update is downloaded and staged',
    manual: needsPerson('downloads and stages an update'),
  },
  updateSource: {
    call: 'checkForUpdate(currentVersion)',
    judge: 'the feed answers',
    manual: needsPerson('contacts the update feed over the network'),
  },
};

export const serviceNames = Object.keys(serviceTable).sort() as ServiceName[];
