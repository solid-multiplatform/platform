import { updateViewport, zeroInsets } from './viewport.js';
import { bindColorScheme } from './theme.js';
import { setCapabilities } from './capabilities.js';

export function bindBrowserViewport(root: HTMLElement) {
  setCapabilities('web');
  const stopScheme = bindColorScheme();
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  root.appendChild(probe);
  const visual = window.visualViewport;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let density: MediaQueryList | undefined;
  const update = () => {
    const { width, height, bottom } = root.getBoundingClientRect();
    const style = getComputedStyle(probe);
    updateViewport({
      width,
      height,
      scale: window.devicePixelRatio || 1,
      keyboardInset:
        visual && visual.scale === 1
          ? Math.max(0, bottom - visual.height - visual.offsetTop)
          : 0,
      ime: {
        ...zeroInsets,
        bottom:
          visual && visual.scale === 1
            ? Math.max(0, bottom - visual.height - visual.offsetTop)
            : 0,
      },
      safeArea: {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      },
      reducedMotion: motion.matches,
    });
  };
  const trackDensity = () => {
    density?.removeEventListener('change', trackDensity);
    density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener('change', trackDensity);
    update();
  };
  const observer = new ResizeObserver(update);
  observer.observe(root);
  visual?.addEventListener('resize', update);
  visual?.addEventListener('scroll', update);
  motion.addEventListener('change', update);
  trackDensity();
  return () => {
    observer.disconnect();
    density?.removeEventListener('change', trackDensity);
    visual?.removeEventListener('resize', update);
    visual?.removeEventListener('scroll', update);
    motion.removeEventListener('change', update);
    stopScheme();
    probe.remove();
  };
}
