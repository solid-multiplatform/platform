import type { LifecyclePort } from '@solid-multiplatform/platform/services';
import { observe } from './observe.js';

const UIApplicationStateActive = 0;

export function lifecycle(): LifecyclePort {
  const active = () =>
    UIApplication.sharedApplication.applicationState ===
    UIApplicationStateActive;
  return {
    active,
    subscribe(listener) {
      let last = active();
      const report = (next: boolean) => () => {
        // Resigning and entering the background both mean inactive.
        if (next !== last) listener((last = next));
      };
      const stops = [
        observe(UIApplicationDidBecomeActiveNotification, report(true)),
        observe(UIApplicationWillResignActiveNotification, report(false)),
        observe(UIApplicationDidEnterBackgroundNotification, report(false)),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
