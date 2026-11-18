import { bindMobileViewport } from '../nativescript/viewport.mjs';
import { bindSceneTouch } from '../nativescript/touch.mjs';
import { runNativeApp } from '../nativescript/boot.mjs';

/** Forward a UIKit tap in scene coordinates, taking the view's measured size into account. */
export function runIOS(loadApp) {
  runNativeApp('ios', loadApp, (canvas, _bridge, platform, root) => {
    // The native controls overlay the host's black render surface.
    root.ios.overrideUserInterfaceStyle = 2; // UIUserInterfaceStyleDark
    const stopViewport = bindMobileViewport(root, 'ios');
    const touch = bindSceneTouch(canvas, 'ios');
    return {
      input: touch.input,
      dispose() {
        touch.dispose();
        stopViewport();
      },
    };
  });
}
