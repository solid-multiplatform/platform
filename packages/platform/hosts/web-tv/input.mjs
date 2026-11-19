import { createInputScope } from '@solid-multiplatform/platform/input';
import { bindTVViewport } from './viewport.mjs';

export { bindTVViewport };

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
/**
 * The remote of a browser TV: key names for firmware that only sends key
 * codes, the media keys Tizen hands out on request, and, unless `pointer` is
 * false, the mouse events of a pointer remote as the host's pointer source
 * (`input`). A remote-only build passes false and listens for no mouse.
 */
export function bindBrowserTV(target, root, toScene, pointer = true) {
  const scope = pointer ? createInputScope() : undefined;
  const release = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    release.push(() => el.removeEventListener(type, fn, opts));
  };
  if (scope) {
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
  }
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
      scope?.dispose();
    },
  };
}

/**
 * A browser TV's host. `create` is the web host for the TV's engine
 * (`webHost`, or `canvasHost` where there is no WebGL 2); around it this fits
 * the fixed TV stage in the window and binds the remote. `options` are the
 * web host's; `pointer: false` leaves the pointer remote out.
 */
export function tvHost(create, options = {}) {
  let display;
  const host = create({
    ...options,
    // The TV's pointer is bound here: mouse events, which every TV browser
    // has, in stage coordinates.
    pointer: false,
    viewport: (surface) => (display = bindTVViewport(surface)),
  });
  return {
    target: host.target,
    capabilities: host.capabilities,
    launch(run) {
      return host.launch((context) => {
        const tv = bindBrowserTV(
          context.target,
          context.surface,
          display.point,
          options.pointer !== false,
        );
        let stop;
        try {
          stop = run({ ...context, pointer: tv.input });
        } catch (error) {
          tv.dispose();
          throw error;
        }
        return () => {
          try {
            stop();
          } finally {
            tv.dispose();
          }
        };
      });
    },
  };
}
