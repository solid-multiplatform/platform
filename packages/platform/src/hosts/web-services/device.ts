/**
 * The browser's device and application services that can wait for their code.
 * Loaded on first use of any of them (see ./device.manifest.ts); nothing here
 * runs at import. The ones a browser allows only inside a user gesture are in
 * ./device.sync.ts instead.
 *
 * Every port reads its browser API when an operation is called, never when the
 * port is built.
 */
import type {
  BatteryPort,
  DeviceInfoPort,
  HapticsPort,
} from '../../sdk/device.js';
import {
  subscribeEvent,
  type ConnectivityPort,
  type JobsPort,
  type LifecyclePort,
  type LinksPort,
  type PushPort,
  type RequestPort,
  type Store,
} from '../../sdk/services.js';

// A browser without the Vibration API has no haptics: a silent no-op.
const vibrateWeb = (milliseconds: number): void => {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(milliseconds);
};

export const haptics: HapticsPort = {
  async impact(style) {
    vibrateWeb(style === 'light' ? 10 : style === 'heavy' ? 35 : 20);
  },
  async vibrate(milliseconds) {
    vibrateWeb(milliseconds);
  },
};

export const deviceInfo: DeviceInfoPort = {
  async get() {
    return {
      platform: 'web',
      model: navigator.userAgent,
      userAgent: navigator.userAgent,
    };
  },
};

export const battery: BatteryPort = {
  async get() {
    const nav = navigator as {
      getBattery?(): Promise<{ level: number; charging: boolean }>;
    };
    if (typeof nav.getBattery !== 'function') return undefined;
    const state = await nav.getBattery();
    return { level: state.level, charging: state.charging };
  },
};

export const request: RequestPort = {
  fetch: (input, init) => fetch(input, init),
};

/** `localStorage` under the application's namespace. */
export function settings(namespace: string): Store {
  const key = (name: string) => namespace + ':' + name;
  return {
    async get(name) {
      return localStorage.getItem(key(name));
    },
    async set(name, value) {
      localStorage.setItem(key(name), value);
    },
    async remove(name) {
      localStorage.removeItem(key(name));
    },
  };
}

const onWindow = (events: string[], listener: () => void) => {
  const releases = events.map((type) => subscribeEvent(window, type, listener));
  return () => releases.forEach((release) => release());
};

export const lifecycle: LifecyclePort = {
  active: () => !document.hidden,
  subscribe: (listener) =>
    subscribeEvent(document, 'visibilitychange', () =>
      listener(!document.hidden),
    ),
};

export const links: LinksPort = {
  initial: () => location.href,
  subscribe: (listener) =>
    onWindow(['popstate', 'hashchange'], () => listener(location.href)),
};

export const connectivity: ConnectivityPort = {
  online: () => navigator.onLine,
  subscribe: (listener) =>
    onWindow(['online', 'offline'], () => listener(navigator.onLine)),
};

export function push(worker: ServiceWorkerRegistration): PushPort {
  return {
    async register(publicKey) {
      const existing = await worker.pushManager.getSubscription();
      const bytes = Uint8Array.from(
        atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      );
      if (existing) {
        const previous = existing.options.applicationServerKey;
        if (
          previous &&
          bytes.length === previous.byteLength &&
          bytes.every((v, i) => v === new Uint8Array(previous)[i])
        )
          return existing.toJSON();
        throw new Error('Push subscription uses another application key');
      }
      return (
        await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        })
      ).toJSON();
    },
    async unregister() {
      const subscription = await worker.pushManager.getSubscription();
      if (subscription && !(await subscription.unsubscribe()))
        throw new Error('Push unsubscribe failed');
    },
  };
}

/** Background Sync: Chromium only, so the caller checks for `worker.sync`. */
export function jobs(sync: { register(tag: string): Promise<void> }): JobsPort {
  return { schedule: (id) => sync.register(id) };
}
