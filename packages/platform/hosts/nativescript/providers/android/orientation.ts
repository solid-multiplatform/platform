import type { OrientationPort } from '../../../../src/sdk/device.js';
import { activityOf, type AndroidApp } from './runtime.js';

/**
 * `Activity.setRequestedOrientation`. A lock allows both rotations of the
 * orientation, as a browser's does. Phone only.
 */
export function orientation(app: AndroidApp): OrientationPort {
  const info = android.content.pm.ActivityInfo;
  return {
    async lock(value) {
      activityOf(app).setRequestedOrientation(
        value === 'portrait'
          ? info.SCREEN_ORIENTATION_SENSOR_PORTRAIT
          : value === 'landscape'
            ? info.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : info.SCREEN_ORIENTATION_UNSPECIFIED,
      );
    },
  };
}
