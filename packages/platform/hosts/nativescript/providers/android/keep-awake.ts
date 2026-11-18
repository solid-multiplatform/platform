import type { KeepAwakePort } from '../../../../src/sdk/device.js';
import { activityOf, type AndroidApp } from './runtime.js';

/** `FLAG_KEEP_SCREEN_ON` on the activity's window. */
export function keepAwake(app: AndroidApp): KeepAwakePort {
  const flag = android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
  return {
    async set(active) {
      const window = activityOf(app).getWindow();
      if (active) window.addFlags(flag);
      else window.clearFlags(flag);
    },
  };
}
