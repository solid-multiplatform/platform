/**
 * The showcase on the native desktop runtime: the same scene the web builds,
 * started through `desktopHost`. Arguments after `--` reach it (`--probe`
 * runs the unattended probes and prints one JSON line, as on the web).
 * Built with the host's bundler:
 *
 *   node packages/host-desktop/cli/index.mjs build <this file> --out <dir> \
 *     --assets <fonts>
 */
import { Config } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { desktopHost } from '@solid-multiplatform/host-desktop';
import { App } from './App';
import { parseLaunch } from './launch';

// The runtime's own object: `argv` is what followed `--` on the command line.
const argv = (globalThis as { __solid?: { argv?: string[] } }).__solid?.argv;

Config.fontSettings = { fontFamily: 'Lato', fontSize: 24 };

startApp(
  desktopHost(),
  (context) => (
    <App
      env={{
        target: context.target,
        backend: 'webgl',
        launch: parseLaunch(argv ?? []),
        report(result) {
          console.log('SHOWCASE_RESULT ' + JSON.stringify(result));
        },
      }}
    />
  ),
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
