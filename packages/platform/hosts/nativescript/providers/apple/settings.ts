import type { Store } from '@solid-multiplatform/platform/services';

/** `NSUserDefaults`, with every key under the application's namespace. */
export function settings(namespace: string): Store {
  const key = (name: string) => namespace + ':' + name;
  return {
    async get(name) {
      return NSUserDefaults.standardUserDefaults.stringForKey(key(name));
    },
    async set(name, value) {
      NSUserDefaults.standardUserDefaults.setObjectForKey(value, key(name));
    },
    async remove(name) {
      NSUserDefaults.standardUserDefaults.removeObjectForKey(key(name));
    },
  };
}
