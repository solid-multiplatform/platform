import { Application } from '@nativescript/core';

/** Supply the installed SecureStorage instance (Keychain / Android Keystore). */
export function secureStoragePort(storage, namespace) {
  const key = (name) => namespace + ':' + name;
  return {
    get: (name) => storage.get({ key: key(name) }),
    async set(name, value) {
      if (!(await storage.set({ key: key(name), value })))
        throw new Error('Secure store write failed');
    },
    async remove(name) {
      await storage.remove({ key: key(name) });
    },
  };
}
export function localNotificationPort(notifications) {
  let requested = false;
  return {
    async permission() {
      return (await notifications.hasPermission())
        ? 'granted'
        : requested
          ? 'denied'
          : 'prompt';
    },
    async request() {
      requested = true;
      return (await notifications.requestPermission()) ? 'granted' : 'denied';
    },
    async show({ title, body, data }) {
      if (!(await notifications.hasPermission()))
        throw new Error('Notification permission required');
      await notifications.schedule([
        { title, body, userInfo: data, at: new Date() },
      ]);
    },
  };
}
export { appleJobs, messagingPort } from './apple-providers.mjs';
export function androidLinks() {
  const app = Application.android;
  const uri = (intent) => intent?.getDataString()?.toString() ?? null;
  return {
    initial: () =>
      uri((app.foregroundActivity ?? app.startActivity)?.getIntent()),
    subscribe(fn) {
      const receive = (e) => {
        const link = uri(e.intent);
        if (link) fn(link);
      };
      app.on('activityNewIntent', receive);
      return () => app.off('activityNewIntent', receive);
    },
  };
}
/** Map public job names to manifest-declared JobService classes and stable app-owned IDs. */
export function androidJobs(registry) {
  const ctx = Application.android.context;
  const scheduler = ctx.getSystemService('jobscheduler');
  return {
    async schedule(name) {
      const spec = Object.hasOwn(registry, name) ? registry[name] : null;
      if (!spec) throw new Error('Unknown background job: ' + name);
      const component = new android.content.ComponentName(ctx, spec.className);
      const builder = new android.app.job.JobInfo.Builder(spec.id, component);
      builder.setMinimumLatency(Math.max(0, spec.delayMs ?? 0));
      if (spec.network)
        builder.setRequiredNetworkType(
          android.app.job.JobInfo.NETWORK_TYPE_ANY,
        );
      if (
        scheduler.schedule(builder.build()) !==
        android.app.job.JobScheduler.RESULT_SUCCESS
      )
        throw new Error('Android declined background work');
    },
    cancel(name) {
      const spec = registry[name];
      if (spec) scheduler.cancel(spec.id);
    },
  };
}
/** Forward the app/scene delegate's openURL and continueUserActivity deliveries here. */
export function appleLinks(coldURL = null) {
  const listeners = new Set();
  return {
    initial: () => coldURL,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    receive(url) {
      const value = String(url);
      coldURL = value;
      for (const fn of listeners) fn(value);
    },
  };
}
