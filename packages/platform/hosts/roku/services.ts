/**
 * The Roku host's device services, for `installServices`. Every entry is a
 * function: nothing touches the device until an app first uses that service.
 * A service the device cannot back is left out and reports `unavailable`.
 */
import {
  getAppInfo,
  getDeviceInfo,
  getRegistry,
} from '@roku-sdk/rsg-ts/runtime';
import type { DeviceInfo } from '@solid-multiplatform/platform/device';
import type {
  ProviderMap,
  Store,
} from '@solid-multiplatform/platform/services';
import type { MediaCapabilities } from '../../src/sdk/drm.js';
import type { RokuKeySource } from './keys';
import { reportError } from './report';

/** The host's media session actions, the shape `src/sdk/media.ts` declares. */
type RokuMediaAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto'
  | 'nexttrack'
  | 'previoustrack';
type RokuMediaHandler = (details: { seekTime: number }) => void;
interface RokuMediaSessionPort {
  setMetadata(metadata: unknown): void;
  setPlaybackState(state: 'none' | 'paused' | 'playing'): void;
  setPositionState(state: unknown): void;
  setActionHandler(
    action: RokuMediaAction,
    handler: RokuMediaHandler | undefined,
  ): void;
}

// ---- the firmware's runtime objects the SDK exports no plain getter for ----

type Params = Record<string, string>;
interface LaunchConfig {
  setLaunchParamsUpdateHandler(
    handler: ((params: Params) => void) | null,
  ): void;
}
interface Input {
  setInputHandler(handler: ((params: Params) => void) | null): void;
}
interface SignalBeacon {
  signal(name: 'AppLaunchComplete'): void;
}
interface DeviceEvents {
  setInternetStatusHandler(handler: ((online: boolean) => void) | null): void;
  setLowGeneralMemoryHandler(handler: ((level: number) => void) | null): void;
}
interface Lifecycle {
  setSuspendHandler(handler: (() => void) | null): void;
  setResumeHandler(
    handler: ((resume: { launchParams?: Params }) => void) | null,
  ): void;
  completeSuspend(): void;
  completeResume(): void;
}
interface DeviceCrypto {
  encrypt(data: ArrayBuffer, type: string): ArrayBuffer;
  decrypt(data: ArrayBuffer, type: string): ArrayBuffer;
}
interface FirmwareRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
interface RokuRuntime {
  getRuntimeSingletonSync<T>(name: string): T;
  getRuntimeSingleton<T>(name: string): Promise<T>;
  DeviceCryptoHostFunc(): DeviceCrypto;
  /** Names to level codes; `normal` is the level with nothing to report. */
  MemoryLevel: Record<string, unknown>;
}

const roku = (): RokuRuntime =>
  (globalThis as unknown as { roku: RokuRuntime }).roku;

/** Tells the firmware the app's first screen is on: a certification beacon. */
export function signalLaunchComplete(): void {
  try {
    roku()
      .getRuntimeSingletonSync<SignalBeacon>('SignalBeacon')
      .signal('AppLaunchComplete');
  } catch (error) {
    reportError('ROKU_BEACON AppLaunchComplete not sent', error);
  }
}

/** What `deviceInfo()` returns on Roku: the port's fields and the video mode. */
export interface RokuDeviceInfo extends DeviceInfo {
  /** The display mode in use, such as `1080p`. */
  displayMode?: string;
}

/**
 * A deep link as one string: `roku://deeplink?contentId=…&mediaType=…`, with
 * every parameter the firmware passed. Null when it names no content.
 */
function linkOf(params: Params | null | undefined): string | null {
  if (!params || (!params.contentId && !params.mediaType)) return null;
  const query: string[] = [];
  for (const key of Object.keys(params))
    query.push(
      encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])),
    );
  return 'roku://deeplink?' + query.join('&');
}

/** A string store on one registry section. Writes are flushed before they resolve. */
async function registryStore(
  name: string,
  write: (value: string) => string,
  read: (stored: string) => string,
): Promise<Store> {
  const registry = await getRegistry();
  const section = registry.create(name);
  return {
    // A key never written reads as an empty string, not null.
    get: (key) =>
      Promise.resolve(section.exists(key) ? read(section.read(key)!) : null),
    async set(key, value) {
      if (!section.write(key, write(value)) || !(await registry.flush()))
        throw new Error('The Roku registry rejected the write.');
    },
    async remove(key) {
      section.delete(key);
      await registry.flush();
    },
  };
}

const same = (value: string): string => value;

