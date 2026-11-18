import type { MemoryPort } from '../../../../src/sdk/device.js';
import type { AndroidApp } from './runtime.js';

/** `ActivityManager.isLowRamDevice` and `MemoryInfo`. Synchronous. */
export function memory(app: AndroidApp): MemoryPort {
  return {
    get() {
      const manager: android.app.ActivityManager = app.context.getSystemService(
        android.content.Context.ACTIVITY_SERVICE,
      );
      const info = new android.app.ActivityManager.MemoryInfo();
      manager.getMemoryInfo(info);
      return {
        deviceMemoryGb: Math.round((info.totalMem / 2 ** 30) * 10) / 10,
        lowMemory: manager.isLowRamDevice() || info.lowMemory,
      };
    },
  };
}
