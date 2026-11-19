import { createInputScope } from '@solid-multiplatform/platform/input';
import { pressKey } from '@solid-multiplatform/platform/focusManager';
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
 * The PS4 browser's input: a mouse pointer and left click, and nothing else
 * the host declares. The pointer moves focus (the scene's hover focus), a
 * click activates what is under it, and a click on empty space presses Enter
 * on the focused node, which is the console's Select. A browser Back key is
 * cancelled and delivered as Escape; the browser never navigates away.
 *
 * Nothing here runs while the pointer is still: no timers, no frame work.
 * A move reuses one point object and allocates nothing beyond the hit test.
 */
export function bindPS4(root, toScene) {
  const scope = createInputScope({ hoverFocus: true });
  const release = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    release.push(() => el.removeEventListener(type, fn, opts));
  };
  const projected =
    toScene ??
    ((e) => {
      const box = root.getBoundingClientRect();
      return {
        x: ((e.clientX - box.left) * 1920) / box.width,
        y: ((e.clientY - box.top) * 1080) / box.height,
      };
    });
  // One point for every event: the sink reads it during the call.
  const point = { x: 0, y: 0 };
  const at = (e) => {
    const p = projected(e);
    point.x = p.x;
    point.y = p.y;
    return point;
  };
  // A press that missed every target: on release, Enter goes to the focus.
  let missed = false;
  on(root, 'mousedown', (e) => {
    if (e.button !== 0) return;
    missed = !scope.down(1, at(e));
  });
  on(window, 'mousemove', (e) => scope.move(1, at(e)));
  on(window, 'mouseup', (e) => {
    if (e.button !== 0) return;
    scope.up(1, at(e));
    if (missed) pressKey('Enter', ENTER);
    missed = false;
  });
  on(
    root,
    'wheel',
    (e) => {
      if (scope.wheel(at(e), e.deltaX, e.deltaY)) e.preventDefault();
    },
    { passive: false },
  );
  on(window, 'blur', () => {
    missed = false;
    scope.cancelAll();
  });
  // The console's Back button arrives as a browser Back key. Cancel its
  // default (the webview must not navigate) and send it down the focus path
  // as Escape; Backspace and Escape already map there and only need their
  // default cancelled. This is a key fallback, not a declared input kind:
  // capabilities still say mouse only.
  on(
    document,
    'keydown',
    (e) => {
      if (
        e.key === 'BrowserBack' ||
        e.key === 'GoBack' ||
        e.keyCode === 166 ||
        e.keyCode === 461
      ) {
        e.preventDefault();
        pressKey('Escape', ESCAPE);
      } else if (e.key === 'Backspace' || e.key === 'Escape') {
        e.preventDefault();
      }
    },
    true,
  );
  return {
    input: scope,
    dispose() {
      for (const f of release.reverse()) f();
      scope.dispose();
    },
  };
}

const ENTER = Object.freeze({
  key: 'Enter',
  keyCode: 13,
  which: 13,
  repeat: false,
  preventDefault() {},
  stopPropagation() {},
});
const ESCAPE = Object.freeze({
  key: 'Escape',
  keyCode: 27,
  which: 27,
  repeat: false,
  preventDefault() {},
  stopPropagation() {},
});

/**
 * A browser TV's host. `create` is the web host for the TV's engine
 * (`webHost`, or `canvasHost` where there is no WebGL 2); around it this fits
 * the fixed TV stage in the window and binds the remote. `options` are the
 * web host's; `pointer: false` leaves the pointer remote out. `ps4: true`
 * binds the PS4's pointer-only input instead (see {@link bindPS4}).
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
        const tv = options.ps4
          ? bindPS4(context.surface, display.point)
          : bindBrowserTV(
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

/**
 * The PlayStation 4 host: the browser TV host with the pointer-only input
 * (focus follows the pointer, left click is Select, Back is Escape). `create`
 * is `webHost`, or `canvasHost` for the `--legacy` Canvas 2D build.
 */
export function ps4Host(create, options = {}) {
  return tvHost(create, { ...options, target: 'ps4', ps4: true });
}
