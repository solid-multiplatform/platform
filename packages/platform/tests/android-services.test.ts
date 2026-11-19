// The parts of the Android providers that need no device: what the manifest
// must declare for each service, which services each form gets, that
// installing them touches nothing, path confinement, and the listeners the
// result dispatcher and permission ports hold.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ANDROID_PREVIEW_SERVICES,
  ANDROID_TV_PREVIEW_SERVICES,
  androidServices,
  type AndroidApp,
  type AndroidFeatures,
} from '../hosts/nativescript/providers/android/manifest.js';
import { confinePath } from '../hosts/nativescript/providers/android/paths.js';
import { androidPermission } from '../hosts/nativescript/providers/android/permission.js';
import {
  ANDROID_SERVICES,
  androidManifestRequirements,
  applyAndroidManifestRequirements,
} from '../hosts/nativescript/providers/android/requirements.mjs';
import {
  pendingResults,
  startForResult,
} from '../hosts/nativescript/providers/android/results.js';
import {
  installServices,
  installedServices,
  peekService,
  resetServices,
  serviceAvailable,
} from '../src/sdk/services.js';

const PERMISSION = 'android.permission.';

const everything: AndroidFeatures = {
  sdk: 36,
  permissions: [
    'ACCESS_NETWORK_STATE',
    'VIBRATE',
    'POST_NOTIFICATIONS',
    'USE_BIOMETRIC',
    'ACCESS_FINE_LOCATION',
    'READ_CONTACTS',
    'READ_CALENDAR',
  ].map((name) => PERMISSION + name),
  battery: true,
  vibrator: true,
  camera: true,
  location: true,
  biometrics: true,
  pictureInPicture: true,
  sensors: true,
  share: true,
  browser: true,
  maps: true,
  documents: true,
  playReview: true,
};

const nothing: AndroidFeatures = {
  ...everything,
  sdk: 28,
  permissions: [],
  battery: false,
  vibrator: false,
  camera: false,
  location: false,
  biometrics: false,
  pictureInPicture: false,
  sensors: false,
  share: false,
  browser: false,
  maps: false,
  documents: false,
  playReview: false,
};

/** An application object whose every use is a test failure. */
const untouched = new Proxy({} as AndroidApp, {
  get(_target, name) {
    throw new Error('The app object was read: ' + String(name));
  },
});

const jobs = { sync: { className: 'app.SyncJob', id: 1 } };
const keyTarget = new EventTarget();

afterEach(() => {
  resetServices();
  vi.unstubAllGlobals();
});

