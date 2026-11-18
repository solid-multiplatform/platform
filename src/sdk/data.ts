import { createSignal, getOwner, onCleanup, type Accessor } from 'solid-js';
import type { Store } from './services.js';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QueryOptions<T> {
  /** Fetches the value. Reject to mark the query as failed. */
  fetcher: () => Promise<T>;
  /** Cache key shared by every query for the same resource. */
  key?: string;
  /** Value exposed before the first successful fetch. */
  initial?: T;
  /** Set false to skip the initial fetch; call `refetch()` later. */
  enabled?: boolean;
  /** Number of retries after the first failure. Defaults to 0. */
  retry?: number;
  /** Delay before a retry, in milliseconds. Defaults to exponential backoff. */
  retryDelay?(attempt: number): number;
  /** A cached value younger than this is not fetched again. Defaults to 0. */
  staleTime?: number;
  onSuccess?(value: T): void;
  onError?(error: unknown): void;
}

export interface Query<T> {
  data: Accessor<T | undefined>;
  error: Accessor<unknown>;
  status: Accessor<AsyncStatus>;
  loading: Accessor<boolean>;
  /** Re-run the fetcher. Concurrent calls share the newest request. */
  refetch(): Promise<T | undefined>;
  /** Replace data locally, e.g. after an optimistic mutation. */
  setData(value: T): void;
  dispose(): void;
}

interface CacheEntry {
  value: unknown;
  updated: number;
}

const queryCache = new Map<string, CacheEntry>();
const queryListeners = new Map<string, Set<() => void>>();

/** Read a cached query value without creating a query. */
export function getQueryData<T>(key: string): T | undefined {
  return queryCache.get(key)?.value as T | undefined;
}

/** Write a cached query value, e.g. after a mutation response. */
export function setQueryData<T>(key: string, value: T): void {
  queryCache.set(key, { value, updated: Date.now() });
}

/**
 * Mark cached data stale. With a key only that resource refetches; without a
 * key every keyed query refetches. This is the TanStack Query / SWR
 * `invalidateQueries` contract.
 */
