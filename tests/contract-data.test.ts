import * as v from 'vitest';
import {
  createOfflineQueue,
  createPersistentStore,
  createQuery,
  getQueryData,
  invalidateQueries,
  setQueryData,
} from '../src/sdk/data.js';
import type { Store } from '../src/sdk/services.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  const store: Store & { map: Map<string, string> } = {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
  return store;
}

v.describe('createQuery', () => {
  v.it('reports loading, success and data', async () => {
    let resolve!: (value: string) => void;
    const query = createQuery({
      key: `success-${Math.random()}`,
      fetcher: () => new Promise<string>((r) => (resolve = r)),
    });
    v.expect(query.status()).toBe('loading');
    v.expect(query.loading()).toBe(true);
    resolve('Ada');
    await tick();
    v.expect(query.data()).toBe('Ada');
    v.expect(query.status()).toBe('success');
    v.expect(query.error()).toBeUndefined();
    query.dispose();
  });

  v.it('retries and then succeeds', async () => {
    let attempts = 0;
    const query = createQuery({
      key: `retry-${Math.random()}`,
      retry: 2,
      retryDelay: () => 0,
      fetcher: async () => {
        attempts++;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
    });
    for (let i = 0; i < 20 && query.status() === 'loading'; i++) await tick();
    v.expect(attempts).toBe(3);
    v.expect(query.data()).toBe('ok');
    v.expect(query.status()).toBe('success');
    query.dispose();
  });

  v.it('exposes the final error when retries are exhausted', async () => {
    const query = createQuery({
      key: `error-${Math.random()}`,
      retry: 1,
      retryDelay: () => 0,
      fetcher: async () => {
        throw new Error('offline');
      },
    });
    for (let i = 0; i < 20 && query.status() === 'loading'; i++) await tick();
    v.expect(query.status()).toBe('error');
    v.expect((query.error() as Error).message).toBe('offline');
    query.dispose();
  });

  v.it('shares a keyed cache and refetches on invalidation', async () => {
    const key = `cache-${Math.random()}`;
    let calls = 0;
    const first = createQuery({
      key,
      fetcher: async () => ++calls,
    });
    await tick();
    v.expect(first.data()).toBe(1);
    first.dispose();
    v.expect(getQueryData<number>(key)).toBe(1);

    let secondCalls = 0;
    const second = createQuery({
      key,
      staleTime: 60_000,
      fetcher: async () => {
        secondCalls++;
        return 2;
      },
    });
    // Fresh cached data, so the fetcher did not run.
    v.expect(second.data()).toBe(1);
    v.expect(secondCalls).toBe(0);
    v.expect(second.status()).toBe('success');

    invalidateQueries(key);
    v.expect(second.status()).toBe('loading');
    await tick();
    v.expect(second.data()).toBe(2);
    v.expect(secondCalls).toBe(1);
    second.dispose();
  });

  v.it('accepts local mutation data through setData/setQueryData', async () => {
    const key = `mutation-${Math.random()}`;
    let calls = 0;
    const query = createQuery({
      key,
      enabled: false,
      fetcher: async () => ++calls,
    });
    query.setData(7);
    v.expect(query.data()).toBe(7);
    v.expect(getQueryData<number>(key)).toBe(7);
    setQueryData(key, 8);
    v.expect(getQueryData<number>(key)).toBe(8);
    v.expect(query.data()).toBe(7);
    query.dispose();
  });
});

v.describe('createPersistentStore', () => {
  v.it('hydrates, persists updates in order and resets', async () => {
    const storage = memoryStore({
      settings: JSON.stringify({ theme: 'dark' }),
    });
    const store = createPersistentStore({
      key: 'settings',
      initial: { theme: 'light' },
      storage,
    });
    v.expect(store.ready()).toBe(false);
    await store.hydrate();
    v.expect(store.ready()).toBe(true);
    v.expect(store.value()).toEqual({ theme: 'dark' });

    store.set({ theme: 'light' });
    store.set((previous) => ({ ...previous, density: 'compact' }));
    await store.flush();
    v.expect(JSON.parse(storage.map.get('settings')!)).toEqual({
      theme: 'light',
      density: 'compact',
    });

    store.reset();
    await store.flush();
    v.expect(JSON.parse(storage.map.get('settings')!)).toEqual({
      theme: 'light',
    });
  });

  v.it(
    'keeps initial state and reports ready when hydration fails',
    async () => {
      const errors: unknown[] = [];
      const storage: Store = {
        get: async () => {
          throw new Error('disk');
        },
        set: async () => {},
        remove: async () => {},
      };
      const store = createPersistentStore({
        key: 'x',
        initial: 1,
        storage,
        onError: (error) => errors.push(error),
      });
      await store.hydrate();
      v.expect(store.value()).toBe(1);
      v.expect(store.ready()).toBe(true);
      v.expect(errors).toHaveLength(1);
    },
  );
});

v.describe('createOfflineQueue', () => {
  v.it(
    'holds items while offline and sends them when connectivity returns',
    async () => {
      const storage = memoryStore();
      let online = false;
      const listeners = new Set<(online: boolean) => void>();
      const connectivity = {
        online: () => online,
        subscribe(listener: (online: boolean) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      const sent: string[] = [];
      const queue = createOfflineQueue<string>({
        storage,
        connectivity,
        send: async (item) => {
          sent.push(item);
        },
      });
      await queue.hydrate();
      await queue.enqueue('a');
      await queue.enqueue('b');
      v.expect(sent).toEqual([]);
      v.expect(queue.items()).toEqual(['a', 'b']);
      v.expect(JSON.parse(storage.map.get('offline-queue')!)).toEqual([
        'a',
        'b',
      ]);

      online = true;
      for (const listener of listeners) listener(true);
      for (let i = 0; i < 20 && queue.size() > 0; i++) await tick();
      v.expect(sent).toEqual(['a', 'b']);
      v.expect(queue.size()).toBe(0);
      v.expect(JSON.parse(storage.map.get('offline-queue')!)).toEqual([]);
      queue.dispose();
    },
  );

  v.it(
    'keeps a failed item queued and retries it on the next flush',
    async () => {
      const storage = memoryStore();
      let fail = true;
      const errors: unknown[] = [];
      const sent: string[] = [];
      const queue = createOfflineQueue<string>({
        storage,
        send: async (item) => {
          if (fail) throw new Error('network');
          sent.push(item);
        },
        onError: (error) => errors.push(error),
      });
      await queue.hydrate();
      await queue.enqueue('retry-me');
      v.expect(errors).toHaveLength(1);
      v.expect(queue.items()).toEqual(['retry-me']);

      fail = false;
      v.expect(await queue.flush()).toBe(1);
      v.expect(sent).toEqual(['retry-me']);
      v.expect(queue.size()).toBe(0);
      queue.dispose();
    },
  );

  v.it(
    'restores a persisted queue and flushes it during hydration',
    async () => {
      const storage = memoryStore({
        'offline-queue': JSON.stringify(['saved-1', 'saved-2']),
      });
      const sent: string[] = [];
      const queue = createOfflineQueue<string>({
        storage,
        send: async (item) => {
          sent.push(item);
        },
      });
      await queue.hydrate();
      v.expect(sent).toEqual(['saved-1', 'saved-2']);
      v.expect(queue.size()).toBe(0);
      queue.dispose();
    },
  );
});