describe('androidManifestRequirements', () => {
  test('a service brings its permissions, features and queries', () => {
    expect(androidManifestRequirements(['connectivity'], 'tv')).toEqual({
      permissions: [{ name: PERMISSION + 'ACCESS_NETWORK_STATE' }],
      features: [],
      queries: [],
      providers: [],
      resources: {},
      services: [],
      activity: {},
      unavailable: [],
    });
    const location = androidManifestRequirements(['geolocation'], 'phone');
    expect(location.permissions.map((entry) => entry.name)).toEqual([
      PERMISSION + 'ACCESS_COARSE_LOCATION',
      PERMISSION + 'ACCESS_FINE_LOCATION',
    ]);
    // Location permissions would otherwise make GPS a required feature.
    expect(location.features).toContainEqual({
      name: 'android.hardware.location.gps',
      required: false,
    });
    expect(
      androidManifestRequirements(['openExternal', 'maps'], 'phone').queries,
    ).toEqual([
      {
        action: 'android.intent.action.VIEW',
        category: 'android.intent.category.BROWSABLE',
        scheme: 'https',
      },
      { action: 'android.intent.action.VIEW', scheme: 'geo' },
    ]);
  });

  test('share and camera share one FileProvider and its paths file', () => {
    const needs = androidManifestRequirements(
      ['share', 'camera', 'share'],
      'phone',
    );
    expect(needs.providers).toEqual([
      {
        name: 'androidx.core.content.FileProvider',
        authority: '${applicationId}.solid.files',
        resource: 'solid_file_paths',
      },
    ]);
    expect(Object.keys(needs.resources)).toEqual(['xml/solid_file_paths.xml']);
    expect(needs.resources['xml/solid_file_paths.xml']).toContain(
      '<cache-path name="cache" path="." />',
    );
    // The camera intent needs no CAMERA permission, and must not get one.
    expect(needs.permissions).toEqual([]);
  });

  test('a TV gets nothing for phone-only services', () => {
    const needs = androidManifestRequirements(
      ['notifications', 'contacts', 'haptics', 'biometrics', 'maps', 'audio'],
      'tv',
    );
    expect(needs.unavailable).toEqual([
      'notifications',
      'contacts',
      'haptics',
      'biometrics',
      'maps',
    ]);
    expect(needs.permissions).toEqual([{ name: PERMISSION + 'INTERNET' }]);
    expect(needs.queries).toEqual([]);
  });

  test('services without an Android provider are reported', () => {
    const absent = ['push', 'microphone', 'thumbnails', 'request'] as const;
    expect(androidManifestRequirements(absent, 'phone').unavailable).toEqual(
      absent,
    );
  });

  test('jobs declare the JobService classes the app names', () => {
    expect(
      androidManifestRequirements(['jobs'], 'tv', { jobs: ['app.SyncJob'] })
        .services,
    ).toEqual([
      { name: 'app.SyncJob', permission: PERMISSION + 'BIND_JOB_SERVICE' },
    ]);
    expect(
      androidManifestRequirements(['audio'], 'tv', { jobs: ['app.SyncJob'] })
        .services,
    ).toEqual([]);
  });

  test('picture-in-picture is an attribute of the activity', () => {
    expect(androidManifestRequirements(['fullscreen'], 'tv').activity).toEqual({
      'android:supportsPictureInPicture': 'true',
    });
  });

  test('an unknown form is refused', () => {
    expect(() =>
      androidManifestRequirements(['audio'], 'watch' as never),
    ).toThrow(TypeError);
  });
});

describe('applyAndroidManifestRequirements', () => {
  const manifest = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../hosts/android/AndroidManifest.xml',
    ),
    'utf8',
  );
  const needs = androidManifestRequirements(ANDROID_SERVICES, 'phone', {
    jobs: ['app.SyncJob'],
  });
  const applied = applyAndroidManifestRequirements(manifest, needs);

  test('the phone manifest declares the network-state permission', () => {
    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    );
  });

  test('entries land where Android reads them', () => {
    const application = applied.indexOf('<application');
    const close = applied.indexOf('</application>');
    const at = (text: string) => applied.indexOf(text);
    expect(at('android.permission.READ_CONTACTS')).toBeLessThan(application);
    expect(at('<queries>')).toBeLessThan(application);
    expect(at('<queries>')).toBeGreaterThan(0);
    expect(at('androidx.core.content.FileProvider')).toBeGreaterThan(
      application,
    );
    expect(at('androidx.core.content.FileProvider')).toBeLessThan(close);
    expect(applied).toContain(
      '<service android:name="app.SyncJob" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="false" />',
    );
    expect(applied).toContain(
      '<activity android:supportsPictureInPicture="true" android:name="com.tns.NativeScriptActivity"',
    );
    expect(applied).toContain(
      '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    );
  });

  test('what the manifest already has is not repeated', () => {
    expect(applied.split('android.permission.INTERNET"').length).toBe(2);
    expect(
      applied.split('android.permission.ACCESS_NETWORK_STATE"').length,
    ).toBe(2);
    expect(applyAndroidManifestRequirements(applied, needs)).toBe(applied);
  });
});

