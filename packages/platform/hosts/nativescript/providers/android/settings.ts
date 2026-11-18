import type { Store } from '../../../../src/sdk/services.js';
import type { AndroidApp } from './runtime.js';

/**
 * A private `SharedPreferences` file per namespace. Reads come from memory
 * once the file has loaded; writes are queued to disk by `apply`.
 */
export function settings(app: AndroidApp, namespace: string): Store {
  let preferences: android.content.SharedPreferences | undefined;
  const open = (): android.content.SharedPreferences =>
    (preferences ??= app.context.getSharedPreferences(
      'solid.settings.' + namespace,
      android.content.Context.MODE_PRIVATE,
    ));
  return {
    async get(key) {
      return open().getString(key, null);
    },
    async set(key, value) {
      open().edit().putString(key, value).apply();
    },
    async remove(key) {
      open().edit().remove(key).apply();
    },
  };
}
