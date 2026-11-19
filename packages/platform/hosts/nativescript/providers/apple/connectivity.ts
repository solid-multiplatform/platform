import type { ConnectivityPort } from '@solid-multiplatform/platform/services';

const nw_path_status_satisfied = 1;
const kSCNetworkReachabilityFlagsReachable = 2;
const kSCNetworkReachabilityFlagsConnectionRequired = 4;

/** One reachability read of the default route: no monitor is left running. */
function reachable(): boolean {
  const address = new interop.Reference(sockaddr, {
    sa_len: 16,
    sa_family: 2, // AF_INET, 0.0.0.0
  } as sockaddr);
  const target: unknown = SCNetworkReachabilityCreateWithAddress(null, address);
  if (!target) return false;
  const flags = new interop.Reference<number>();
  if (!SCNetworkReachabilityGetFlags(target, flags)) return false;
  return (
    (flags.value & kSCNetworkReachabilityFlagsReachable) !== 0 &&
    (flags.value & kSCNetworkReachabilityFlagsConnectionRequired) === 0
  );
}

/**
 * `NWPathMonitor` while anything is subscribed: started by the first listener
 * and cancelled when the last one leaves. Without a listener `online()` is a
 * single reachability read.
 */
export function connectivity(): ConnectivityPort {
  const listeners = new Set<(online: boolean) => void>();
  let monitor: ReturnType<typeof nw_path_monitor_create> | undefined;
  let last: boolean | undefined;
  return {
    online: () => last ?? reachable(),
    subscribe(listener) {
      listeners.add(listener);
      if (!monitor) {
        const started = (monitor = nw_path_monitor_create());
        // The JavaScript thread is the main thread: updates must arrive there.
        nw_path_monitor_set_queue(started, dispatch_get_current_queue());
        nw_path_monitor_set_update_handler(started, (path) => {
          if (monitor !== started) return;
          const next = nw_path_get_status(path) === nw_path_status_satisfied;
          if (next === last) return;
          last = next;
          for (const fn of Array.from(listeners)) fn(next);
        });
        nw_path_monitor_start(started);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size || !monitor) return;
        nw_path_monitor_cancel(monitor);
        monitor = undefined;
        last = undefined;
      };
    },
  };
}
