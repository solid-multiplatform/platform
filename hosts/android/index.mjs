import { bindMobileViewport } from '../nativescript/viewport.mjs';
import { runNativeApp } from '../nativescript/boot.mjs';
import { bindAndroidCanvas } from '../android-tv/platform.android.ts';
import { bindSceneTouch } from '../nativescript/touch.mjs';

export function runAndroid(loadApp) {
  runNativeApp('android', loadApp, (canvas, bridge, platform, root) => {
    bindAndroidCanvas(canvas);
    const stopViewport = bindMobileViewport(root, 'android');
    const touch = bindSceneTouch(canvas, 'android');
    return {
      input: touch.input,
      dispose() {
        touch.dispose();
        stopViewport();
      },
    };
  });
}
