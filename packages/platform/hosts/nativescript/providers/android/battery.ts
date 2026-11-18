import type { BatteryPort } from '../../../../src/sdk/device.js';
import type { AndroidApp } from './runtime.js';

/**
 * The battery's level and whether it is charging, from the system's sticky
 * battery broadcast (`BatteryManager`'s extras). It is read with a null
 * receiver each time an app asks: nothing is registered.
 */
export function battery(app: AndroidApp): BatteryPort {
  const extras = android.os.BatteryManager;
  return {
    async get() {
      const state = app.context.registerReceiver(
        null,
        new android.content.IntentFilter(
          android.content.Intent.ACTION_BATTERY_CHANGED,
        ),
      );
      if (!state?.getBooleanExtra(extras.EXTRA_PRESENT, false))
        return undefined;
      const level = state.getIntExtra(extras.EXTRA_LEVEL, 0);
      const scale = state.getIntExtra(extras.EXTRA_SCALE, 100);
      return {
        level: Math.min(1, Math.max(0, level / (scale || 100))),
        // Plugged into any power source, as the web's `charging` means.
        charging: state.getIntExtra(extras.EXTRA_PLUGGED, 0) !== 0,
      };
    },
  };
}
