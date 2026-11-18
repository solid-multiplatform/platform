import type { ConnectivityPort } from '../../../../src/sdk/services.js';
import { mainHandler, sdk, type AndroidApp } from './runtime.js';

let Callback:
  | (new () => android.net.ConnectivityManager.NetworkCallback)
  | undefined;
// The one live port's change handler. A Java subclass made by `extend` keeps
// the functions it was first given, so they reach the port through here.
let changed: (() => void) | undefined;

/**
 * `ConnectivityManager`. `online` reads the active network when asked;
 * `subscribe` holds a default-network callback, delivered on the main
 * looper, for as long as it has listeners. Needs `ACCESS_NETWORK_STATE`.
 */
export function connectivity(app: AndroidApp): ConnectivityPort {
  const manager = (): android.net.ConnectivityManager =>
    app.context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
  const listeners = new Set<(online: boolean) => void>();
  let callback: android.net.ConnectivityManager.NetworkCallback | undefined;
  let last: boolean | undefined;
  const online = (): boolean => {
    const network = manager().getActiveNetwork();
    const capabilities = network
      ? manager().getNetworkCapabilities(network)
      : null;
    return (
      capabilities?.hasCapability(
        android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET,
      ) ?? false
    );
  };
  return {
    online,
    subscribe(listener) {
      if (!callback) {
        last = online();
        changed = () => {
          const next = online();
          if (next === last) return;
          last = next;
          for (const each of Array.from(listeners)) each(next);
        };
        Callback ??= android.net.ConnectivityManager.NetworkCallback.extend({
          onAvailable: () => changed?.(),
          onLost: () => changed?.(),
        });
        callback = new Callback();
        if (sdk() >= 26)
          manager().registerDefaultNetworkCallback(callback, mainHandler());
        else if (sdk() >= 24)
          manager().registerDefaultNetworkCallback(callback);
        else
          manager().registerNetworkCallback(
            new android.net.NetworkRequest.Builder()
              .addCapability(
                android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET,
              )
              .build(),
            callback,
          );
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size || !callback) return;
        manager().unregisterNetworkCallback(callback);
        callback = undefined;
        changed = undefined;
      };
    },
  };
}