describe('androidServices', () => {
  test('a phone with everything provides every listed service', () => {
    const map = androidServices({
      form: 'phone',
      app: untouched,
      features: everything,
      jobs,
      keyTarget,
      preview: true,
    });
    expect(Object.keys(map).sort()).toEqual([...ANDROID_SERVICES].sort());
  });

  test('services without device evidence are offered only as a preview', () => {
    const map = androidServices({
      form: 'phone',
      app: untouched,
      features: everything,
      jobs,
      keyTarget,
    });
    expect(Object.keys(map).sort()).toEqual(
      ANDROID_SERVICES.filter(
        (name) => !ANDROID_PREVIEW_SERVICES.includes(name),
      ).sort(),
    );
  });

  test('a TV also holds back what was verified on a phone only', () => {
    const offered = (form: 'phone' | 'tv') =>
      Object.keys(
        androidServices({
          form,
          app: untouched,
          features: everything,
          jobs,
          keyTarget,
        }),
      );
    for (const name of ANDROID_TV_PREVIEW_SERVICES) {
      expect(ANDROID_PREVIEW_SERVICES).not.toContain(name);
      expect(offered('phone')).toContain(name);
      expect(offered('tv')).not.toContain(name);
    }
    expect(offered('tv')).toEqual(
      expect.arrayContaining(['download', 'mediaCapabilities']),
    );
  });

  test('a TV never gets the phone-only services', () => {
    const map = androidServices({
      form: 'tv',
      app: untouched,
      features: everything,
      jobs,
      keyTarget,
      preview: true,
    });
    const absent = ANDROID_SERVICES.filter((name) => !(name in map));
    expect(absent.sort()).toEqual([
      'appReview',
      'biometrics',
      'calendar',
      'contacts',
      'haptics',
      'maps',
      'notifications',
      'orientation',
      'systemBars',
    ]);
    expect(absent.sort()).toEqual(
      androidManifestRequirements(ANDROID_SERVICES, 'tv').unavailable.sort(),
    );
  });

  test('what the device or manifest lacks is absent, not stubbed', () => {
    const phone = androidServices({
      form: 'phone',
      app: untouched,
      features: nothing,
      preview: true,
    });
    expect(Object.keys(phone).sort()).toEqual([
      'audio',
      'clipboard',
      'colorScheme',
      'deviceInfo',
      'display',
      'fileSystem',
      'fullscreen',
      'keepAwake',
      'lifecycle',
      'links',
      'locale',
      'mediaCapabilities',
      'mediaSession',
      'memory',
      // Before Android 13 notifications need no declared permission.
      'notifications',
      'orientation',
      'secureStorage',
      'settings',
      'systemBars',
    ]);
    const tv = androidServices({
      form: 'tv',
      app: untouched,
      features: nothing,
      preview: true,
    });
    expect('fullscreen' in tv).toBe(false);
    expect('battery' in tv).toBe(false);
    // Hardware alone is not enough: the manifest must declare the permission.
    const undeclared = androidServices({
      form: 'phone',
      app: untouched,
      features: { ...everything, permissions: [] },
    });
    for (const name of [
      'connectivity',
      'geolocation',
      'contacts',
      'calendar',
      'haptics',
      'biometrics',
      'notifications',
    ])
      expect(name in undeclared, name).toBe(false);
  });

  test('installing constructs nothing and reads no platform class', () => {
    const touched: string[] = [];
    const trap = (root: string): object =>
      new Proxy(
        {},
        {
          get(_target, name) {
            touched.push(`${root}.${String(name)}`);
            return undefined;
          },
        },
      );
    for (const root of ['android', 'java', 'javax', 'androidx', 'org', 'com'])
      vi.stubGlobal(root, trap(root));
    const map = androidServices({
      form: 'tv',
      app: untouched,
      features: everything,
      jobs,
      keyTarget,
    });
    installServices(map);
    expect(touched).toEqual([]);
    expect(serviceAvailable('connectivity')).toBe('available');
    expect(serviceAvailable('orientation')).toBe('unavailable');
    expect(installedServices()).toContain('mediaSession');
    // Every provider but the key target is a function not yet called.
    for (const [name, provider] of Object.entries(map))
      if (name !== 'keyEvents') expect(typeof provider, name).toBe('function');
  });

  test('ports the SDK reads synchronously are there without a load', () => {
    installServices(
      androidServices({
        form: 'phone',
        app: untouched,
        features: everything,
        keyTarget,
        preview: true,
      }),
    );
    // The port objects exist at once; they touch the device when called.
    for (const name of ['memory', 'locale', 'systemBars'] as const)
      expect(peekService(name), name).toBeTypeOf('object');
    expect(peekService('keyEvents')?.target()).toBe(keyTarget);
    // An asynchronous provider is not there yet: it is loading.
    expect(peekService('clipboard')).toBeUndefined();
  });
});

