/**
 * The one place a host registers device services, and the one place SDK
 * functions find them.
 *
 * - A host installs a map of providers once, at start-up. A provider is the
 *   port object itself or a function that returns it (or a promise of it), so
 *   a provider's code can live in its own lazily loaded module.
 * - Installing does no work: nothing is constructed, imported or subscribed
 *   until an app function first uses that service. An idle TV scene pays for
 *   no service it does not use.
 * - A service that no provider was installed for is `unavailable`. SDK
 *   functions never fall back to a browser API on their own; the web host
 *   installs the browser providers.
 *
 * Each SDK module adds its ports to {@link ServiceProviders} by declaration
 * merging, so `useService('clipboard')` is typed where `clipboard` is declared.
 */

export type Availability = 'available' | 'unavailable';

/** Thrown when a service, or one operation of it, is not available here. */
export class CapabilityError extends Error {
  constructor(public readonly capability: string) {
    super('Unavailable capability: ' + capability);
    this.name = 'CapabilityError';
  }
}

/** Service name to port type. SDK modules extend this interface. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServiceProviders {}

export type ServiceName = keyof ServiceProviders;

/** A port, or a function producing it now or later. */
export type ServiceProvider<K extends ServiceName> =
  | ServiceProviders[K]
  | (() => ServiceProviders[K] | Promise<ServiceProviders[K]>);

export type ProviderMap = { readonly [K in ServiceName]?: ServiceProvider<K> };

type Entry = { provider: unknown; value: unknown; resolved: boolean };

// Later installs shadow earlier ones; uninstalling uncovers them again.
const layers: Map<string, Entry>[] = [];

function find(name: string): Entry | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const entry = layers[i]!.get(name);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/**
 * Registers providers. A later install wins over an earlier one for the same
 * service. Returns a function that removes exactly what this call added.
 */
export function installServices(providers: ProviderMap): () => void {
  const layer = new Map<string, Entry>();
  for (const name of Object.keys(providers)) {
    const provider = (providers as Record<string, unknown>)[name];
    if (provider !== undefined)
      layer.set(name, { provider, value: undefined, resolved: false });
  }
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index !== -1) layers.splice(index, 1);
  };
}

/** Whether a provider is installed. Does not construct it. */
export function serviceAvailable(name: ServiceName): Availability {
  return find(name) === undefined ? 'unavailable' : 'available';
}

/** The names of every installed service, for capability reports. */
export function installedServices(): ServiceName[] {
  const names = new Set<string>();
  for (const layer of layers) for (const name of layer.keys()) names.add(name);
  return Array.from(names).sort() as ServiceName[];
}

function settle(entry: Entry, value: unknown): unknown {
  entry.value = value;
  entry.resolved = true;
  return value;
}

/**
 * The service's port, constructing it on first use. Rejects with a
 * {@link CapabilityError} when no provider is installed.
 */
export function loadService<K extends ServiceName>(
  name: K,
): Promise<ServiceProviders[K]> {
  const entry = find(name);
  if (entry === undefined) return Promise.reject(new CapabilityError(name));
  if (entry.resolved)
    return Promise.resolve(entry.value as ServiceProviders[K]);
  if (typeof entry.provider !== 'function')
    return Promise.resolve(
      settle(entry, entry.provider) as ServiceProviders[K],
    );
  // Share one construction between concurrent first uses.
  entry.value ??= Promise.resolve((entry.provider as () => unknown)()).then(
    (value) => settle(entry, value),
    (error: unknown) => {
      entry.value = undefined;
      throw error;
    },
  );
  return entry.value as Promise<ServiceProviders[K]>;
}

/**
 * The service's port for code that cannot wait: the port object itself, one a
 * function returned directly, or one already loaded. Undefined when the
 * service is absent or its provider is asynchronous and not loaded yet.
 */
export function peekService<K extends ServiceName>(
  name: K,
): ServiceProviders[K] | undefined {
  const entry = find(name);
  if (entry === undefined) return undefined;
  if (entry.resolved) return entry.value as ServiceProviders[K];
  if (typeof entry.provider !== 'function')
    return settle(entry, entry.provider) as ServiceProviders[K];
  if (entry.value !== undefined) return undefined; // loading
  const value = (entry.provider as () => unknown)();
  if (value instanceof Promise) {
    entry.value = value.then(
      (loaded) => settle(entry, loaded),
      (error: unknown) => {
        entry.value = undefined;
        throw error;
      },
    );
    (entry.value as Promise<unknown>).catch(() => {});
    return undefined;
  }
  return settle(entry, value) as ServiceProviders[K];
}

/** {@link peekService}, throwing a {@link CapabilityError} instead of undefined. */
export function useService<K extends ServiceName>(
  name: K,
): ServiceProviders[K] {
  const port = peekService(name);
  if (port === undefined) throw new CapabilityError(name);
  return port;
}

/** Removes every installed provider. For tests and host teardown. */
export function resetServices(): void {
  layers.length = 0;
}
