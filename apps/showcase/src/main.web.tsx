/**
 * The browser entry: web, and the browser TVs (Tizen, webOS) with the same
 * bundle on the TV host. Everything browser-specific in the showcase is in
 * this file: the page's query string, `window` and `console` for the probe
 * result, and the DOM text field surface.
 */
import {
  Config,
  getRenderer,
  registerDefaultShaders,
} from '@solid-multiplatform/platform';
import type { RendererMain } from '@solid-multiplatform/renderer';
import { tvHost } from '@solid-multiplatform/platform/browser-tv/input';
import { browserControls } from '@solid-multiplatform/platform/controls/web';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { App } from './App';
import { parseLaunch } from './launch';
import { withKeyTap, type KeyTap } from './probe/keys';
import type { ProbeResult } from './probe/result';

/** Set by the build: `web`, or the browser TV the bundle is for. */
declare const __SHOWCASE_TARGET__: 'web' | 'tizen' | 'webos';

declare global {
  interface Window {
    /** The probe's result, once it has run. */
    __showcaseResult?: ProbeResult;
  }
}

const target = __SHOWCASE_TARGET__;
const options = { target, namespace: 'showcase' } as const;
let tap: KeyTap | undefined;

Config.fontSettings = { fontFamily: 'Lato', fontSize: 24 };

startApp(
  withKeyTap(
    target === 'web' ? webHost(options) : tvHost(webHost, options),
    (next) => {
      tap = next;
    },
  ),
  (context) => {
    // Rounded corners, borders, shadows and gradients are shaders of the
    // WebGL backend, and neither `startApp` nor `webHost` registers them.
    registerDefaultShaders(getRenderer() as RendererMain);
    return (
      <App
        env={{
          target: context.target,
          backend: 'webgl',
          launch: parseLaunch(window.location.search),
          report(result) {
            window.__showcaseResult = result;
            console.log('SHOWCASE_RESULT ' + JSON.stringify(result));
          },
          pressKey: (key) => tap?.press(key),
          controls: browserControls(context.surface),
        }}
      />
    );
  },
  {
    fonts: [
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasUrl: './fonts/Lato-Regular.msdf.png',
        atlasDataUrl: './fonts/Lato-Regular.msdf.json',
      },
    ],
  },
);
