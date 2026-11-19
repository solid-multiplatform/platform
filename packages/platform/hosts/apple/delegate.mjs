/**
 * A hook added to the application delegate class is only worth a service
 * when the running delegate implements its method. This asks the way UIKit
 * asks before it calls one, and gives the hook back only then: the host
 * installs no service for a hook the system would never reach.
 */
export function liveDelegateHook(hook, selector) {
  if (!hook) return undefined;
  const delegate = UIApplication.sharedApplication.delegate;
  return delegate?.respondsToSelector(selector) === true ? hook : undefined;
}
