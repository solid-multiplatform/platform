import { Application } from '@nativescript/core';

// UIInterfaceOrientationMask bits, by the names Info.plist uses.
const masks = {
  UIInterfaceOrientationPortrait: 2,
  UIInterfaceOrientationPortraitUpsideDown: 4,
  UIInterfaceOrientationLandscapeRight: 8,
  UIInterfaceOrientationLandscapeLeft: 16,
};

/** What the app's Info.plist allows on this device. */
function declaredOrientations() {
  const names = NSBundle.mainBundle.objectForInfoDictionaryKey(
    'UISupportedInterfaceOrientations',
  );
  let mask = 0;
  for (let i = 0; names && i < names.count; i++)
    mask |= masks[names.objectAtIndex(i)] ?? 0;
  return mask || 30; // UIInterfaceOrientationMaskAll
}

/**
 * The hook the iOS `orientation` service locks rotation through.
 *
 * UIKit asks the application delegate which orientations a window supports,
 * and the delegate's methods must exist before the application starts. So
 * the host calls this before it runs the app: it adds that one delegate
 * method, which answers with Info.plist's orientations until the app locks
 * one. Returns undefined where the delegate cannot be extended: the host then
 * installs no `orientation` service.
 */
export function captureAppleOrientation() {
  const application = Application.ios;
  if (typeof application?.addDelegateHandler !== 'function') return undefined;
  let allowed;
  application.addDelegateHandler(
    'applicationSupportedInterfaceOrientationsForWindow',
    () => allowed ?? declaredOrientations(),
  );
  return {
    /** A UIInterfaceOrientationMask, or undefined for Info.plist's own. */
    allow(mask) {
      allowed = mask;
    },
  };
}
