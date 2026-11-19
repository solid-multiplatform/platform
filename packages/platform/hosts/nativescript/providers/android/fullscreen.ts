import type { FullscreenPort } from '../../../../src/sdk/media.js';
import { CapabilityError } from '@solid-multiplatform/platform/services';
import { activityOf, sdk, type AndroidApp } from './runtime.js';

/**
 * Immersive mode for the whole window: the system bars are hidden and come
 * back for a moment on a swipe. Where the device has picture-in-picture
 * (and the activity declares `supportsPictureInPicture`), the port can also
 * shrink the activity into a floating window. The `element` argument has no
 * meaning here: the scene is the window.
 */
export function fullscreen(
  app: AndroidApp,
  pictureInPicture: boolean,
): FullscreenPort {
  const show = (visible: boolean): void => {
    const window = activityOf(app).getWindow();
    const controller = sdk() >= 30 ? window.getInsetsController() : null;
    if (controller) {
      const bars = android.view.WindowInsets.Type.systemBars();
      if (visible) return controller.show(bars);
      controller.setSystemBarsBehavior(
        android.view.WindowInsetsController
          .BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE,
      );
      return controller.hide(bars);
    }
    const View = android.view.View;
    const flags =
      View.SYSTEM_UI_FLAG_FULLSCREEN |
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
    const decor = window.getDecorView();
    const current = decor.getSystemUiVisibility();
    decor.setSystemUiVisibility(visible ? current & ~flags : current | flags);
  };
  const port: FullscreenPort = {
    async enter() {
      show(false);
    },
    async exit() {
      show(true);
    },
  };
  if (pictureInPicture)
    port.pictureInPicture = async () => {
      const entered = activityOf(app).enterPictureInPictureMode(
        new android.app.PictureInPictureParams.Builder().build(),
      );
      if (!entered) throw new CapabilityError('pictureInPicture');
    };
  return port;
}
