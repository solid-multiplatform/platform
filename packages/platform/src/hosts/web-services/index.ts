/**
 * Every device service the browser can provide. The web host installs
 * `webServices`; nothing in it is imported or constructed until an app first
 * uses the service.
 */
import type { ProviderMap } from '../../sdk/registry.js';
import { deviceServices } from './device.manifest.js';
import { notificationsThrough } from './device.sync.js';
import { mediaServices } from './media.manifest.js';
import { sensorsServices } from './sensors.manifest.js';

export const webServices: ProviderMap = {
  ...deviceServices,
  ...mediaServices,
  ...sensorsServices,
};

/**
 * The browser services that need something only the application knows: its
 * storage namespace and, for push and background sync, its service worker.
 * The web host installs `webAppServices(namespace)` itself; an app with a
 * service worker adds the rest:
 *
 *     installServices(webAppServices('my-app', registration));
 *
 * With a worker, notifications go through it. Push and background jobs are
 * present only where the worker supports them.
 */
export function webAppServices(
  namespace: string,
  worker?: ServiceWorkerRegistration,
): ProviderMap {
  if (!namespace) throw new Error('Settings require an application namespace');
  const load = () => import('./device.js');
  const sync =
    worker &&
    (worker as { sync?: { register(tag: string): Promise<void> } }).sync;
  return {
    settings: () => load().then((m) => m.settings(namespace)),
    // Asking for permission needs the user's gesture: not loaded on first use.
    ...(worker ? { notifications: () => notificationsThrough(worker) } : {}),
    ...(worker?.pushManager
      ? { push: () => load().then((m) => m.push(worker)) }
      : {}),
    ...(sync ? { jobs: () => load().then((m) => m.jobs(sync)) } : {}),
  };
}
