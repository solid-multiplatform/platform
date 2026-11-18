import { installServices } from '@solid-multiplatform/platform/services';
import { appleServices } from '../nativescript/providers/apple/manifest.ts';
import { captureAppleLinks } from '../apple/links.mjs';
import { captureAppleOrientation } from '../apple/orientation.mjs';
import { bindMobileViewport } from '../nativescript/viewport.mjs';
import { bindSceneTouch } from '../nativescript/touch.mjs';
import { runNativeApp } from '../nativescript/boot.mjs';

/** Forward a UIKit tap in scene coordinates, taking the view's measured size into account. */
export function runIOS(loadApp) {
  const links = captureAppleLinks();
  const orientation = captureAppleOrientation();
  runNativeApp('ios', loadApp, (canvas, _bridge, platform, root) => {
    // Lazy providers: nothing is constructed until the app uses a service.
    const removeServices = installServices(
      appleServices({ form: 'phone', links, orientation }),
    );
    // The native controls overlay the host's black render surface.
    root.ios.overrideUserInterfaceStyle = 2; // UIUserInterfaceStyleDark
    const stopViewport = bindMobileViewport(root, 'ios');
    const touch = bindSceneTouch(canvas, 'ios');
    return {
      input: touch.input,
      dispose() {
        touch.dispose();
        stopViewport();
        removeServices();
      },
    };
  });
}
