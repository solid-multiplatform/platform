import '@nativescript/canvas-polyfill';
import { Application, Color, GridLayout } from '@nativescript/core';
import { Canvas } from '@nativescript/canvas';
import {
  bindCanvas,
  bindLifecycle,
  installShims,
  KeyBridge,
} from '@solid-multiplatform/platform/nativescript';
import { createMemoryHistory } from './history.mjs';
import { nativeEditorHost } from './editors.mjs';

/**
 * Reports a start-up failure where a release build can see it. Android release
 * bundling strips `console.*`, so an app that failed to start used to be a
 * black screen with nothing in logcat.
 */
function reportStartupFailure(message, error) {
  const detail = String(error?.stack ?? error?.message ?? error);
  const log = globalThis.android?.util?.Log;
  if (typeof log?.e === 'function')
    log.e('SolidMultiplatform', message + ': ' + detail);
  else console.error(message, error);
}

export function runNativeApp(
  target,
  loadApp,
  bindDevice,
  createCanvas = () => new Canvas(),
) {
  installShims();
  Application.run({
    create() {
      const root = new GridLayout();
      // iOS screen bounds already include the viewport's UIKit safe insets.
      // Keep GridLayout from adding the same offset to its native children.
      if (target === 'ios') root.iosIgnoreSafeArea = true;
      root.backgroundColor = new Color('#000000');
      const canvas = createCanvas();
      canvas.width = '100%';
      canvas.height = '100%';
      canvas.iosOverflowSafeArea = true;
      const start = async () => {
        bindCanvas(canvas);
        const platform = await import('@solid-multiplatform/platform');
        platform.Config.preventDefaultOnHandledKeys = true;
        platform.setCapabilities(target);
        // The bridge is the app's key source: no target, so nothing is
        // dispatched to a fake `document`. The focus manager listens on it.
        const bridge = new KeyBridge();
        // The router's stack, owned here: the target's Back handling drives
        // it, and no `window.history` shim exists to read.
        const history = createMemoryHistory();
        const binding = bindDevice(canvas, bridge, platform, root, history);
        const lifecycle = bindLifecycle(
          () => platform.renderer,
          bridge,
          Application,
        );
        const android = target === 'android' || target === 'android-tv';
        let surfaceLost = false;
        const redraw = () => platform.getRenderer()?.requestRender?.();
        const lost = () => {
          surfaceLost = true;
        };
        const restored = () => {
          // NativeScript sends surfaceResize after reattaching EGL to the holder.
          // The logical scene can be idle while the new buffer is still empty.
          if (surfaceLost) {
            surfaceLost = false;
            redraw();
          }
        };
        if (android) {
          canvas.on('surfaceDestroyed', lost);
          canvas.on('surfaceResize', restored);
          // The renderer resume is deliberately deferred by bindLifecycle so
          // it does not draw in the window-visibility vsync. Only a lost
          // surface needs an immediate redraw here; that arrives via
          // surfaceResize -> restored().
        }
        let dispose;
        let active = true;
        const cleanup = () => {
          active = false;
          try {
            dispose?.();
          } finally {
            if (typeof binding === 'function') binding();
            else binding.dispose();
            lifecycle.unbind();
            if (android) {
              canvas.off('surfaceDestroyed', lost);
              canvas.off('surfaceResize', restored);
            }
            Application.off('exit', cleanup);
          }
        };
        Application.on('exit', cleanup);
        try {
          const app = await loadApp({
            target,
            root,
            canvas,
            keys: bridge,
            history,
            text: nativeEditorHost(root, target),
            input: binding.input,
          });
          if (active) dispose = app.mount();
        } catch (error) {
          cleanup();
          reportStartupFailure('Native app startup failed', error);
        }
      };
      // A failure before the app loader runs (host module evaluation, input
      // binding) would otherwise disappear with the rejected handler promise.
      canvas.once('ready', () => {
        start().catch((error) =>
          reportStartupFailure('Native host startup failed', error),
        );
      });
      root.addChild(canvas);
      return root;
    },
  });
}
