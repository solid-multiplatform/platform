import type { DisplayInfo, DisplayPort } from '../../../../src/sdk/display.js';
import { mainHandler, type AndroidApp } from './runtime.js';

/** A rate rounded to two decimals: Android reports 60.000004 for 60 Hz. */
const rate = (hz: number): number => Math.round(hz * 100) / 100;

/**
 * The frame-rate compatibility Android's docs name for a rendering UI.
 * `AT_LEAST` (API 36) is the documented value for "UIs, animations, scrolling
 * and fling"; `DEFAULT` is the one for everything that is not video before it.
 */
function compatibility(): number {
  return android.os.Build.VERSION.SDK_INT >= 36
    ? android.view.Surface.FRAME_RATE_COMPATIBILITY_AT_LEAST
    : android.view.Surface.FRAME_RATE_COMPATIBILITY_DEFAULT;
}

/**
 * The display's current mode and the modes it can switch to.
 *
 * `Display.getMode()` is API 23 (NativeScript's minimum is above it), and
 * `getSupportedModes()` gives every physical mode; duplicates (one per
 * resolution) are folded to one entry per rate.
 */
function readDisplay(
  manager: android.hardware.display.DisplayManager,
): DisplayInfo {
  const display = manager.getDisplay(android.view.Display.DEFAULT_DISPLAY);
  if (!display) return { refreshRate: 0, supportedRefreshRates: [] };
  const rates = new Set<number>();
  const modes = display.getSupportedModes();
  for (let i = 0; i < modes.length; i++)
    rates.add(rate(modes[i]!.getRefreshRate()));
  return {
    refreshRate: rate(display.getMode().getRefreshRate()),
    supportedRefreshRates: Array.from(rates).sort((a, b) => a - b),
  };
}

/**
 * The Android display service: the current refresh rate, a display listener
 * for mode changes, and the window request that lets the app run at the
 * panel's highest rate.
 *
 * Android keeps a window at the display's default (usually 60 Hz) mode until
 * something asks for another. A renderer that draws on every vsync draws at
 * whatever rate the display is in, so the host asks for the highest supported
 * mode once and again after a mode change; `prefer` is the same request on
 * demand.
 */
export function display(app: AndroidApp): DisplayPort {
  const manager: android.hardware.display.DisplayManager =
    app.context.getSystemService(android.content.Context.DISPLAY_SERVICE);

  const apply = (target: number): void => {
    if (!(target > 0)) return;
    const activity = app.foregroundActivity ?? app.startActivity;
    const window = activity?.getWindow();
    if (!window) return;
    // A mode id is resolution *and* rate, so the best mode is the fastest one
    // at the size the display is showing: switching to a faster mode at a
    // different resolution would resize the window under the scene.
    let modeId = -1;
    try {
      const display = manager.getDisplay(android.view.Display.DEFAULT_DISPLAY);
      const current = display.getMode();
      const modes = display.getSupportedModes();
      let best = current;
      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i]!;
        if (
          mode.getPhysicalWidth() !== current.getPhysicalWidth() ||
          mode.getPhysicalHeight() !== current.getPhysicalHeight()
        )
          continue;
        if (mode.getRefreshRate() > best.getRefreshRate()) best = mode;
      }
      modeId = best.getModeId();
    } catch {
      // A display that reports no modes: the rate hint below still applies.
    }
    const attributes = window.getAttributes();
    let changed = false;
    // The pre-11 hint, honoured by Pixel and most OEMs.
    if (attributes.preferredRefreshRate !== target) {
      attributes.preferredRefreshRate = target;
      changed = true;
    }
    // The exact mode. This is the request Android enforces: unlike the two
    // frame-rate hints it is not subject to the display's adaptive policy,
    // which is what leaves an app at the default 60 Hz mode on a Pixel while
    // the panel still boosts to 120 for touches.
    if (modeId >= 0 && attributes.preferredDisplayModeId !== modeId) {
      attributes.preferredDisplayModeId = modeId;
      changed = true;
    }
    if (changed) window.setAttributes(attributes);
    // API 30's frame-rate request: the system's own signal for choosing the
    // display mode, and the one SurfaceFlinger reads as the app request. The
    // NativeScript typing may predate it, so it is read off the window.
    const modernWindow = window as unknown as {
      setFrameRate?(rate: number, compatibility: number): void;
    };
    if (
      android.os.Build.VERSION.SDK_INT >= 30 &&
      typeof modernWindow.setFrameRate === 'function'
    ) {
      modernWindow.setFrameRate(target, compatibility());
    }
  };

  return {
    get: () => readDisplay(manager),
    // A mode switch is the only display change that moves the frame rate;
    // added and removed displays do not change the default display's mode.
    subscribe(listener) {
      let last = readDisplay(manager).refreshRate;
      const displayListener =
        new android.hardware.display.DisplayManager.DisplayListener({
          onDisplayAdded: () => {},
          onDisplayRemoved: () => {},
          onDisplayChanged: () => {
            const info = readDisplay(manager);
            if (info.refreshRate === last) return;
            last = info.refreshRate;
            listener(info);
          },
        });
      manager.registerDisplayListener(displayListener, mainHandler());
      return () => manager.unregisterDisplayListener(displayListener);
    },
    prefer(value) {
      const info = readDisplay(manager);
      const target =
        value === 'highest'
          ? Math.max(info.refreshRate, ...info.supportedRefreshRates)
          : value;
      apply(target);
    },
  };
}

/** The default display's current refresh rate in Hz, or 0 before an activity's display exists. */
export function currentDisplayRefreshRate(app: AndroidApp): number {
  const manager: android.hardware.display.DisplayManager =
    app.context.getSystemService(android.content.Context.DISPLAY_SERVICE);
  return readDisplay(manager).refreshRate;
}
