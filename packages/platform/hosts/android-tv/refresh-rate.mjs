import { Application } from '@nativescript/core';
import { display } from '../nativescript/providers/android/display.ts';

/** `Surface.FRAME_RATE_COMPATIBILITY_DEFAULT`: no restriction, the system may choose. */
const FRAME_RATE_COMPATIBILITY_DEFAULT = 0;
/**
 * `Surface.FRAME_RATE_COMPATIBILITY_AT_LEAST` (API 36): the surface renders at
 * least this fast. Android's docs name it for "UIs, animations, scrolling and
 * fling"; before it, DEFAULT is the value they name for anything that is not
 * video.
 */
const FRAME_RATE_COMPATIBILITY_AT_LEAST = 2;
/** `Surface.CHANGE_FRAME_RATE_ALWAYS` (API 31): switch even if not seamless. */
const CHANGE_FRAME_RATE_ALWAYS = 1;
/** API 36 added AT_LEAST; older systems take DEFAULT for the same content. */
const AT_LEAST_API = 36;
/** API 31 added the three-argument `setFrameRate` with a switch strategy. */
const STRATEGY_API = 31;

const log = (line) => {
  try {
    android.util.Log.d('SolidRefresh', line);
  } catch {
    // A log that cannot be written must not break start-up.
  }
};

const compatibility = () =>
  android.os.Build.VERSION.SDK_INT >= AT_LEAST_API
    ? FRAME_RATE_COMPATIBILITY_AT_LEAST
    : FRAME_RATE_COMPATIBILITY_DEFAULT;

/**
 * The canvas's SurfaceView surface, or undefined until it is created.
 *
 * A SurfaceView's Surface does not exist when the view is built: it arrives in
 * `surfaceCreated` and can be recreated after a resume. A request made before
 * then has nothing to apply to, which is why the caller re-applies on the
 * canvas's surface events rather than only at start-up.
 */
function canvasSurface(canvas) {
  try {
    const surface = canvas?.android
      ?.getSurfaceView?.()
      ?.getHolder?.()
      ?.getSurface?.();
    if (surface && surface.isValid?.() === true) return surface;
  } catch {
    // The view is gone or has no holder yet.
  }
  return undefined;
}

/** Applies the rate to the surface; returns whether it took. */
function requestSurface(surface, rate) {
  if (surface === undefined) return false;
  if (android.os.Build.VERSION.SDK_INT < 30) return false;
  try {
    if (
      android.os.Build.VERSION.SDK_INT >= STRATEGY_API &&
      typeof surface.setFrameRate === 'function'
    ) {
      surface.setFrameRate(rate, compatibility(), CHANGE_FRAME_RATE_ALWAYS);
    } else if (typeof surface.setFrameRate === 'function') {
      surface.setFrameRate(rate, compatibility());
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask Android to run the app at the display's highest refresh rate, and keep
 * asking after a mode change and whenever the SurfaceView (re)creates its
 * surface.
 *
 * A renderer that draws on every vsync draws at the rate the system gives it,
 * but Android keeps a window in the display's default mode (usually 60 Hz)
 * until the app votes for another: `WindowManager.LayoutParams
 * .preferredRefreshRate`/`preferredDisplayModeId` (the window request in the
 * display provider) and `Surface.setFrameRate` (the per-surface vote the
 * system counts). On a panel whose only mode is 60 Hz (every Android TV
 * measured) nothing is requested, so that behaviour is unchanged.
 *
 * The Surface is the part that must be re-applied: it is created after the
 * view is attached, and recreated on resume. On a Pixel 7 Pro a request made
 * only at start-up leaves the app at 60 Hz while the panel itself still
 * boosts to 120 for touches — which looks exactly like a 60 fps app on a
 * 120 Hz screen.
 *
 * Called from `bindAndroidCanvas`; returns the unsubscribe for the display
 * listener and the canvas events.
 */
export function bindDisplayRefreshRate(canvas) {
  const app = Application.android;
  if (!app) return () => {};
  const port = display(app);
  /** The rate the app asked for; 0 until the display reports a faster mode. */
  let target = 0;
  /** The last line logged, so a repeated apply with the same result is quiet. */
  let logged = '';

  const apply = (reason) => {
    let info;
    try {
      info = port.get();
    } catch {
      return;
    }
    const highest = Math.max(
      info.refreshRate,
      ...(info.supportedRefreshRates ?? []),
    );
    if (!(highest > 60)) {
      // A display that has not reported its modes yet reads as 60 Hz. A later
      // surface or display event retries; nothing is lost by returning here.
      const line = `${reason}: no faster mode yet (current ${info.refreshRate}, modes [${(info.supportedRefreshRates ?? []).join(',')}])`;
      if (line !== logged) log((logged = line));
      return;
    }
    target = highest;
    let window = 'asked';
    try {
      port.prefer?.('highest');
    } catch {
      window = 'no window';
    }
    const surface = canvasSurface(canvas);
    const surfaceSet = requestSurface(surface, target);
    const line = `${reason}: ${target} Hz (display ${info.refreshRate}, modes [${(info.supportedRefreshRates ?? []).join(',')}]) window ${window}, surface ${surfaceSet ? 'set' : surface ? 'failed' : 'not created'}`;
    if (line !== logged) log((logged = line));
  };

  apply('start-up');
  const onSurface = () => apply('surface');
  const events = ['surfaceCreated', 'surfaceResize'];
  try {
    for (const event of events) canvas?.on?.(event, onSurface);
  } catch {
    // A canvas without events still gets the start-up request.
  }
  const stop =
    port.subscribe?.(() => {
      // A mode switch may land on 60 Hz; ask for the highest again.
      apply('display changed');
    }) ?? (() => {});
  return () => {
    try {
      for (const event of events) canvas?.off?.(event, onSurface);
    } catch {
      // Disposed already.
    }
    stop();
  };
}