// Text to the bytes the device cipher takes, and its output as registry text.
function seal(value: string): string {
  const utf8 = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
  const sealed = new Uint8Array(
    roku().DeviceCryptoHostFunc().encrypt(bytes.buffer, 'channel'),
  );
  let hex = '';
  for (let i = 0; i < sealed.length; i++)
    hex += (sealed[i]! < 16 ? '0' : '') + sealed[i]!.toString(16);
  return hex;
}
function unseal(hex: string): string {
  const sealed = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sealed.length; i++)
    sealed[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const bytes = new Uint8Array(
    roku().DeviceCryptoHostFunc().decrypt(sealed.buffer, 'channel'),
  );
  let utf8 = '';
  for (let i = 0; i < bytes.length; i++) utf8 += String.fromCharCode(bytes[i]!);
  return decodeURIComponent(escape(utf8));
}

/**
 * The W3C Media Session port, backed by the remote's transport keys. No
 * handler is installed until an app (the video adapter) registers one, so an
 * app that does not play media pays no listener. `src/sdk/media.ts` declares
 * the same port; this module does not import it because a host build
 * type-checks that file without its `shortcuts` augmentation.
 */
function rokuMediaSession(keys: RokuKeySource): RokuMediaSessionPort {
  const handlers = new Map<RokuMediaAction, RokuMediaHandler>();
  let playbackState: 'none' | 'paused' | 'playing' = 'none';
  const emit = (action: RokuMediaAction, seekTime = 0) => {
    const handler = handlers.get(action);
    if (!handler) return;
    try {
      handler({ seekTime });
    } catch (error) {
      reportError('ROKU_MEDIA_SESSION handler failed', error);
    }
  };
  const onKey = (event: { key?: string }) => {
    switch (event.key) {
      case 'MediaPlayPause':
        emit(playbackState === 'playing' ? 'pause' : 'play');
        break;
      case 'MediaPlay':
        emit('play');
        break;
      case 'MediaPause':
        emit('pause');
        break;
      case 'MediaStop':
        emit('stop');
        break;
      case 'MediaRewind':
      case 'InstantReplay':
        emit('seekbackward');
        break;
      case 'MediaFastForward':
        emit('seekforward');
        break;
      case 'MediaTrackNext':
        emit('nexttrack');
        break;
      case 'MediaTrackPrevious':
        emit('previoustrack');
        break;
    }
  };
  let listening = false;
  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    if (on) keys.addEventListener('keydown', onKey);
    else keys.removeEventListener('keydown', onKey);
  };
  return {
    setMetadata(_metadata: unknown) {},
    setPlaybackState(state) {
      playbackState = state;
    },
    setPositionState(_state: unknown) {},
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
      listen(handlers.size > 0);
    },
  };
}

