import { createInputScope } from '@solid-multiplatform/platform/input';

// Vendor key events on old TV browsers may only contain keyCode.
const remoteKeys = {
  10009: 'Backspace',
  461: 'Backspace',
  13: 'Enter',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  415: 'MediaPlay',
  19: 'MediaPause',
  413: 'MediaStop',
  10252: 'MediaPlayPause',
};
export { bindTVViewport } from './viewport.mjs';
export function bindBrowserTV(target, root, toScene) {
  const scope = createInputScope();
  const release = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    release.push(() => el.removeEventListener(type, fn, opts));
  };
  const point =
    toScene ??
    ((e) => {
      const box = root.getBoundingClientRect();
      return {
        x: ((e.clientX - box.left) * 1920) / box.width,
        y: ((e.clientY - box.top) * 1080) / box.height,
      };
    });
  on(root, 'mousedown', (e) => {
    if (e.button === 0) scope.down(1, point(e));
  });
  on(window, 'mousemove', (e) => scope.move(1, point(e)));
  on(window, 'mouseup', (e) => {
    if (e.button === 0) scope.up(1, point(e));
  });
  on(
    root,
    'wheel',
    (e) => {
      if (scope.wheel(point(e), e.deltaX, e.deltaY)) e.preventDefault();
    },
    { passive: false },
  );
  on(window, 'blur', scope.cancelAll);
  const fixKey = (e) => {
    const name = remoteKeys[e.keyCode];
    if (!name || e.key === name) return;
    try {
      Object.defineProperty(e, 'key', { configurable: true, value: name });
    } catch {
      /* Firmware keyCode remains available. */
    }
  };
  on(document, 'keydown', fixKey, true);
  on(document, 'keyup', fixKey, true);
  if (target === 'tizen' && globalThis.tizen?.tvinputdevice) {
    const device = tizen.tvinputdevice;
    const keys = device
      .getSupportedKeys()
      .map((k) => k.name)
      .filter((k) =>
        ['MediaPlay', 'MediaPause', 'MediaStop', 'MediaPlayPause'].includes(k),
      );
    for (const key of keys) {
      device.registerKey(key);
      release.push(() => device.unregisterKey(key));
    }
  }
  return {
    input: scope,
    dispose() {
      for (const f of release.reverse()) f();
      scope.dispose();
    },
  };
}
