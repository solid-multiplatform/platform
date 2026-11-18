import { runNativeApp } from '../nativescript/boot.mjs';
import { bindAndroidInput } from './input.android.ts';
import { bindAndroidCanvas } from './platform.android.ts';
import { Canvas } from '@nativescript/canvas';

export function runAndroidTV(loadApp, { surface } = {}) {
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
      return bindAndroidInput(bridge, canvas.android);
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
