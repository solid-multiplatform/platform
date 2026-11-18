import { Application } from '@nativescript/core';

/**
 * The `links` port for URLs the system opens the app with (its URL schemes).
 *
 * UIKit hands an opened URL to the application delegate and nowhere else,
 * and the delegate's methods must exist before the application starts. So
 * the host calls this before it runs the app: it adds that one delegate
 * method and nothing more (no observer, no timer). A URL that arrives before
 * the app listens, as the one that launched it does, is kept for `initial()`.
 *
 * Returns undefined where the delegate cannot be extended: the host then
 * installs no `links` service.
 */
export function captureAppleLinks() {
  const application = Application.ios;
  if (typeof application?.addDelegateHandler !== 'function') return undefined;
  let initial = null;
  const listeners = new Set();
  application.addDelegateHandler(
    'applicationOpenURLOptions',
    (_application, url) => {
      const link = url?.absoluteString;
      if (!link) return false;
      if (!listeners.size) initial ??= link;
      else for (const listener of Array.from(listeners)) listener(link);
      return true;
    },
  );
  return {
    initial: () => initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
