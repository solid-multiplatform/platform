// Settings: string values under string keys in one JSON file in the app's
// own directory, which is what keeps one app's settings from another's. The
// runtime replaces the file whole on every save, so it is never half written.
import type { Store } from '@solid-multiplatform/platform/services';

export function settings(id: string): Store {
  let values: Record<string, string> | undefined;
  let loading: Promise<Record<string, string>> | undefined;
  // The save that has not started yet, shared by every change made before
  // it does.
  let queued: Promise<void> | undefined;
  let saving: Promise<void> = Promise.resolve();

  const load = (): Promise<Record<string, string>> =>
    (loading ??= new Promise((resolve, reject) => {
      __solid.store.load(id, (error, text) => {
        if (error !== null) {
          loading = undefined;
          reject(error);
          return;
        }
        values = {};
        if (typeof text === 'string') {
          try {
            const parsed: unknown = JSON.parse(text);
            if (parsed !== null && typeof parsed === 'object') {
              for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'string') values[key] = value;
              }
            }
          } catch {
            // Not what this file writes: said, not hidden. The next save
            // replaces it.
            console.error(`The settings of ${id} are not JSON; starting empty`);
          }
        }
        resolve(values);
      });
    }));

  const save = (): Promise<void> => {
    if (queued !== undefined) return queued;
    const write = saving.then(
      () =>
        new Promise<void>((resolve, reject) => {
          queued = undefined;
          __solid.store.save(id, JSON.stringify(values), (error) => {
            if (error !== null) reject(error);
            else resolve();
          });
        }),
    );
    queued = write;
    // A failed save rejects for whoever asked; the next one still runs.
    saving = write.catch(() => {});
    return write;
  };

  return {
    async get(key) {
      const all = values ?? (await load());
      return Object.hasOwn(all, key) ? all[key]! : null;
    },
    async set(key, value) {
      const all = values ?? (await load());
      all[key] = String(value);
      return save();
    },
    async remove(key) {
      const all = values ?? (await load());
      if (!Object.hasOwn(all, key)) return;
      delete all[key];
      return save();
    },
  };
}
