/**
 * The native desktop entry: the same scene in the Rust window. Built with
 * the host's bundler:
 *
 *   node packages/host-desktop/cli/index.mjs build src/main.desktop.tsx \
 *     --out dist/desktop --assets ../../packages/platform/tests/webgl/fonts
 */
import { Config } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { desktopHost } from '@solid-multiplatform/host-desktop';
import { App } from './App';

Config.fontSettings = { fontFamily: 'Roboto', fontSize: 24 };

startApp(desktopHost({ id: 'gallery', title: 'Sona' }), () => <App />, {
  fonts: [
    {
      type: 'msdf',
      fontFamily: 'Lato',
      atlasUrl: './fonts/Lato-Regular.msdf.png',
      atlasDataUrl: './fonts/Lato-Regular.msdf.json',
    },
  ],
});
