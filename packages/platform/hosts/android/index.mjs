import { bindMobileViewport } from '../nativescript/viewport.mjs';
import { runNativeApp } from '../nativescript/boot.mjs';
import { bindAndroidCanvas } from '../android-tv/platform.android.ts';
import { bindAndroidBack } from '../nativescript/back.android.ts';
import { bindSceneTouch } from '../nativescript/touch.mjs';
import { Application } from '@nativescript/core';
import { installServices } from '@solid-multiplatform/platform/services';
import { androidServices } from '../nativescript/providers/android/manifest.ts';

export function runAndroid(loadApp, { services } = {}) {
  runNativeApp(
    'android',
    loadApp,
    (canvas, bridge, platform, root, history) => {
      bindAndroidCanvas(canvas);
      // Hardware Back moves the app's history; at the root it leaves the app.
      const stopBack = bindAndroidBack(history);
      // The device's services, installed once. Nothing in them runs until
      // the app first uses one.
      const removeServices = installServices(
        androidServices({
          ...services,
          form: 'phone',
          app: Application.android,
        }),
      );
      const stopViewport = bindMobileViewport(root, 'android');
      const touch = bindSceneTouch(canvas, 'android');
      return {
        input: touch.input,
        dispose() {
          stopBack();
          touch.dispose();
          stopViewport();
          removeServices();
        },
      };
    },
  );
}
