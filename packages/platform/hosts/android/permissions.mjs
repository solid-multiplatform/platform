import { Application, ApplicationSettings } from '@nativescript/core';
let sequence = 0;
const pending = new Map();
/** The application declares the permission in its manifest. Calling query never opens a prompt. */
export function androidPermission(name) {
  const key = 'solid.permission.' + name,
    app = Application.android;
  const query = async () =>
    app.context.checkSelfPermission(name) === 0
      ? 'granted'
      : ApplicationSettings.getBoolean(key, false)
        ? 'denied'
        : 'prompt';
  return {
    query,
    async request() {
      if ((await query()) === 'granted') return 'granted';
      if (pending.has(name)) return pending.get(name);
      const activity = app.foregroundActivity;
      if (!activity)
        throw new Error('A foreground activity is required for permissions');
      const code = 0x5000 + (sequence++ % 0x1000);
      const request = new Promise((resolve, reject) => {
        const cleanup = () => {
          app.off('activityRequestPermissions', result);
          app.off('activityDestroyed', destroyed);
        };
        const result = (e) => {
          if (e.requestCode !== code) return;
          cleanup();
          resolve(e.grantResults?.[0] === 0 ? 'granted' : 'denied');
        };
        const destroyed = (e) => {
          if (e.activity === activity) {
            cleanup();
            reject(new Error('Permission request was interrupted'));
          }
        };
        app.on('activityRequestPermissions', result);
        app.on('activityDestroyed', destroyed);
        try {
          const names = Array.create(java.lang.String, 1);
          names[0] = name;
          ApplicationSettings.setBoolean(key, true);
          activity.requestPermissions(names, code);
        } catch (error) {
          cleanup();
          reject(error);
        }
      }).finally(() => pending.delete(name));
      pending.set(name, request);
      return request;
    },
  };
}
