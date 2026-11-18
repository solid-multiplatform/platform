import {
  Application,
  ApplicationSettings,
  Connectivity,
} from '@nativescript/core';
import { androidLinks } from './providers.mjs';

/**
 * The phone and TV host's application services, for `installServices`.
 * Application-owned push, secure-store and job providers can augment the
 * device's ports.
 */
export function mobileServices(namespace, extensions = {}) {
  const key = (k) => namespace + ':' + k;
  return {
    settings: {
      async get(k) {
        return ApplicationSettings.getString(key(k), null);
      },
      async set(k, v) {
        ApplicationSettings.setString(key(k), v);
      },
      async remove(k) {
        ApplicationSettings.remove(key(k));
      },
    },
    connectivity: {
      online: () =>
        Connectivity.getConnectionType() !== Connectivity.connectionType.none,
      subscribe(fn) {
        return listenConnectivity(fn);
      },
    },
    lifecycle: {
      active: () => !Application.inBackground,
      subscribe(fn) {
        const enter = () => fn(true),
          exit = () => fn(false);
        Application.on('resume', enter);
        Application.on('suspend', exit);
        return () => {
          Application.off('resume', enter);
          Application.off('suspend', exit);
        };
      },
    },
    ...(typeof globalThis.fetch === 'function'
      ? { request: { fetch: globalThis.fetch.bind(globalThis) } }
      : {}),
    ...(Application.android ? { links: androidLinks() } : {}),
    ...extensions,
  };
}
const connectivityListeners = new Set();
function listenConnectivity(listener) {
  if (!connectivityListeners.size)
    Connectivity.startMonitoring((type) => {
      for (const fn of connectivityListeners)
        fn(type !== Connectivity.connectionType.none);
    });
  connectivityListeners.add(listener);
  return () => {
    connectivityListeners.delete(listener);
    if (!connectivityListeners.size) Connectivity.stopMonitoring();
  };
}
