import type {
  ColorScheme,
  ColorSchemePort,
} from '../../../../src/sdk/theme.jsx';
import type { AndroidApp } from './runtime.js';

/**
 * The system's night mode, from `Configuration.uiMode`. `subscribe` registers
 * a component callback on the application for as long as it has listeners;
 * the host's activity handles `uiMode` changes itself, so it is not recreated.
 */
export function colorScheme(app: AndroidApp): ColorSchemePort {
  const configuration = android.content.res.Configuration;
  const read = (config: android.content.res.Configuration): ColorScheme =>
    (config.uiMode & configuration.UI_MODE_NIGHT_MASK) ===
    configuration.UI_MODE_NIGHT_YES
      ? 'dark'
      : 'light';
  const current = (): ColorScheme =>
    read(app.context.getResources().getConfiguration());
  const listeners = new Set<(scheme: ColorScheme) => void>();
  let callbacks: android.content.ComponentCallbacks | undefined;
  let last: ColorScheme | undefined;
  return {
    current,
    subscribe(listener) {
      if (!callbacks) {
        last = current();
        callbacks = new android.content.ComponentCallbacks({
          onConfigurationChanged(config) {
            const next = read(config);
            if (next === last) return;
            last = next;
            for (const each of Array.from(listeners)) each(next);
          },
          onLowMemory() {},
        });
        app.context.registerComponentCallbacks(callbacks);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size || !callbacks) return;
        app.context.unregisterComponentCallbacks(callbacks);
        callbacks = undefined;
      };
    },
  };
}
