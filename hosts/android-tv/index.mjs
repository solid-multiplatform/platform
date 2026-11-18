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
    surface === undefined
      ? undefined
      : () => {
          const previous = Canvas.useSurface;
          try {
            Canvas.useSurface = surface === 'surface-view';
            return new Canvas();
          } finally {
            Canvas.useSurface = previous;
          }
        },
  );
}
