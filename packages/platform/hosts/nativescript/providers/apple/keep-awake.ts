import type { KeepAwakePort } from '@solid-multiplatform/platform/device';

export function keepAwake(): KeepAwakePort {
  return {
    async set(active) {
      UIApplication.sharedApplication.idleTimerDisabled = active;
    },
  };
}
