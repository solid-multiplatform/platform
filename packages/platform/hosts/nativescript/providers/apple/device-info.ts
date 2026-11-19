import type { DeviceInfoPort } from '@solid-multiplatform/platform/device';

export function deviceInfo(form: 'phone' | 'tv'): DeviceInfoPort {
  return {
    async get() {
      const device = UIDevice.currentDevice;
      const version: unknown = NSBundle.mainBundle.objectForInfoDictionaryKey(
        'CFBundleShortVersionString',
      );
      return {
        platform: form === 'tv' ? 'tv' : 'ios',
        // "iPhone", "iPad" or "Apple TV".
        model: device.model,
        osVersion: device.systemVersion,
        appVersion: typeof version === 'string' ? version : undefined,
      };
    },
  };
}
