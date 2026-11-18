import type { SystemBarsPort } from '../../../../src/sdk/device.js';
import { activityOf, sdk, type AndroidApp } from './runtime.js';

/**
 * Status and navigation bar colours and glyph polarity. Synchronous. Phone
 * only: a TV window has no system bars.
 *
 * From Android 15 an app is drawn edge to edge and the bars are transparent:
 * the bar colours cannot be set there and are left alone, so the scene's own
 * background shows behind the bars; the glyph polarity still applies.
 */
export function systemBars(app: AndroidApp): SystemBarsPort {
  return {
    apply(style) {
      const window = activityOf(app).getWindow();
      const restore: (() => void)[] = [];
      if (sdk() < 35) {
        const status = window.getStatusBarColor();
        const navigation = window.getNavigationBarColor();
        if (style.statusBarColor !== undefined)
          window.setStatusBarColor(style.statusBarColor | 0);
        if (style.navigationBarColor !== undefined)
          window.setNavigationBarColor(style.navigationBarColor | 0);
        restore.push(() => {
          window.setStatusBarColor(status);
          window.setNavigationBarColor(navigation);
        });
      }
      // Android's LIGHT_* appearance means a light bar: dark glyphs.
      const wanted: [boolean | undefined, number, number][] = [
        [
          style.lightStatusIcons,
          android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
          android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR,
        ],
        [
          style.lightNavigationIcons,
          android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
          android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR,
        ],
      ];
      const controller = sdk() >= 30 ? window.getInsetsController() : null;
      if (controller) {
        let mask = 0;
        let value = 0;
        for (const [light, appearance] of wanted) {
          if (light === undefined) continue;
          mask |= appearance;
          if (light) value |= appearance;
        }
        const previous = controller.getSystemBarsAppearance();
        controller.setSystemBarsAppearance(value, mask);
        restore.push(() =>
          controller.setSystemBarsAppearance(previous & mask, mask),
        );
      } else {
        const decor = window.getDecorView();
        const previous = decor.getSystemUiVisibility();
        let flags = previous;
        for (const [light, , flag] of wanted) {
          if (light === undefined) continue;
          flags = light ? flags | flag : flags & ~flag;
        }
        decor.setSystemUiVisibility(flags);
        restore.push(() => decor.setSystemUiVisibility(previous));
      }
      return () => {
        for (const undo of restore.splice(0)) undo();
      };
    },
  };
}
