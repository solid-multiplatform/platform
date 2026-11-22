import type { HapticsPort } from '../../../../src/sdk/device.js';
import { vibrator } from './features.js';
import { activityOf, sdk, type AndroidApp } from './runtime.js';

/**
 * `View.performHapticFeedback` for an impact, which follows the user's touch
 * feedback setting and needs no permission, and a one-shot `VibrationEffect`
 * for a timed vibration (the `VIBRATE` permission). Phone only.
 */
export function haptics(app: AndroidApp): HapticsPort {
  const constants = android.view.HapticFeedbackConstants;
  return {
    async impact(style) {
      activityOf(app)
        .getWindow()
        .getDecorView()
        .performHapticFeedback(
          style === 'light'
            ? constants.KEYBOARD_TAP
            : style === 'heavy'
              ? constants.LONG_PRESS
              : constants.VIRTUAL_KEY,
        );
    },
    async selection() {
      activityOf(app)
        .getWindow()
        .getDecorView()
        .performHapticFeedback(constants.CLOCK_TICK);
    },
    async notification(type) {
      const view = activityOf(app).getWindow().getDecorView();
      // CONFIRM/REJECT are API 30; fall back to the touch-feedback constants
      // on older devices.
      const fallback =
        type === 'error' ? constants.LONG_PRESS : constants.VIRTUAL_KEY;
      if (sdk() >= 30) {
        view.performHapticFeedback(
          type === 'success'
            ? constants.CONFIRM
            : type === 'error'
              ? constants.REJECT
              : fallback,
        );
      } else view.performHapticFeedback(fallback);
    },
    async vibrate(milliseconds) {
      const device = vibrator(app.context);
      if (!device) return;
      if (sdk() >= 26)
        device.vibrate(
          android.os.VibrationEffect.createOneShot(
            milliseconds,
            android.os.VibrationEffect.DEFAULT_AMPLITUDE,
          ),
        );
      else device.vibrate(milliseconds);
    },
  };
}