export function invalidateQueries(key?: string): void {
  if (key === undefined) {
    queryCache.clear();
    for (const listeners of queryListeners.values()) {
      for (const listener of listeners) listener();
    }
    return;
  }
  queryCache.delete(key);
  queryListeners.get(key)?.forEach((listener) => listener());
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch-and-cache helper for async screens. It keeps the established
 * data/loading/error shape of TanStack Query and SWR without pulling in a
 * store: retries, staleTime, shared keys and invalidation are opt-in.
 */
export function createQuery<T>(options: QueryOptions<T>): Query<T> {
  const retries = options.retry ?? 0;
  const staleTime = options.staleTime ?? 0;
  const cached = options.key ? queryCache.get(options.key) : undefined;
  const fresh =
    cached !== undefined && Date.now() - cached.updated <= staleTime;
  const initial = cached !== undefined ? (cached.value as T) : options.initial;

  const [data, setDataSignal] = createSignal<T | undefined>(initial);
  const [error, setError] = createSignal<unknown>(undefined);
  const [status, setStatus] = createSignal<AsyncStatus>(
    cached !== undefined ? 'success' : 'idle',
  );
  let version = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const owner = getOwner();

  const remember = (value: T) => {
    if (!options.key) return;
    queryCache.set(options.key, { value, updated: Date.now() });
  };

  const setData = (value: T) => {
    setDataSignal(() => value);
    remember(value);
  };

  const run = async (): Promise<T | undefined> => {
    const request = ++version;
    setStatus('loading');
    setError(undefined);
    for (let attempt = 0; ; attempt++) {
      try {
        const value = await options.fetcher();
        if (disposed || request !== version) return undefined;
        setData(value);
        setStatus('success');
        options.onSuccess?.(value);
        return value;
      } catch (caught) {
        if (disposed || request !== version) return undefined;
        if (attempt >= retries) {
          setError(() => caught);
          setStatus('error');
          options.onError?.(caught);
          return undefined;
        }
        await wait(
          options.retryDelay?.(attempt) ?? Math.min(2000, 100 * 2 ** attempt),
        );
        if (disposed || request !== version) return undefined;
      }
    }
  };

  if (options.enabled !== false && !fresh) {
    void run();
  }

  if (options.key) {
    let listenersFor = queryListeners.get(options.key);
    if (!listenersFor) {
      listenersFor = new Set();
      queryListeners.set(options.key, listenersFor);
    }
    const refetch = () => {
      void run();
    };
    listenersFor.add(refetch);
    listeners.add(refetch);
  }

  if (owner) {
    onCleanup(() => {
      disposed = true;
      version++;
      for (const listener of listeners) {
        if (options.key) queryListeners.get(options.key)?.delete(listener);
      }
      listeners.clear();
    });
  }

  return {
    data,
    error,
    status,
    loading: () => status() === 'loading',
    refetch: run,
    setData,
    dispose() {
      disposed = true;
      version++;
      for (const listener of listeners) {
        if (options.key) queryListeners.get(options.key)?.delete(listener);
      }
      listeners.clear();
    },
  };
}

export interface PersistentStoreOptions<T> {
  key: string;
  initial: T;
  storage: Store;
  serialize?(value: T): string;
  deserialize?(raw: string): T;
  onError?(error: unknown): void;
}

export interface PersistentStore<T> {
  value: Accessor<T>;
  /** True after `hydrate()` settled, whether or not stored data existed. */
  ready: Accessor<boolean>;
  set(next: T | ((previous: T) => T)): void;
  hydrate(): Promise<void>;
  /** Resolves after every queued write reached the storage port. */
  flush(): Promise<void>;
  reset(): void;
}

/**
 * A single global value persisted through the `settings`/`secureStorage`
 * ports. This is the Zustand `persist` / React Navigation state-persistence
 * shape: reads are synchronous after hydration, writes are serialized.
 */
export function createPersistentStore<T>(
  options: PersistentStoreOptions<T>,
): PersistentStore<T> {
  const serialize = options.serialize ?? ((value: T) => JSON.stringify(value));
  const deserialize =
    options.deserialize ?? ((raw: string) => JSON.parse(raw) as T);
  const [value, setValue] = createSignal<T>(options.initial);
  const [ready, setReady] = createSignal(false);
  let writes = Promise.resolve();
  const disposed = false;

  const persist = () => {
    const raw = serialize(value());
    writes = writes
      .then(() =>
        disposed ? undefined : options.storage.set(options.key, raw),
      )
      .catch((error) => options.onError?.(error));
    return writes;
  };

  return {
    value,
    ready,
    set(next) {
      setValue((previous) =>
        typeof next === 'function' ? (next as (value: T) => T)(previous) : next,
      );
      void persist();
    },
    async hydrate() {
      try {
        const raw = await options.storage.get(options.key);
        if (raw !== null && raw !== undefined) {
          setValue(() => deserialize(raw));
        }
      } catch (error) {
        options.onError?.(error);
      } finally {
        setReady(true);
      }
    },
    flush: () => writes,
    reset() {
      setValue(() => options.initial);
      void persist();
    },
  };
}

export interface ConnectivityPort {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface OfflineQueueOptions<T> {
  /** Runs one queued item. Reject/throw to keep it queued for a retry. */
  send(item: T): Promise<void>;
  storage: Store;
  key?: string;
  /** Optional connectivity port; when online, the queue flushes itself. */
  connectivity?: ConnectivityPort;
  serialize?(items: readonly T[]): string;
  deserialize?(raw: string): T[];
  onError?(error: unknown, item: T | undefined): void;
}

export interface OfflineQueue<T> {
  items: Accessor<readonly T[]>;
  size: Accessor<number>;
  /** Append an item and try to send immediately when online. */
  enqueue(item: T): Promise<void>;
  /** Send queued items in order. Resolves with the number delivered. */
  flush(): Promise<number>;
  hydrate(): Promise<void>;
  dispose(): void;
}

/**
 * Durable FIFO for mutations that must survive going offline. It is the
 * React Query `persistQueryClient` / Workbox background-sync shape: items are
 * stored through the `Store` port, sent in order, and retried when
 * connectivity returns or `flush()` is called again.
 */
export function createOfflineQueue<T>(
  options: OfflineQueueOptions<T>,
): OfflineQueue<T> {
  const key = options.key ?? 'offline-queue';
  const serialize =
    options.serialize ?? ((items: readonly T[]) => JSON.stringify(items));
  const deserialize =
    options.deserialize ?? ((raw: string) => JSON.parse(raw) as T[]);
  const [items, setItems] = createSignal<readonly T[]>([]);
  const [size, setSize] = createSignal(0);
  let flushing: Promise<number> | undefined;
  let hydrated = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const publish = (next: readonly T[]) => {
    const copy = [...next];
    setItems(copy);
    setSize(copy.length);
  };

  const persist = async () => {
    if (disposed) return;
    await options.storage.set(key, serialize(items()));
  };

  const doFlush = async (): Promise<number> => {
    let delivered = 0;
    while (items().length) {
      if (disposed) break;
      const item = items()[0]!;
      try {
        await options.send(item);
      } catch (error) {
        options.onError?.(error, item);
        break;
      }
      if (disposed) break;
      publish(items().slice(1));
      await persist();
      delivered++;
    }
    return delivered;
  };

  const flush = (): Promise<number> => {
    if (flushing) return flushing;
    flushing = doFlush().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };

  if (options.connectivity) {
    unsubscribe = options.connectivity.subscribe((online) => {
      if (online) void flush();
    });
  }

  return {
    items,
    size,
    async enqueue(item) {
      publish([...items(), item]);
      await persist();
      if (!options.connectivity || options.connectivity.online()) {
        await flush();
      }
    },
    flush,
    async hydrate() {
      if (hydrated) return;
      hydrated = true;
      try {
        const raw = await options.storage.get(key);
        if (raw !== null && raw !== undefined) {
          const saved = deserialize(raw);
          if (Array.isArray(saved)) publish(saved);
        }
      } catch (error) {
        options.onError?.(error, undefined);
      }
      if (!options.connectivity || options.connectivity.online()) {
        await flush();
      }
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
    },
  };
}
