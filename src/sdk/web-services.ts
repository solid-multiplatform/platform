import {
  services,
  subscribeEvent,
  type AppServices,
  type Permission,
} from './services.js';

export function webServices(
  namespace: string,
  worker?: ServiceWorkerRegistration,
) {
  if (!namespace) throw new Error('Settings require an application namespace');
  const key = (k: string) => namespace + ':' + k;
  const listeners = (events: string[], fn: () => void) => {
    const releases = events.map((e) => subscribeEvent(window, e, fn));
    return () => releases.forEach((f) => f());
  };
  const ports: AppServices = {
    request: (input, init) => fetch(input, init),
    settings: {
      async get(k) {
        return localStorage.getItem(key(k));
      },
      async set(k, v) {
        localStorage.setItem(key(k), v);
      },
      async remove(k) {
        localStorage.removeItem(key(k));
      },
    },
    lifecycle: {
      active: () => !document.hidden,
      subscribe: (fn) =>
        subscribeEvent(document, 'visibilitychange', () =>
          fn(!document.hidden),
        ),
    },
    links: {
      initial: () => location.href,
      subscribe: (fn) =>
        listeners(['popstate', 'hashchange'], () => fn(location.href)),
    },
    connectivity: {
      online: () => navigator.onLine,
      subscribe: (fn) =>
        listeners(['online', 'offline'], () => fn(navigator.onLine)),
    },
  };
  if (typeof Notification !== 'undefined') {
    const permission = (p: NotificationPermission): Permission =>
      p === 'default' ? 'prompt' : p;
    ports.notifications = {
      permission: async () => permission(Notification.permission),
      request: async () => permission(await Notification.requestPermission()),
      async show({ title, body, id: tag, data }) {
        if (Notification.permission !== 'granted')
          throw new Error('Notification permission required');
        if (worker) await worker.showNotification(title, { body, tag, data });
        else new Notification(title, { body, tag, data });
      },
    };
  }
  if (worker?.pushManager)
    ports.push = {
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
        const s = await worker.pushManager.getSubscription();
        if (s && !(await s.unsubscribe()))
          throw new Error('Push unsubscribe failed');
      },
    };
  if (worker && 'sync' in worker) {
    const sync = worker.sync as { register(tag: string): Promise<void> };
    ports.jobs = { schedule: (id) => sync.register(id) };
  }
  return services(ports);
}