export function rokuServices(
  namespace: string,
  keys: RokuKeySource,
): ProviderMap {
  const linkListeners = new Set<(link: string) => void>();
  const emitLink = (params: Params | undefined) => {
    const link = linkOf(params);
    if (link !== null) linkListeners.forEach((each) => each(link));
  };
  const providers: ProviderMap = {
    // One registry section per app namespace.
    settings: () => registryStore(namespace, same, same),
    // The same, with each value encrypted by the device under the channel's
    // key (roDeviceCrypto): another channel or device cannot read it.
    secureStorage: () => registryStore(namespace + '.secure', seal, unseal),
    deviceInfo: () => ({
      get(): Promise<RokuDeviceInfo> {
        const device = getDeviceInfo();
        const os = device?.osVersion;
        return Promise.resolve({
          platform: 'roku',
          model: device?.model,
          osVersion: os && `${os.major}.${os.minor}.${os.revision}`,
          appVersion: getAppInfo()?.version,
          displayMode: device?.videoMode,
        });
      },
    }),
    locale: () => ({
      // The firmware reports `en_US`; BCP 47 separates with a hyphen.
      current: () =>
        (getDeviceInfo()?.currentLocale || 'en-US').replace(/_/g, '-'),
    }),
    // The firmware raises an event when the general memory level changes;
    // from first use on, the last level is kept.
    memory: () => {
      let low = false;
      const levels = roku().MemoryLevel;
      roku()
        .getRuntimeSingletonSync<DeviceEvents>('DeviceInfo')
        .setLowGeneralMemoryHandler((level) => {
          low = !Object.keys(levels).some(
            (name) => levels[name] === level && /^normal$/i.test(name),
          );
        });
      return { get: () => ({ lowMemory: low }) };
    },
    // Internet reachability, as the firmware reports changes of it. The
    // handler is set only while someone is subscribed; there is no way to
    // ask, so the device counts as online until the firmware says otherwise.
    connectivity: () => {
      let online = true;
      const listeners = new Set<(online: boolean) => void>();
      const events = () =>
        roku().getRuntimeSingletonSync<DeviceEvents>('DeviceInfo');
      return {
        online: () => online,
        subscribe(listener) {
          if (listeners.size === 0)
            events().setInternetStatusHandler((now) => {
              online = now;
              listeners.forEach((each) => each(now));
            });
          listeners.add(listener);
          return () => {
            if (listeners.delete(listener) && listeners.size === 0)
              events().setInternetStatusHandler(null);
          };
        },
      };
    },
    // Launch parameters, and `roInput` events while running. The input
    // handler is set only while someone is subscribed.
    links: () => {
      let initial: string | null = null;
      // The firmware calls the handler with the launch parameters as it is set.
      const launch =
        roku().getRuntimeSingletonSync<LaunchConfig>('LaunchConfig');
      launch.setLaunchParamsUpdateHandler((params) => {
        initial = linkOf(params);
      });
      launch.setLaunchParamsUpdateHandler(null);
      // The firmware hands out its input object asynchronously.
      let input: Promise<Input> | undefined;
      const listen = (on: boolean) => {
        input ??= roku().getRuntimeSingleton<Input>('Input');
        void input.then(
          (port) => {
            // Subscribers may have come or gone while it was on its way.
            if (on !== linkListeners.size > 0) return;
            port.setInputHandler(on ? emitLink : null);
          },
          (error: unknown) => reportError('ROKU_INPUT unavailable', error),
        );
      };
      return {
        initial: () => initial,
        subscribe(listener) {
          linkListeners.add(listener);
          if (linkListeners.size === 1) listen(true);
          return () => {
            if (linkListeners.delete(listener) && linkListeners.size === 0)
              listen(false);
          };
        },
      };
    },
    // The firmware's fetch takes one argument, a URL or a Request.
    request: () => ({
      fetch: ((input: string | { url: string }, init?: FirmwareRequestInit) => {
        const url = typeof input === 'string' ? input : input.url;
        const scope = globalThis as unknown as {
          fetch(request: unknown): Promise<unknown>;
          Request(url: string, init: FirmwareRequestInit): unknown;
        };
        if (!init) return scope.fetch(url);
        // Only what the firmware's Request reads, and only what was given.
        const request: FirmwareRequestInit = {};
        if (init.method) request.method = init.method;
        if (init.headers) request.headers = init.headers;
        if (init.body !== undefined) request.body = init.body;
        return scope.fetch(scope.Request(url, request));
      }) as unknown as typeof fetch,
    }),
    keyEvents: () => ({
      target: () => keys as unknown as EventTarget,
    }),
    // What the device decodes and protects. `roku.hasFeature` is the firmware
    // query; without it, the documented Roku playback set, with HDR and DRM
    // reported only when the firmware confirms them.
    mediaCapabilities: () => {
      let known: MediaCapabilities | undefined;
      return {
        async get() {
          if (known) return known;
          const runtime = (
            globalThis as {
              roku?: { hasFeature?(key: string): boolean };
            }
          ).roku;
          const query =
            typeof runtime?.hasFeature === 'function'
              ? (key: string) => runtime.hasFeature!(key)
              : undefined;
          const codecs = [
            'video/mp4; codecs="avc1.42E01E"',
            'audio/mp4; codecs="mp4a.40.2"',
            'application/vnd.apple.mpegurl',
            'application/dash+xml',
          ];
          if (query?.('hevc') ?? true)
            codecs.push('video/mp4; codecs="hvc1.1.6.L93.B0"');
          const drm = [
            'com.microsoft.playready',
            'com.widevine.alpha',
            'com.apple.fps',
          ].filter((_scheme, index) => {
            if (!query) return true;
            return query(
              ['playready', 'widevine', 'fairplay'][index] as string,
            );
          });
          const hdr =
            (query?.('hdr10') ?? false) || (query?.('dolby_vision') ?? false);
          known = { drm, codecs, hdr };
          return known;
        },
      };
    },
  };
  // `mediaSession` is a port `src/sdk/media.ts` also declares. It is added
  // here rather than in the literal because this host build must not pull that
  // module into its type graph (see `rokuMediaSession`).
  (providers as unknown as Record<string, unknown>).mediaSession = () =>
    rokuMediaSession(keys);
  // Suspend and resume exist only for a channel whose manifest opts in to
  // Instant Resume.
  if (getAppInfo()?.getManifestValue('sdk_instant_resume') !== '1')
    return providers;
  return {
    ...providers,
    lifecycle: async () => {
      const api = await roku().getRuntimeSingleton<Lifecycle>('LifecycleAPI');
      let active = true;
      const listeners = new Set<(active: boolean) => void>();
      const change = (now: boolean) => {
        active = now;
        listeners.forEach((each) => each(now));
      };
      api.setSuspendHandler(() => {
        change(false);
        api.completeSuspend();
      });
      api.setResumeHandler((resume) => {
        change(true);
        // A deep link that resumed the app, to the links subscribers.
        emitLink(resume.launchParams);
        api.completeResume();
      });
      return {
        active: () => active,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    },
  };
}
