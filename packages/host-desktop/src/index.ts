// The desktop host: runs a Solid Multiplatform app in the native runtime
// (packages/host-desktop/native) with the WebGL renderer.
import { setDefaultPlatform } from '@solid-multiplatform/renderer/platform';
import { getRenderer } from '@solid-multiplatform/platform';
import {
  updateViewport,
  zeroInsets,
} from '@solid-multiplatform/platform/viewport';
import { DesktopPlatform, windowMetrics } from './platform.js';

export { DesktopPlatform } from './platform.js';

function applyWindowSize(): void {
  const { width, height, scale } = windowMetrics();
  updateViewport({
    width,
    height,
    scale,
    safeArea: zeroInsets,
    keyboardInset: 0,
    reducedMotion: false,
  });
}

/**
 * Start an app: `mount` creates the renderer and renders the scene, as on
 * any target, and may return a function that disposes of it. The renderer
 * it creates draws into the window, at the window's size, and follows the
 * window when it is resized.
 *
 * Returns the function that disposes of the app.
 */
export function startDesktop(mount: () => (() => void) | void): () => void {
  setDefaultPlatform(DesktopPlatform);
  // Before the app runs: its layout reads the viewport from its first line.
  applyWindowSize();
  // The runtime calls back when the window changes; nothing here runs
  // otherwise.
  let disposed = false;
  __solid.window!.listen((kind) => {
    if (disposed) return;
    if (kind === 'resize') {
      applyWindowSize();
    } else {
      // The window system dropped the window's contents: draw them again.
      const renderer = getRenderer() as
        | { requestRender?: () => void }
        | undefined;
      renderer?.requestRender?.();
    }
  });
  const dispose = mount();
  return () => {
    disposed = true;
    dispose?.();
  };
}