describe('confinePath', () => {
  const files = '/data/user/0/app/files';
  const cache = '/data/user/0/app/cache';
  const roots = [files, cache];
  const confine = (path: string) => confinePath(path, roots, files);

  test('relative paths start at the documents directory', () => {
    expect(confine('notes/a.txt')).toBe(files + '/notes/a.txt');
    expect(confine('./a//b/./c')).toBe(files + '/a/b/c');
    expect(confine('a/../b')).toBe(files + '/b');
  });

  test('absolute paths and file addresses inside a root are kept', () => {
    expect(confine(cache + '/x.bin')).toBe(cache + '/x.bin');
    expect(confine(files)).toBe(files);
    expect(confine('file://' + cache + '/a%20b.txt')).toBe(cache + '/a b.txt');
  });

  test.each([
    '../shared_prefs/secret.xml',
    'a/../../databases/x',
    '/data/user/0/app/files/../shared_prefs/x',
    '/data/user/0/app/filesystem/x',
    '/data/user/0/other/files/x',
    '/sdcard/Download/x',
    '/',
    '',
    'file:///etc/hosts',
    'file://' + files + '/%2e%2e/%2e%2e/x',
    'file://' + files + '/%zz',
    'a\0b',
    '../../../../../../../../etc/passwd',
  ])('refuses %j', (path) => {
    expect(() => confine(path)).toThrow('outside the app directories');
  });

  test('a path that climbs out and back in is judged where it ends', () => {
    expect(confine('../cache/x')).toBe(cache + '/x');
  });
});

/** A NativeScript application object that records its listeners. */
function fakeApp(activity: object) {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const app = {
    context: {} as never,
    foregroundActivity: activity as never,
    on(event: string, handler: (data: never) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler as (data: unknown) => void);
    },
    off(event: string, handler: (data: never) => void) {
      handlers.get(event)?.delete(handler as (data: unknown) => void);
    },
  };
  return {
    app: app as unknown as AndroidApp,
    emit(event: string, data: unknown) {
      for (const handler of Array.from(handlers.get(event) ?? []))
        handler(data);
    },
    listening: () =>
      Array.from(handlers.values()).reduce((sum, set) => sum + set.size, 0),
  };
}

describe('activity results', () => {
  test('listeners exist only while a request is waiting', async () => {
    const codes: number[] = [];
    const activity = {
      startActivityForResult: (_intent: unknown, code: number) =>
        codes.push(code),
    };
    const { app, emit, listening } = fakeApp(activity);
    expect(listening()).toBe(0);
    const first = startForResult(app, {} as never);
    const second = startForResult(app, {} as never);
    // One set of listeners, however many requests are open.
    expect(listening()).toBe(3);
    expect(pendingResults()).toBe(2);
    emit('activityResult', { requestCode: 1, resultCode: -1, intent: null });
    expect(pendingResults()).toBe(2);
    emit('activityResult', {
      requestCode: codes[1],
      resultCode: -1,
      intent: null,
    });
    await expect(second).resolves.toMatchObject({ resultCode: -1 });
    expect(listening()).toBe(3);
    emit('activityResult', {
      requestCode: codes[0],
      resultCode: 0,
      intent: null,
    });
    await expect(first).resolves.toMatchObject({ resultCode: 0 });
    expect(listening()).toBe(0);
    expect(pendingResults()).toBe(0);
  });

  test('a request that cannot start, or loses its activity, rejects', async () => {
    const failing = fakeApp({
      startActivityForResult() {
        throw new Error('No activity found');
      },
    });
    await expect(startForResult(failing.app, {} as never)).rejects.toThrow(
      'No activity found',
    );
    expect(failing.listening()).toBe(0);

    const activity = { startActivityForResult() {} };
    const destroyed = fakeApp(activity);
    const open = startForResult(destroyed.app, {} as never);
    destroyed.emit('activityDestroyed', { activity });
    await expect(open).rejects.toThrow('destroyed');
    expect(destroyed.listening()).toBe(0);
  });
});

