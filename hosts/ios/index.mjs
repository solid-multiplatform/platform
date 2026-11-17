import { runNativeApp } from '../nativescript/boot.mjs';

/** Boots the shared UI on a native iOS Canvas. UIKit extensions live in the app. */
export function runIOS(loadApp) {
  runNativeApp(loadApp, () => () => {});
}
