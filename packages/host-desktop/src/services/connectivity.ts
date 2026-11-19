// The `connectivity` service: whether the machine is connected, as
// NetworkManager says on the system bus (native/src/network.rs).
//
// The manifest installs it only where NetworkManager is running. It is
// event-driven: the state is read once when an app first uses the service,
// and after that NetworkManager's own signal brings each change. Nothing
// asks again.
import type { ConnectivityPort } from '@solid-multiplatform/platform/services';

/**
 * NetworkManager's "connected, and the internet is reachable". Its lesser
 * states (a network without a way out, a sign-in page in the way) are not
 * online.
 */
const CONNECTED_GLOBAL = 70;

/** Whether this system says when it is connected. Asks the bus, once. */
export function connectivityAvailable(): boolean {
  return __solid.network?.available() ?? false;
}

export function connectivity(): ConnectivityPort {
  const native = __solid.network!;
  let online = native.state() === CONNECTED_GLOBAL;
  let listeners: readonly ((online: boolean) => void)[] = [];
  native.watch((state) => {
    const now = state === CONNECTED_GLOBAL;
    if (now === online) return;
    online = now;
    for (const listener of listeners) listener(online);
  });
  return {
    online: () => online,
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((one) => one !== listener);
      };
    },
  };
}
