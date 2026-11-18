import { Application } from '@nativescript/core';
import { bindRemote } from '@solid-multiplatform/platform/nativescript';
import { runNativeApp } from '../nativescript/boot.mjs';

export function runAppleTV(loadApp) {
  runNativeApp('apple-tv', loadApp, (_canvas, bridge) => {
    const remote = bindRemote(bridge, Application.ios.window);
    return () => remote.unbind();
  });
}
