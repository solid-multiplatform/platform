import '@nativescript/canvas-polyfill';
import { Application, Color, GridLayout } from '@nativescript/core';
import { Canvas } from '@nativescript/canvas';
import { bindCanvas, bindLifecycle, installShims, KeyBridge } from '@solid-multiplatform/platform/nativescript';

export function runNativeApp(loadApp, bindDevice) {
  installShims();
  Application.run({ create() {
    const root = new GridLayout();
    root.backgroundColor = new Color('#000000');
    const canvas = new Canvas();
    canvas.width = '100%';
    canvas.height = '100%';
    canvas.iosOverflowSafeArea = true;
    canvas.once('ready', async () => {
      bindCanvas(canvas);
      const platform = await import('@solid-multiplatform/platform');
      platform.Config.preventDefaultOnHandledKeys = true;
      const bridge = new KeyBridge({ target: document });
      const unbind = bindDevice(canvas, bridge);
      const lifecycle = bindLifecycle(() => platform.renderer, bridge, Application);
      let dispose;
      let active = true;
      const cleanup = () => {
        active = false;
        dispose?.();
        unbind();
        lifecycle.unbind();
        Application.off('exit', cleanup);
      };
      Application.on('exit', cleanup);
      try {
        const app = await loadApp();
        if (active) dispose = app.mount();
      } catch (error) {
        cleanup();
        console.error('Native app startup failed', error);
      }
    });
    root.addChild(canvas);
    return root;
  } });
}
