// The Android service probe's app: one step per service, run by a deep link
//
//   solidprobe://run/<step>?id=<result id>&<argument>=<value>
//
// and answered with a JSON file, files/probe/<id>.json, that the driver
// (../android-probe.mjs) reads with `run-as`. Steps go through the SDK
// functions an app would call, so each one exercises the registry, the lazy
// manifest and the provider behind it.
import { Application, File, knownFolders } from '@nativescript/core';
import {
  Config,
  createRenderer,
  loadFonts,
} from '@solid-multiplatform/platform';
import {
  createAudioPlayer,
  type AudioPlayer,
} from '@solid-multiplatform/platform/audio';
import { authenticate } from '@solid-multiplatform/platform/biometrics';
import { getCalendarEvents } from '@solid-multiplatform/platform/calendar';
import { capturePhoto } from '@solid-multiplatform/platform/capture';
import { getContacts } from '@solid-multiplatform/platform/contacts';
import * as device from '@solid-multiplatform/platform/device';
import {
  downloadText,
  downloadUrl,
} from '@solid-multiplatform/platform/download';
import { mediaCapabilities } from '@solid-multiplatform/platform/drm';
import * as files from '@solid-multiplatform/platform/files';
import {
  getCurrentPosition,
  watchPosition,
} from '@solid-multiplatform/platform/geolocation';
import { openDirections, openMap } from '@solid-multiplatform/platform/maps';
import {
  configureMediaSession,
  enterFullscreen,
  enterPictureInPicture,
  exitFullscreen,
} from '@solid-multiplatform/platform/media';
import { createPermissions } from '@solid-multiplatform/platform/permissions';
import {
  sensorAvailable,
  watchSensor,
  type SensorType,
} from '@solid-multiplatform/platform/sensors';
import {
  installedServices,
  installServices,
  loadService,
  peekService,
  serviceAvailable,
  type ServiceName,
} from '@solid-multiplatform/platform/services';
import {
  ANDROID_PREVIEW_SERVICES,
  ANDROID_TV_PREVIEW_SERVICES,
  androidPermissions,
  androidServices,
  detectAndroidFeatures,
} from '@solid-multiplatform/platform/services/android';
import { createShortcuts } from '@solid-multiplatform/platform/shortcuts';
import {
  bindColorScheme,
  useColorScheme,
} from '@solid-multiplatform/platform/theme';

declare const android: any;
declare const java: any;

type Args = Record<string, string>;
type Step = (args: Args, id: string) => unknown;
/** Returned by a step that keeps writing its own result file. */
const RECORDING = Symbol('recording');

const directory = knownFolders.documents().path + '/probe';
new java.io.File(directory).mkdirs();
const write = (id: string, result: unknown): void =>
  File.fromPath(`${directory}/${id}.json`).writeTextSync(
    JSON.stringify(result),
  );
const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** A subscription's events, rewritten to its result file as they arrive. */
function recorder(id: string, initial: Record<string, unknown> = {}) {
  const events: unknown[] = [];
  const flush = () => write(id, { ok: true, value: { ...initial, events } });
  flush();
  return (event: unknown) => {
    events.push(event);
    flush();
  };
}

const subscriptions = new Map<string, () => void>();
const stop = (name: string): boolean => {
  const dispose = subscriptions.get(name);
  subscriptions.delete(name);
  dispose?.();
  return dispose !== undefined;
};

/** The longest gap between frames while `work` runs: main-thread stalls. */
async function frameGaps<T>(work: () => Promise<T>) {
  const choreographer = android.view.Choreographer.getInstance();
  let last = 0;
  let worst = 0;
  let frames = 0;
  let running = true;
  const callback = new android.view.Choreographer.FrameCallback({
    doFrame(nanos: number) {
      if (last) worst = Math.max(worst, (nanos - last) / 1e6);
      last = nanos;
      frames++;
      if (running) choreographer.postFrameCallback(callback);
    },
  });
  choreographer.postFrameCallback(callback);
  const started = Date.now();
  try {
    return { value: await work(), ms: Date.now() - started, frames, worst };
  } finally {
    running = false;
  }
}

