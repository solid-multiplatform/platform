import type { OrientationPort } from '@solid-multiplatform/platform/device';
import { windowScene } from './scene.js';

/** The host's application-delegate hook: `captureAppleOrientation`. */
export interface OrientationHook {
  /** A UIInterfaceOrientationMask, or undefined for Info.plist's own. */
  allow(mask: number | undefined): void;
}

const UIInterfaceOrientationMaskPortrait = 2;
const UIInterfaceOrientationMaskLandscape = 24;

/**
 * iOS only, iOS 16 and later. The lock narrows what the application delegate
 * allows and asks the scene to rotate into it; `any` returns to what
 * Info.plist declares. UIKit reports a refused rotation only later and only
 * as an error, so the promise resolves once the request is made.
 */
export function orientation(hook: OrientationHook): OrientationPort {
  return {
    async lock(value) {
      const scene = windowScene();
      const controller =
        UIApplication.sharedApplication.keyWindow?.rootViewController;
      if (
        !scene ||
        !controller ||
        typeof scene.requestGeometryUpdateWithPreferencesErrorHandler !==
          'function'
      )
        throw new Error('Orientation lock needs iOS 16');
      const mask =
        value === 'any'
          ? undefined
          : value === 'portrait'
            ? UIInterfaceOrientationMaskPortrait
            : UIInterfaceOrientationMaskLandscape;
      hook.allow(mask);
      controller.setNeedsUpdateOfSupportedInterfaceOrientations();
      if (mask !== undefined)
        scene.requestGeometryUpdateWithPreferencesErrorHandler(
          UIWindowSceneGeometryPreferencesIOS.alloc().initWithInterfaceOrientations(
            mask,
          ),
          () => {},
        );
    },
  };
}
