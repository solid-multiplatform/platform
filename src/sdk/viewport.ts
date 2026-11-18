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
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  framebufferWidth: number;
  framebufferHeight: number;
  safeArea: Insets;
  keyboardInset: number;
  reducedMotion: boolean;
}
export const zeroInsets: Insets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
type Geometry = Omit<Viewport, 'framebufferWidth' | 'framebufferHeight'>;
const [viewport, publish] = createSignal<Viewport>({
  width: 1920,
  height: 1080,
  scale: 1,
  framebufferWidth: 1920,
  framebufferHeight: 1080,
  safeArea: zeroInsets,
  keyboardInset: 0,
  reducedMotion: false,
});
export { viewport };

/** Called by host layout events, never from the frame loop. Sizes use logical units. */
export function updateViewport(next: Geometry) {
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
  const a = prev.safeArea,
    b = next.safeArea;
  const settings = (Config.rendererOptions ??= {});
  Object.assign(settings, {
    appWidth: next.width,
    appHeight: next.height,
    devicePhysicalPixelRatio: next.scale,
    deviceLogicalPixelRatio: 1,
    resizable: true,
  });
  if (resized) {
    const scene = getRenderer();
    if (scene && 'resize' in scene && typeof scene.resize === 'function')
      scene.resize(next.width, next.height, next.scale);
  }
  if (
    resized ||
    a.top !== b.top ||
    a.left !== b.left ||
    a.right !== b.right ||
    a.bottom !== b.bottom ||
    prev.keyboardInset !== next.keyboardInset ||
    prev.reducedMotion !== next.reducedMotion
  ) {
    publish({
      ...next,
      safeArea: { ...b },
      framebufferWidth: Math.round(next.width * next.scale),
      framebufferHeight: Math.round(next.height * next.scale),
    });
  }
}
