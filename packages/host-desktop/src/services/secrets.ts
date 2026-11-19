// The `secureStorage` service: an app's secrets in the desktop's keyring,
// the freedesktop Secret Service on the session bus (native/src/secrets.rs;
// org.freedesktop.secrets).
//
// The manifest installs it only where the bus has that service. Items carry
// the app's namespace and the key as attributes, so one app's keys cannot
// collide with another's. Values are passed to and from the keyring and are
// never written to a file or logged here.
import type { Store } from '@solid-multiplatform/platform/services';

/** Whether this desktop has a keyring. Asks the session bus, once. */
export function secureStorageAvailable(): boolean {
  return __solid.secrets?.available() ?? false;
}

/** `namespace` is the app whose keys these are. */
export function secureStorage(namespace: string): Store {
  const native = __solid.secrets!;
  return {
    get: (key) =>
      new Promise((resolve, reject) => {
        native.get(namespace, key, (error, value) => {
          if (error !== null) return reject(error);
          // A key the keyring does not have is `null`, not an error.
          resolve(value ?? null);
        });
      }),
    set: (key, value) =>
      new Promise((resolve, reject) => {
        native.set(namespace, key, String(value), (error) => {
          if (error !== null) reject(error);
          else resolve();
        });
      }),
    remove: (key) =>
      new Promise((resolve, reject) => {
        native.remove(namespace, key, (error) => {
          if (error !== null) reject(error);
          else resolve();
        });
      }),
  };
}
