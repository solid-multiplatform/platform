import type { Store } from './services.js';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowStateDefaults {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Sanitize persisted window bounds. Missing/non-finite values fall back to the
 * defaults; sizes are clamped to the minimum so a corrupt file cannot create a
 * zero-size window.
 */
export function normalizeWindowBounds(
  value: Partial<WindowBounds> | null | undefined,
  defaults: WindowStateDefaults,
): WindowBounds {
  const number = (candidate: unknown, fallback: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? candidate
      : fallback;
  return {
    x: number(value?.x, 0),
    y: number(value?.y, 0),
    width: Math.max(
      defaults.minWidth ?? 320,
      number(value?.width, defaults.width),
    ),
    height: Math.max(
      defaults.minHeight ?? 240,
      number(value?.height, defaults.height),
    ),
  };
}

export interface WindowStateStoreOptions {
  storage: Store;
  key?: string;
  defaults: WindowStateDefaults;
}

export interface WindowStateStore {
  load(): Promise<WindowBounds>;
  save(bounds: Partial<WindowBounds>): Promise<WindowBounds>;
  reset(): Promise<WindowBounds>;
}

/**
 * Persist desktop window position/size through the settings store. Hosts
 * restore before showing the window and save on close/resize.
 */
export function createWindowStateStore(
  options: WindowStateStoreOptions,
): WindowStateStore {
  const key = options.key ?? 'window-state';
  return {
    async load() {
      try {
        const raw = await options.storage.get(key);
        if (!raw) return normalizeWindowBounds(undefined, options.defaults);
        return normalizeWindowBounds(
          JSON.parse(raw) as Partial<WindowBounds>,
          options.defaults,
        );
      } catch {
        return normalizeWindowBounds(undefined, options.defaults);
      }
    },
    async save(bounds) {
      const normalized = normalizeWindowBounds(bounds, options.defaults);
      await options.storage.set(key, JSON.stringify(normalized));
      return normalized;
    },
    async reset() {
      await options.storage.remove(key);
      return normalizeWindowBounds(undefined, options.defaults);
    },
  };
}
