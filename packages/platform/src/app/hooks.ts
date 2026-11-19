/**
 * Hooks an app calls instead of taking the host, plugins and services as
 * props. The service hooks subscribe while the calling component is mounted
 * and report `undefined` on a host without the service; none of them throws.
 */
import { createSignal, onCleanup, useContext, type Accessor } from 'solid-js';
import {
  useCapabilities,
  type PlatformCapabilities,
  type PlatformTarget,
} from '../sdk/capabilities.js';
import type { BatteryState } from '../sdk/device.js';
import { locale } from '../sdk/i18n.js';
import {
  loadService,
  peekService,
  serviceAvailable,
  type ServiceName,
  type ServiceProviders,
} from '../sdk/registry.js';
// The ports `useConnectivity` and `useLifecycle` read are declared here.
import type {} from '../sdk/services.js';
import {
  bindColorScheme,
  useColorScheme as colorScheme,
  type ColorScheme,
} from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { AppScope, HostScope } from './context.js';

export interface HostInfo {
  /** The target the app was built for, such as `web` or `android-tv`. */
  readonly target: PlatformTarget;
  /** What the host declares it can do: inputs, insets, haptics. */
  readonly capabilities: PlatformCapabilities;
  /** The host's native root (a view, a window), where the target has one. */
  readonly native: unknown;
}

/** The host the app runs on. */
export function useHost(): HostInfo {
  const scope = useContext(HostScope);
  return {
    get target() {
      return scope?.target ?? useCapabilities().target;
    },
    get capabilities() {
      return useCapabilities();
    },
    native: scope?.native,
  };
}

/** The project's plugins built for this target, by name. */
export function usePlugins<T = unknown>(): Record<string, T> {
  return (useContext(AppScope)?.plugins ?? {}) as Record<string, T>;
}

/** One plugin, or `undefined` when it is not built for this target. */
export function usePlugin<T = unknown>(name: string): T | undefined {
  return usePlugins<T>()[name];
}

/** The viewport: size, scale, safe area and keyboard inset. Reactive. */
export const useViewport = viewport;

/** True when the host provides the service: `if (available('share')) …`. */
export function available(name: ServiceName): boolean {
  return serviceAvailable(name) === 'available';
}

/**
 * A value a service reports, kept current while the caller is mounted.
 * `undefined` when the host has no such service or it failed to start.
 */
function watch<K extends ServiceName, T>(
  name: K,
  start: (
    port: ServiceProviders[K],
    set: (value: T | undefined) => void,
  ) => (() => void) | void,
): Accessor<T | undefined> {
  const [value, setValue] = createSignal<T | undefined>(undefined);
  if (!available(name)) return value;
  let mounted = true;
  let stop: (() => void) | void;
  const set = (next: T | undefined) => {
    if (mounted) setValue(() => next);
  };
  const run = (port: ServiceProviders[K]) => {
    if (mounted) stop = start(port, set);
  };
  try {
    const port = peekService(name);
    if (port !== undefined) run(port);
    else loadService(name).then(run, () => {});
  } catch {
    // A provider that cannot start reads as an absent service.
  }
  onCleanup(() => {
    mounted = false;
    stop?.();
  });
  return value;
}

/** Whether the device is online; `undefined` when the host cannot tell. */
export function useConnectivity(): Accessor<boolean | undefined> {
  return watch('connectivity', (port, set) => {
    set(port.online());
    return port.subscribe(set);
  });
}

/** Whether the app is in the foreground; `undefined` when the host cannot tell. */
export function useLifecycle(): Accessor<boolean | undefined> {
  return watch('lifecycle', (port, set) => {
    set(port.active());
    return port.subscribe(set);
  });
}

/**
 * The battery level and charging state, read once when the caller mounts
 * (hosts report it on request; nothing polls). `undefined` without a battery.
 */
export function useBattery(): Accessor<BatteryState | undefined> {
  return watch('battery', (port, set) => {
    void port.get().then(set, () => {});
  });
}

/**
 * The system's light or dark appearance, followed while the caller is
 * mounted. `light` on a host that does not report one.
 */
export function useColorScheme(): Accessor<ColorScheme> {
  onCleanup(bindColorScheme());
  return colorScheme;
}

/** The app's current locale as a BCP 47 tag. */
export function useLocale(): Accessor<string> {
  return locale;
}
