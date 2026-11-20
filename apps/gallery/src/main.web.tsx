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
Config.fontSettings = { fontFamily: 'Roboto', fontSize: 24 };

startApp(
  target === 'web'
    ? webHost({ target, namespace: 'gallery' })
    : tvHost(webHost, { target, namespace: 'gallery' }),
  () => <App />,
  {
    fonts: [
      {
        // The family, and the weight names the scene builds from it: bold is
        // a real face ("Roboto700"), not a synthesised one. A weight with no
        // face registered parks its text, so only real faces are listed.
        type: 'msdf',
        fontFamily: 'Roboto',
        aliases: ['Roboto500'],
        atlasUrl: './fonts/Roboto-Regular.msdf.png',
        atlasDataUrl: './fonts/Roboto-Regular.msdf.json',
      },
      {
        type: 'msdf',
        fontFamily: 'Roboto700',
        aliases: ['Roboto900'],
        atlasUrl: './fonts/Roboto-Bold.msdf.png',
        atlasDataUrl: './fonts/Roboto-Bold.msdf.json',
      },
    ],
  },
);
