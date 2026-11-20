// Helpers for the service contract tests.
//
// The unit project runs every file of a worker in one module graph
// (`isolate: false`), so the registry is shared between files. A file removes
// what it installs, and a file that needs the browser's services asks for
// them with `useWebServices` instead of relying on what ran before it.
import * as v from 'vitest';
import {
  installServices,
  resetServices,
  serviceAvailable,
  type ProviderMap,
  type ServiceName,
} from '../src/sdk/registry.js';
import { webServices } from '../src/hosts/web-services/index.js';

// jsdom's default `about:blank` is an opaque origin, where `localStorage`
// throws; the browser settings service needs a real store. An in-memory
// Storage stands in when the environment has none.
let existingStorage: Storage | undefined;
try {
  existingStorage = globalThis.localStorage;
} catch {
  // An opaque origin: jsdom refuses the store, so the shim below stands in.
}
if (existingStorage === undefined) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) =>
        void values.set(key, String(value)),
    } satisfies Storage,
  });
}

/** The browser's services, for every test of the calling file. */
export function useWebServices(): void {
  let remove: (() => void) | undefined;
  v.beforeAll(() => {
    remove = installServices(webServices);
  });
  v.afterAll(() => remove?.());
}

/** Installs fakes for the running test; removed when it finishes. */
export function provide(providers: ProviderMap): () => void {
  const remove = installServices(providers);
  v.onTestFinished(remove);
  return remove;
}

/**
 * Runs `run` on a host that installed nothing, then puts the browser's
 * services back the way tests/setup.ts has them.
 */
export async function withoutServices(
  run: () => void | Promise<void>,
): Promise<void> {
  resetServices();
  try {
    await run();
  } finally {
    resetServices();
    installServices(webServices);
  }
}

/**
 * Makes any read of `target[name]` throw, to prove code under test does not
 * touch that browser API. Returns the function that puts the member back.
 */
export function forbid(target: object, name: string): () => void {
  const own = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: true,
    get() {
      throw new Error(`${name} must not be read here`);
    },
  });
  return () => {
    if (own) Object.defineProperty(target, name, own);
    else delete (target as Record<string, unknown>)[name];
  };
}

/**
 * Runs `act` and checks that `spy` was called before `act` returned: in the
 * same synchronous turn as the app's call, with no microtask in between.
 * Browsers accept a call that needs a user gesture only there. Then waits for
 * whatever `act` returned.
 */
export async function expectSameTurn(
  spy: { mock: { calls: unknown[][] } },
  act: () => unknown,
): Promise<void> {
  const before = spy.mock.calls.length;
  const result = act();
  v.expect(spy.mock.calls.length - before, 'calls in the same turn').toBe(1);
  await Promise.resolve(result).catch(() => {});
}

/**
 * The web host's providers for these services exist, and installing them does
 * no work: no provider is called, no listener is added, no timer is started.
 * `lazy` providers are functions that load their code on first use; `eager`
 * ones are plain objects, for services a synchronous SDK function reads or
 * that a browser allows only inside a user gesture.
 */
export function expectIdleWebProviders(shape: {
  lazy?: readonly ServiceName[];
  eager?: readonly ServiceName[];
}): void {
  const map = webServices as Record<string, unknown>;
  const names = [...(shape.lazy ?? []), ...(shape.eager ?? [])];
  const called: string[] = [];
  const wrapped: Record<string, unknown> = {};
  for (const name of shape.eager ?? [])
    v.expect(typeof map[name], name).toBe('object');
  for (const name of shape.lazy ?? [])
    v.expect(typeof map[name], name).toBe('function');
  for (const name of names) {
    const provider = map[name];
    wrapped[name] =
      typeof provider === 'function'
        ? () => {
            called.push(name);
            return (provider as () => unknown)();
          }
        : provider;
  }
  v.vi.useFakeTimers();
  const onWindow = v.vi.spyOn(window, 'addEventListener');
  const onDocument = v.vi.spyOn(document, 'addEventListener');
  const remove = installServices(wrapped as ProviderMap);
  try {
    for (const name of names)
      v.expect(serviceAvailable(name), name).toBe('available');
    v.expect(called).toEqual([]);
    v.expect(v.vi.getTimerCount()).toBe(0);
    v.expect(onWindow).not.toHaveBeenCalled();
    v.expect(onDocument).not.toHaveBeenCalled();
  } finally {
    remove();
    onWindow.mockRestore();
    onDocument.mockRestore();
    v.vi.useRealTimers();
  }
}
