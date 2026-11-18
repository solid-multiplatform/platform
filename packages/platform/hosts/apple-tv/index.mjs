import { Application } from '@nativescript/core';
import { bindRemote } from '@solid-multiplatform/platform/nativescript';
import { installServices } from '@solid-multiplatform/platform/services';
import { appleServices } from '../nativescript/providers/apple/manifest.ts';
import { runNativeApp } from '../nativescript/boot.mjs';

export function runAppleTV(loadApp) {
  runNativeApp('apple-tv', loadApp, (_canvas, bridge) => {
    // Lazy providers: nothing is constructed until the app uses a service.
    const removeServices = installServices(appleServices({ form: 'tv' }));
    const remote = bindRemote(bridge, Application.ios.window);
    return () => {
      remote.unbind();
      removeServices();
    };
  });
}
