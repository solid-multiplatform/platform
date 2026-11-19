import type { BatteryPort } from '@solid-multiplatform/platform/device';

const UIDeviceBatteryStateCharging = 2;
const UIDeviceBatteryStateFull = 3;

/** iOS only. Battery monitoring is on only for the length of one read. */
export function battery(): BatteryPort {
  return {
    async get() {
      const device = UIDevice.currentDevice;
      const monitoring = device.batteryMonitoringEnabled;
      device.batteryMonitoringEnabled = true;
      try {
        const level = device.batteryLevel;
        // -1: unknown, as in a simulator.
        if (level < 0) return undefined;
        const state = device.batteryState;
        return {
          level,
          charging:
            state === UIDeviceBatteryStateCharging ||
            state === UIDeviceBatteryStateFull,
        };
      } finally {
        device.batteryMonitoringEnabled = monitoring;
      }
    },
  };
}
