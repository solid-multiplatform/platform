import { runNativeApp } from '../nativescript/boot.mjs';

/** Forward a UIKit tap in scene coordinates, taking the view's measured size into account. */
export function runIOS(loadApp) {
  runNativeApp('ios', loadApp, (canvas, _bridge, platform) => {
    const tap = (gesture) => {
      const size = canvas.getActualSize();
      if (!size.width || !size.height) return;
      const event = new Event('click');
      Object.assign(event, {
        clientX:
          (gesture.getX() *
            (platform.Config.rendererOptions?.appWidth ?? 1920)) /
          size.width,
        clientY:
          (gesture.getY() *
            (platform.Config.rendererOptions?.appHeight ?? 1080)) /
          size.height,
      });
      window.dispatchEvent(event);
    };
    canvas.on('tap', tap);
    return () => canvas.off('tap', tap);
  });
}
