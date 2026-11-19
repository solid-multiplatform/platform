import { Application } from '@nativescript/core';
import { display } from '../nativescript/providers/android/display.ts';

/** `Surface.FRAME_RATE_COMPATIBILITY_DEFAULT`: the rate is a hint the system may change. */
const FRAME_RATE_COMPATIBILITY_DEFAULT = 0;

/**
 * Ask Android to run the app's window at the display's highest refresh rate,
 * and keep asking after a mode change.
 *
 * A renderer that draws on every vsync draws at the rate the display is in,
 * but Android keeps a window in the display's default mode (usually 60 Hz)
 * until the app requests another: `WindowManager.LayoutParams
 * .preferredRefreshRate` (before API 30), `Window.setFrameRate`
 * (API 30, the system's own app-frame-rate signal) and `Surface.setFrameRate`
 * on the canvas's SurfaceView. On a panel whose only mode is 60 Hz (every
 * Android TV measured) nothing is requested, so that behaviour is unchanged.
 *
 * Called from `bindAndroidCanvas`; returns the unsubscribe for the display
 * listener.
 */
export function bindDisplayRefreshRate(canvas) {
  const app = Application.android;
  if (!app) return () => {};
  const port = display(app);
  // The request is only for a panel that has a faster mode than 60 Hz.
  let target = 0;
  const apply = () => {
    let highest = 0;
    try {
      const info = port.get();
      highest = Math.max(info.refreshRate, ...info.supportedRefreshRates);
    } catch {
      return;
    }
    if (!(highest > 60)) return;
    target = highest;
    try {
      port.prefer?.('highest');
    } catch {
      // A window that is gone: nothing to ask.
    }
    try {
      const surface = canvas?.android
        ?.getSurfaceView?.()
        ?.getHolder?.()
        ?.getSurface?.();
      if (
        surface &&
        android.os.Build.VERSION.SDK_INT >= 30 &&
        typeof surface.setFrameRate === 'function'
      ) {
        surface.setFrameRate(target, FRAME_RATE_COMPATIBILITY_DEFAULT);
      }
    } catch {
      // The surface is not created yet; the window request still stands.
    }
  };
  apply();
  const stop =
    port.subscribe?.(() => {
      // A mode switch may land on 60 Hz; ask for the highest again.
      apply();
    }) ?? (() => {});
  return stop;
}
