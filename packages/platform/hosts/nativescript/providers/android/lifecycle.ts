import type { LifecyclePort } from '../../../../src/sdk/services.js';
import type { AndroidApp } from './runtime.js';

/**
 * Whether the app is in front. `active` asks the system each time;
 * `subscribe` listens to the activity's resume and pause for as long as it is
 * subscribed.
 */
export function lifecycle(app: AndroidApp): LifecyclePort {
  return {
    active() {
      const info = new android.app.ActivityManager.RunningAppProcessInfo();
      android.app.ActivityManager.getMyMemoryState(info);
      return (
        info.importance ===
        android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
      );
    },
    subscribe(listener) {
      const resumed = (): void => listener(true);
      const paused = (): void => listener(false);
      app.on('activityResumed', resumed);
      app.on('activityPaused', paused);
      return () => {
        app.off('activityResumed', resumed);
        app.off('activityPaused', paused);
      };
    },
  };
}
