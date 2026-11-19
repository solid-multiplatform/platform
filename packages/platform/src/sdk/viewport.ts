import { setMotionPreference } from '../core/motionPreference.js';
import { createSignal } from 'solid-js';
import { Config } from '../core/config.js';
import { getRenderer } from '../core/lightningInit.js';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The four system insets an application may need, kept separate because they
 * are not interchangeable:
 *
 * - `safeArea` is the area that is safe to put content in (bars + cutout +
 *   anything the host decides to reserve).
 * - `systemBars` is the area occupied by status/navigation/caption bars.
 * - `displayCutout` is the physical notch/camera housing.
 * - `ime` is the software keyboard. Only `bottom` is normally non-zero.
 *
 * Android exposes these separately through `WindowInsets.Type`; iOS exposes
 * the combined safe area through `UIView.safeAreaInsets` and the keyboard
 * through `UIKeyboardWillChangeFrameNotification`. Web combines
 * `env(safe-area-inset-*)` with `visualViewport`.
 */
export interface ViewportInsets {
  safeArea: Insets;
  systemBars: Insets;
  displayCutout: Insets;
  ime: Insets;
}

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  framebufferWidth: number;
  framebufferHeight: number;
  /** Kept for compatibility. Equal to `insets.safeArea`. */
  safeArea: Insets;
  /** Kept for compatibility. Equal to `insets.ime.bottom`. */
  keyboardInset: number;
  insets: ViewportInsets;
  reducedMotion: boolean;
}

export const zeroInsets: Insets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export interface ViewportInput {
  width: number;
  height: number;
  scale: number;
  safeArea: Insets;
  keyboardInset: number;
  reducedMotion: boolean;
  systemBars?: Insets;
  displayCutout?: Insets;
  ime?: Insets;
}

const [viewport, publish] = createSignal<Viewport>({
  width: 1920,
  height: 1080,
  scale: 1,
  framebufferWidth: 1920,
  framebufferHeight: 1080,
  safeArea: zeroInsets,
  keyboardInset: 0,
  insets: {
    safeArea: zeroInsets,
    systemBars: zeroInsets,
    displayCutout: zeroInsets,
    ime: zeroInsets,
  },
  reducedMotion: false,
});
export { viewport };

const sameInsets = (a: Insets, b: Insets) =>
  a.top === b.top &&
  a.right === b.right &&
  a.bottom === b.bottom &&
  a.left === b.left;

/**
 * The title bar the scene draws, in scene units, above the host's own
 * insets. A mounted `<TitleBar>` publishes its height here, and removing it
 * (or entering fullscreen) sets it back to 0.
 */
let chromeTop = 0;
/** The host's last input, so a chrome change republishes with it. */
let hostInput: ViewportInput | undefined;

/**
 * Sets how much room the scene's title bar takes at the top, in scene units:
 * `insets.systemBars.top` and `insets.safeArea.top`. Called by the title bar
 * after layout and when fullscreen hides it; a target with native chrome
 * keeps 0.
 */
export function setChromeInset(top: number): void {
  const clean = Number.isFinite(top) && top > 0 ? top : 0;
  if (clean === chromeTop) return;
  chromeTop = clean;
  if (hostInput !== undefined) applyViewport(hostInput, getRenderer());
}

/** Called by host layout events, never from the frame loop. Sizes use logical units. */
export function updateViewport(
  next: ViewportInput,
  scene: ReturnType<typeof getRenderer> | null = getRenderer(),
) {
  hostInput = {
    ...next,
    safeArea: { ...next.safeArea },
    ...(next.systemBars === undefined
      ? {}
      : { systemBars: { ...next.systemBars } }),
  };
  applyViewport(next, scene);
}

function applyViewport(
  base: ViewportInput,
  scene: ReturnType<typeof getRenderer> | null,
) {
  const next: ViewportInput =
    chromeTop === 0
      ? base
      : {
          ...base,
          safeArea: { ...base.safeArea, top: base.safeArea.top + chromeTop },
          systemBars: {
            ...(base.systemBars ?? zeroInsets),
            top: (base.systemBars?.top ?? 0) + chromeTop,
          },
        };
  if (
    ![next.width, next.height, next.scale].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return;
  setMotionPreference(next.reducedMotion);
  const prev = viewport();
  const resized =
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.scale !== next.scale;
  const insets: ViewportInsets = {
    safeArea: { ...next.safeArea },
    systemBars: { ...(next.systemBars ?? zeroInsets) },
    displayCutout: { ...(next.displayCutout ?? zeroInsets) },
    ime: {
      ...zeroInsets,
      ...(next.ime ?? {}),
      bottom: next.ime?.bottom ?? next.keyboardInset,
    },
  };
  const settings = (Config.rendererOptions ??= {});
  Object.assign(settings, {
    appWidth: next.width,
    appHeight: next.height,
    devicePhysicalPixelRatio: next.scale,
    deviceLogicalPixelRatio: 1,
    resizable: true,
  });
  if (resized) {
    if (scene && 'resize' in scene && typeof scene.resize === 'function')
      scene.resize(next.width, next.height, next.scale);
  }
  if (
    resized ||
    !sameInsets(prev.insets.safeArea, insets.safeArea) ||
    !sameInsets(prev.insets.systemBars, insets.systemBars) ||
    !sameInsets(prev.insets.displayCutout, insets.displayCutout) ||
    !sameInsets(prev.insets.ime, insets.ime) ||
    prev.reducedMotion !== next.reducedMotion
  ) {
    publish({
      width: next.width,
      height: next.height,
      scale: next.scale,
      framebufferWidth: Math.round(next.width * next.scale),
      framebufferHeight: Math.round(next.height * next.scale),
      safeArea: insets.safeArea,
      keyboardInset: insets.ime.bottom,
      insets,
      reducedMotion: next.reducedMotion,
    });
  }
}