describe('androidPermission', () => {
  const LOCATION = PERMISSION + 'ACCESS_FINE_LOCATION';

  function device() {
    const state = {
      granted: false,
      rationale: false,
      prompts: 0,
      answer: (): void => {},
    };
    const flags = new Map<string, boolean>();
    const preferences = {
      getBoolean: (key: string, fallback: boolean) =>
        flags.get(key) ?? fallback,
      edit: () => {
        const editor = {
          putBoolean(key: string, value: boolean) {
            flags.set(key, value);
            return editor;
          },
          apply() {},
        };
        return editor;
      },
    };
    const fake = fakeApp({
      shouldShowRequestPermissionRationale: () => state.rationale,
      requestPermissions(_names: unknown, requestCode: number) {
        state.prompts++;
        state.answer();
        queueMicrotask(() =>
          fake.emit('activityRequestPermissions', { requestCode }),
        );
      },
    });
    Object.assign(fake.app, {
      context: {
        getPackageName: () => 'app',
        getPackageManager: () => ({
          getPackageInfo: () => ({ requestedPermissions: [LOCATION] }),
        }),
        checkSelfPermission: () => (state.granted ? 0 : -1),
        getSharedPreferences: () => preferences,
      },
    });
    vi.stubGlobal('android', {
      content: { pm: { PackageManager: { GET_PERMISSIONS: 4096 } } },
    });
    vi.stubGlobal('java', { lang: { String } });
    // The runtime's Java array constructor.
    (Array as unknown as { create: unknown }).create = (
      _type: unknown,
      length: number,
    ) => new Array(length);
    return { ...fake, state };
  }

  test('reports prompt, granted and denied without prompting', async () => {
    const { app, state } = device();
    const port = androidPermission(app, [LOCATION]);
    expect(await port.query()).toBe('prompt');
    state.granted = true;
    expect(await port.query()).toBe('granted');
    expect(state.prompts).toBe(0);
    expect(await port.request()).toBe('granted');
    expect(state.prompts).toBe(0);
  });

  test('a refusal can be asked again until the system stops asking', async () => {
    const { app, state, listening } = device();
    const port = androidPermission(app, [LOCATION]);
    // Refused once: Android would explain, so it can still be asked for.
    state.answer = () => {
      state.rationale = true;
    };
    expect(await port.request()).toBe('prompt');
    expect(state.prompts).toBe(1);
    // Refused again: no further prompt will be shown.
    state.answer = () => {
      state.rationale = false;
    };
    expect(await port.request()).toBe('denied');
    expect(state.prompts).toBe(2);
    expect(await port.request()).toBe('denied');
    expect(state.prompts).toBe(2);
    expect(listening()).toBe(0);
  });

  test('concurrent requests share one prompt', async () => {
    const { app, state } = device();
    const port = androidPermission(app, [LOCATION]);
    state.answer = () => {
      state.granted = true;
    };
    expect(await Promise.all([port.request(), port.request()])).toEqual([
      'granted',
      'granted',
    ]);
    expect(state.prompts).toBe(1);
  });

  test('a permission the manifest does not declare is unavailable', async () => {
    const { app, state } = device();
    const port = androidPermission(app, [PERMISSION + 'READ_CONTACTS']);
    expect(await port.query()).toBe('unavailable');
    expect(await port.request()).toBe('unavailable');
    expect(state.prompts).toBe(0);
  });
});