/** Two seconds of a 440 Hz tone as a WAV file. */
function tone(): Uint8Array {
  const rate = 8000;
  const samples = rate * 2;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000),
      true,
    );
  return bytes;
}

export function mount(
  _plugins: unknown,
  fontRoot?: string,
  _input?: unknown,
  host?: { target?: string },
) {
  const form = host?.target === 'android-tv' ? 'tv' : 'phone';
  const app = Application.android as any;

  // What the host installed by itself, before the probe adds its own layer.
  const hostServices = installedServices();
  const started = Date.now();
  const features = detectAndroidFeatures(app);
  const detectMs = Date.now() - started;
  const removeServices = installServices(
    androidServices({
      form,
      app,
      features,
      namespace: 'probe',
      jobs: {
        // An hour away: the driver forces it with `cmd jobscheduler run`.
        probe: {
          className: 'dev.solidprobe.ProbeJobService',
          id: 7001,
          delayMs: 3600000,
        },
      },
      keyTarget: form === 'tv' ? (globalThis as any).document : undefined,
      preview: true,
    }),
  );
  const permissions = createPermissions(androidPermissions(app));
  let player: AudioPlayer | undefined;
  let restoreBars: (() => void) | undefined;
  let stopSession: (() => void) | undefined;

  const steps: Record<string, Step> = {
    boot: () => ({
      form,
      hostServices,
      services: installedServices(),
      // Everything else is offered by default, and `verify` must pass it.
      preview: [
        ...ANDROID_PREVIEW_SERVICES,
        ...(form === 'tv' ? ANDROID_TV_PREVIEW_SERVICES : []),
      ],
      features,
      detectMs,
      keyboardEvent: typeof (globalThis as any).KeyboardEvent,
      fetch: typeof globalThis.fetch,
      sdk: android.os.Build.VERSION.SDK_INT,
    }),
    available: (args) =>
      Object.fromEntries(
        args
          .names!.split(',')
          .map((name) => [name, serviceAvailable(name as ServiceName)]),
      ),

    clipboard: async (args) => {
      await device.writeClipboard(args.text!);
      return device.readClipboard();
    },
    'clipboard-read': () => device.readClipboard(),
    share: (args) =>
      device.share({ title: 'Probe', text: args.text, url: args.url }),
    'share-file': async () => {
      await files.writeFileText('share/probe.txt', 'shared by the probe');
      const port = (await loadService('share')) as any;
      return port.share({ title: 'Probe file', files: ['share/probe.txt'] });
    },
    haptics: async (args) => {
      if (args.ms) await device.vibrate(Number(args.ms));
      else await device.impact('heavy');
      return 'done';
    },
    deviceInfo: () => device.deviceInfo(),
    battery: () => device.batteryState(),
    memory: () => device.deviceMemory(),
    keepAwake: async (args) => {
      await device.keepAwake(args.on === '1');
      return args.on === '1';
    },
    orientation: async (args) => {
      await device.lockOrientation(args.lock as device.OrientationLock);
      return args.lock;
    },
    systemBars: (args) => {
      restoreBars?.();
      restoreBars =
        args.restore === '1'
          ? undefined
          : device.applySystemBarStyle({
              statusBarColor: 0xffff0000,
              navigationBarColor: 0xff00ff00,
              lightStatusIcons: args.light === '1',
              lightNavigationIcons: args.light === '1',
            });
      return args;
    },
    openExternal: async (args) => {
      await device.openExternal(args.url!);
      return args.url;
    },

    settings: async (args) => {
      const store = await loadService('settings');
      if (args.set !== undefined) await store.set(args.key!, args.set);
      if (args.remove === '1') await store.remove(args.key!);
      return store.get(args.key!);
    },
    secure: async (args) => {
      const store = await loadService('secureStorage');
      if (args.set !== undefined) await store.set(args.key!, args.set);
      if (args.remove === '1') await store.remove(args.key!);
      return store.get(args.key!);
    },
    lifecycle: async () => (await loadService('lifecycle')).active(),
    'lifecycle-subscribe': async (_args, id) => {
      const port = await loadService('lifecycle');
      const record = recorder(id, { active: port.active() });
      subscriptions.set('lifecycle', port.subscribe(record));
      return RECORDING;
    },
    connectivity: async () => (await loadService('connectivity')).online(),
    'connectivity-subscribe': async (_args, id) => {
      const port = await loadService('connectivity');
      const record = recorder(id, { online: port.online() });
      subscriptions.set('connectivity', port.subscribe(record));
      return RECORDING;
    },
    unsubscribe: (args) => stop(args.name!),
    notify: async (args) => {
      const port = await loadService('notifications');
      await port.show({
        id: args.tag,
        title: args.title ?? 'Probe notification',
        body: args.body ?? 'from the Android probe',
        data: { probe: 'yes' },
      });
      return port.permission();
    },
    'notification-permission': async () =>
      (await loadService('notifications')).permission(),
    'notification-request': async () =>
      (await loadService('notifications')).request(),
    permission: (args) => permissions.query(args.name!),
    'permission-request': (args) => permissions.request(args.name!),
    job: async () => {
      await (await loadService('jobs')).schedule('probe');
      return 'scheduled';
    },
    locale: () => peekService('locale')?.current(),
    colorScheme: () => peekService('colorScheme')?.current(),
    'colorScheme-subscribe': (_args, id) => {
      const record = recorder(id, {
        current: peekService('colorScheme')?.current(),
      });
      const unbind = bindColorScheme();
      const unsubscribe = peekService('colorScheme')!.subscribe((scheme) =>
        record({ scheme, signal: useColorScheme() }),
      );
      subscriptions.set('colorScheme', () => {
        unbind();
        unsubscribe();
      });
      return RECORDING;
    },
    keys: (_args, id) => {
      const target = peekService('keyEvents')!.target();
      const record = recorder(id);
      const listener = (event: any) =>
        record({ type: event.type, key: event.key });
      target.addEventListener('keydown', listener);
      const layer = createShortcuts([
        {
          combo: 'ArrowDown',
          handler: () => record({ shortcut: 'ArrowDown' }),
        },
      ]);
      subscriptions.set('keys', () => {
        target.removeEventListener('keydown', listener);
        layer.dispose();
      });
      return RECORDING;
    },

    biometrics: (args) =>
      authenticate({
        reason: 'Probe sign-in',
        fallbackTitle: args.fallback === '1' ? 'Use PIN' : undefined,
      }),
    camera: () => capturePhoto(),
    fs: async () => {
      const directories = files.fileDirectories();
      await files.writeFileText('probe-fs/a.txt', 'héllo ✓');
      const bytes = new Uint8Array(70000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 251;
      // A view over part of a buffer must be written as only that part.
      await files.writeFileBytes(
        directories.cache + '/probe-fs/b.bin',
        bytes.subarray(1000, 66000),
      );
      const back = await files.readFileBytes(
        directories.cache + '/probe-fs/b.bin',
      );
      const refused: Record<string, string> = {};
      for (const path of [
        '../outside.txt',
        'probe-fs/../../shared_prefs/x.xml',
        '/data/local/tmp/x',
        'file:///sdcard/x',
        directories.documents + '/../databases/x',
      ]) {
        try {
          await files.readFileText(path);
          refused[path] = 'READ';
        } catch (error) {
          refused[path] = describe(error);
        }
      }
      const listed = await files.listFiles('probe-fs');
      await files.removeFile('probe-fs/a.txt');
      return {
        directories,
        text: await files
          .readFileText('probe-fs/a.txt')
          .catch(() => 'gone after remove'),
        bytesMatch:
          back.length === 65000 &&
          back.every((value, i) => value === ((i + 1000) * 7) % 251),
        listed,
        existsAfterRemove: await files.fileExists('probe-fs/a.txt'),
        refused,
      };
    },
    'fs-read': (args) => files.readFileText(args.path!),
    // Not a service: what the runtime's own `fetch` does, for the `request`
    // provider Android does not have yet.
    fetch: async (args) => {
      const started = Date.now();
      const response = await Promise.race([
        globalThis.fetch(args.url!),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('no answer in 8 s')), 8000),
        ),
      ]);
      return {
        status: response.status,
        text: (await response.text()).slice(0, 80),
        ms: Date.now() - started,
      };
    },
    pick: async (args) => {
      const picked = await files.pickFiles({
        accept: args.accept,
        multiple: args.multiple === '1',
      });
      return Promise.all(
        picked.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          text: (await file.text()).slice(0, 80),
          bytes: (await file.bytes()).length,
        })),
      );
    },
    download: async (args) => {
      await downloadText(args.text ?? 'probe download', args.name!);
      return args.name;
    },
    'download-url': (args) => {
      downloadUrl(args.url!, args.name);
      return args.name;
    },
    geo: (args) =>
      getCurrentPosition({
        enableHighAccuracy: true,
        timeout: Number(args.timeout ?? 20000),
      }),
    'geo-watch': (_args, id) => {
      const record = recorder(id);
      subscriptions.set(
        'geo',
        watchPosition({ enableHighAccuracy: true }, record),
      );
      return RECORDING;
    },
    sensors: () =>
      Object.fromEntries(
        (
          [
            'accelerometer',
            'gyroscope',
            'magnetometer',
            'barometer',
            'light',
            'proximity',
            'step-counter',
          ] as SensorType[]
        ).map((type) => [type, sensorAvailable(type)]),
      ),
    'sensor-watch': (args, id) => {
      let count = 0;
      let latest: unknown;
      const flush = () => write(id, { ok: true, value: { count, latest } });
      flush();
      subscriptions.set(
        'sensor',
        watchSensor(args.type as SensorType, (reading) => {
          latest = reading;
          // Not every reading: the file write would dominate the measurement.
          if (count++ % 10 === 0) flush();
        }),
      );
      return RECORDING;
    },
    maps: async (args) => {
      if (args.to)
        await openDirections({
          destination: args.to,
          mode: args.mode as never,
        });
      else
        await openMap({
          center: { latitude: 52.37, longitude: 4.9 },
          markers: [{ latitude: 52.37, longitude: 4.9, title: 'Probe' }],
          zoom: 12,
        });
      return 'opened';
    },
    contacts: async (args) => {
      const measured = await frameGaps(() =>
        getContacts({
          search: args.search,
          limit: args.limit ? Number(args.limit) : undefined,
          ...(args.after ? { after: args.after } : {}),
        } as never),
      );
      return {
        count: measured.value.length,
        ms: measured.ms,
        frames: measured.frames,
        worstFrameGapMs: Math.round(measured.worst * 10) / 10,
        first: measured.value.slice(0, 2),
        last: measured.value[measured.value.length - 1]?.id,
      };
    },
    'contacts-seed': (args) => {
      // Test data only: the provider under test never writes contacts.
      const resolver = app.context.getContentResolver();
      const Contract = android.provider.ContactsContract;
      const Operation = android.content.ContentProviderOperation;
      const start = Number(args.from ?? 0);
      const total = start + Number(args.count ?? 300);
      for (let from = start; from < total; from += 50) {
        const batch = new java.util.ArrayList();
        for (let i = from; i < Math.min(total, from + 50); i++) {
          const raw = batch.size();
          batch.add(
            Operation.newInsert(Contract.RawContacts.CONTENT_URI)
              .withValue('account_type', null)
              .withValue('account_name', null)
              .build(),
          );
          const data = (mimetype: string, values: Record<string, string>) => {
            const insert = Operation.newInsert(Contract.Data.CONTENT_URI)
              .withValueBackReference('raw_contact_id', raw)
              .withValue('mimetype', mimetype);
            for (const [name, value] of Object.entries(values))
              insert.withValue(name, value);
            batch.add(insert.build());
          };
          data('vnd.android.cursor.item/name', {
            data1: `Seed Person${i}`,
            data2: 'Seed',
            data3: `Person${i}`,
          });
          data('vnd.android.cursor.item/phone_v2', {
            data1: `+3120555${String(i).padStart(4, '0')}`,
            data2: '2',
          });
          data('vnd.android.cursor.item/email_v2', {
            data1: `seed${i}@example.test`,
            data2: '2',
          });
        }
        resolver.applyBatch(Contract.AUTHORITY, batch);
      }
      return total;
    },
    calendar: async (args) => {
      const measured = await frameGaps(() =>
        getCalendarEvents({
          start: Number(args.start),
          end: Number(args.end),
          limit: args.limit ? Number(args.limit) : undefined,
        }),
      );
      return {
        events: measured.value,
        ms: measured.ms,
        worstFrameGapMs: Math.round(measured.worst * 10) / 10,
      };
    },
    'audio-play': async () => {
      const directories = files.fileDirectories();
      const path = directories.cache + '/probe-tone.wav';
      await files.writeFileBytes(path, tone());
      player ??= createAudioPlayer();
      await player.play(
        { id: 'tone', url: 'file://' + path, title: 'Probe tone' },
        { volume: 0.2 },
      );
      return { playing: player.playing(), track: player.track()?.id };
    },
    'audio-pause': async () => {
      await player?.pause();
      return { playing: player?.playing() };
    },
    'audio-stop': async () => {
      await player?.stop();
      return { playing: player?.playing() };
    },
    'media-session': (_args, id) => {
      const record = recorder(id);
      stopSession?.();
      stopSession = configureMediaSession({
        metadata: { title: 'Probe Track', artist: 'Solid Probe' },
        playbackState: 'playing',
        position: { duration: 120, position: 5 },
        actions: {
          play: () => record('play'),
          pause: () => record('pause'),
          nexttrack: () => record('nexttrack'),
          stop: () => record('stop'),
        },
      });
      return RECORDING;
    },
    'media-session-clear': () => {
      stopSession?.();
      stopSession = undefined;
      return 'cleared';
    },
    fullscreen: async (args) => {
      if (args.on === '1') await enterFullscreen();
      else await exitFullscreen();
      return args.on;
    },
    pip: async () => {
      await enterPictureInPicture();
      return 'entered';
    },
    mediaCapabilities: () => mediaCapabilities(),
  };

  async function run(link: string): Promise<void> {
    const match = /^solidprobe:\/\/run\/([^?]+)(?:\?(.*))?$/.exec(link);
    if (!match) return;
    const args: Args = {};
    for (const pair of (match[2] ?? '').split('&')) {
      if (!pair) continue;
      const at = pair.indexOf('=');
      args[decodeURIComponent(at < 0 ? pair : pair.slice(0, at))] =
        at < 0 ? '' : decodeURIComponent(pair.slice(at + 1));
    }
    const name = match[1]!;
    const id = args.id ?? name;
    try {
      const step = steps[name];
      if (!step) throw new Error('Unknown probe step: ' + name);
      const value = await step(args, id);
      if (value !== RECORDING) write(id, { ok: true, value: value ?? null });
    } catch (error) {
      write(id, { ok: false, error: describe(error) });
    }
  }

  // The links service is the probe's own command channel.
  let stopLinks = () => {};
  void loadService('links').then((links) => {
    stopLinks = links.subscribe((link) => void run(link));
    const initial = links.initial();
    if (initial) void run(initial);
  });

  // A scene, so the probe is an ordinary app with a renderer to keep smooth.
  if (fontRoot) {
    void loadFonts([
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasUrl: fontRoot + '/Lato-Regular.msdf.png',
        atlasDataUrl: fontRoot + '/Lato-Regular.msdf.json',
      },
    ]).catch((error: unknown) => console.error(error));
    Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  }
  const { render } = createRenderer();
  const dispose = render(() => (
    <view width={1920} height={1080} color="#101820ff">
      <text x={48} y={48} color="#ffffffff">
        Android service probe
      </text>
    </view>
  ));
  return () => {
    stopLinks();
    for (const name of Array.from(subscriptions.keys())) stop(name);
    stopSession?.();
    restoreBars?.();
    removeServices();
    dispose();
  };
}
