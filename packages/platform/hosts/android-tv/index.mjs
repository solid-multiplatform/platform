import { runNativeApp } from '../nativescript/boot.mjs';
import { bindAndroidInput } from './input.android.ts';
import { bindAndroidCanvas } from './platform.android.ts';
import { Canvas } from '@nativescript/canvas';
import { Application } from '@nativescript/core';
import { installServices } from '@solid-multiplatform/platform/services';
import { androidServices } from '../nativescript/providers/android/manifest.ts';

export function runAndroidTV(loadApp, { surface, services } = {}) {
  if (
    surface !== undefined &&
    !['surface-view', 'texture-view'].includes(surface)
  )
    throw new TypeError('Unknown Android TV canvas surface: ' + surface);
  runNativeApp(
    'android-tv',
    loadApp,
    (canvas, bridge) => {
      bindAndroidCanvas(canvas, true);
      // The device's services, installed once. Nothing in them runs until
      // the app first uses one. The key bridge raises its events on
      // `document`: where `keyEvents`, a preview service, points shortcuts.
      // Still a preview: the key bridge's events carry no modifier flags, so
      // no shortcut matches them yet.
      const removeServices = installServices(
        androidServices({
          ...services,
          form: 'tv',
          app: Application.android,
          keyTarget: document,
        }),
      );
      const unbindInput = bindAndroidInput(bridge, canvas.android);
      return () => {
        unbindInput();
        removeServices();
      };
    },
    () => {
      const previous = Canvas.useSurface;
      try {
        if (surface !== undefined)
          Canvas.useSurface = surface === 'surface-view';
        const canvas = new Canvas();
        if (Canvas.useSurface) {
          // Put transparent Solid content above ordinary media surfaces and below
          // the window's native controls. Android applies this before attachment.
          canvas.android.getSurfaceView().setZOrderMediaOverlay(true);
        }
        return canvas;
      } finally {
        Canvas.useSurface = previous;
      }
    },
  );
}
