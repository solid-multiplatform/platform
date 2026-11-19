import type { DeviceInfoPort } from '../../../../src/sdk/device.js';
import type { AndroidApp } from './runtime.js';

/** `Build` and the app's own `PackageInfo`. */
export function deviceInfo(
  app: AndroidApp,
  form: 'phone' | 'tv',
): DeviceInfoPort {
  return {
    async get() {
      const context = app.context;
      const info = context
        .getPackageManager()
        .getPackageInfo(context.getPackageName(), 0);
      return {
        platform: form === 'tv' ? 'tv' : 'android',
        os: 'android',
        model: android.os.Build.MODEL,
        osVersion: android.os.Build.VERSION.RELEASE,
        appVersion: info.versionName ?? undefined,
      };
    },
  };
}
