/**
 * The browser entry: web, and the browser TVs (Tizen, webOS) on the same
 * bundle. Which UI family the app runs as is decided inside `App` from the
 * host's capabilities, not from this target name.
 */
import { Config } from '@solid-multiplatform/platform';
import { tvHost } from '@solid-multiplatform/platform/browser-tv/input';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { App } from './App';

declare const __GALLERY_TARGET__: 'web' | 'tizen' | 'webos';

const target = __GALLERY_TARGET__;
Config.fontSettings = { fontFamily: 'Lato', fontSize: 24 };

startApp(
  target === 'web'
    ? webHost({ target, namespace: 'gallery' })
    : tvHost(webHost, { target, namespace: 'gallery' }),
  (context) => <App back={context.back} />,
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
