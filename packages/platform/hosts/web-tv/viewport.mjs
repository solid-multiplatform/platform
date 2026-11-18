import { Config, getRenderer } from '@solid-multiplatform/platform';
import {
  updateViewport,
  zeroInsets,
} from '@solid-multiplatform/platform/viewport';

/** Fit one logical TV stage inside its host while preserving its aspect ratio. */
export function bindTVViewport(root, width = 1920, height = 1080) {
  if (
    !(
      Number.isFinite(width) &&
      width > 0 &&
      Number.isFinite(height) &&
      height > 0
    )
  )
    throw new RangeError('TV stage dimensions must be positive and finite');
  let canvas;
  let scene = null;
  Config.rendererOptions = {
    ...Config.rendererOptions,
    appWidth: width,
    appHeight: height,
    deviceLogicalPixelRatio: 1,
    resizable: true,
  };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let density;
  const fit = () => {
    const w = root.clientWidth,
      h = root.clientHeight;
    if (!w || !h) return;
    const factor = Math.min(w / width, h / height);
    const dpr = window.devicePixelRatio || 1;
    updateViewport(
      {
        width,
        height,
        scale: factor * dpr,
        keyboardInset: 0,
        safeArea: zeroInsets,
        reducedMotion: motion.matches,
      },
      scene,
    );
    if (canvas) {
      const style = canvas.style;
      style.display = 'block';
      const frameWidth = Math.round(width * factor * dpr);
      const frameHeight = Math.round(height * factor * dpr);
      style.width = frameWidth / dpr + 'px';
      style.height = frameHeight / dpr + 'px';
      style.marginLeft = Math.round((w * dpr - frameWidth) / 2) / dpr + 'px';
      style.marginTop = Math.round((h * dpr - frameHeight) / 2) / dpr + 'px';
    }
  };
  const observer =
    typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  observer?.observe(root);
  window.addEventListener('resize', fit);
  motion.addListener(fit);
  const trackDensity = () => {
    density?.removeListener(trackDensity);
    density = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    density.addListener(trackDensity);
    fit();
  };
  trackDensity();
  return {
    attach() {
      const renderer = getRenderer();
      if (renderer?.canvas && root.contains(renderer.canvas)) {
        scene = renderer;
        canvas = renderer.canvas;
      }
      fit();
    },
    point(event) {
      const rect = (canvas || root).getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) * width) / rect.width,
        y: ((event.clientY - rect.top) * height) / rect.height,
      };
    },
    dispose() {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      motion.removeListener(fit);
      density.removeListener(trackDensity);
    },
  };
}
