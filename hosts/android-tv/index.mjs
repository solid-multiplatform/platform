import { runNativeApp } from '../nativescript/boot.mjs';
import { bindAndroidInput } from './input.android.ts';
import { bindAndroidCanvas } from './platform.android.ts';

export function runAndroidTV(loadApp) {
  runNativeApp('android-tv', loadApp, (canvas, bridge) => {
    bindAndroidCanvas(canvas, true);
    return bindAndroidInput(bridge, canvas.android);
  });
}
