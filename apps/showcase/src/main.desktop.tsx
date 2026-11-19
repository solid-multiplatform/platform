/**
 * The showcase on the native desktop runtime: the same scene the web builds,
 * started through `desktopHost`. Arguments after `--` reach it (`--probe`
 * runs the unattended probes and prints one JSON line, as on the web).
 * Built with the host's bundler:
 *
 *   node packages/host-desktop/cli/index.mjs build <this file> --out <dir> \
 *     --assets <fonts>
 *
 * The window's title bar is the scene's own `<TitleBar>`: the demo of the
 * desktop window chrome. Run the build with `--title-bar=custom` to see it
 * (in the default `native` mode it renders nothing and the window system
 * draws the bar). Screens that lay out inside `<Screen>` already move below
 * it through `viewport().safeArea`, which the bar publishes its height to;
 * this entry's own top offset follows the same inset the event-driven way.
 */
import { Show, createSignal, onCleanup } from 'solid-js';
import {
  Config,
  ThemeProvider,
  darkTheme,
} from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { onChromeStateChange } from '@solid-multiplatform/platform/chrome';
import { TitleBar } from '@solid-multiplatform/platform/primitives';
import { desktopHost } from '@solid-multiplatform/host-desktop';
import { App } from './App';
import { parseLaunch } from './launch';

// The runtime's own object: `argv` is what followed `--` on the command line.
const argv = (globalThis as { __solid?: { argv?: string[] } }).__solid?.argv;

/** The demo title bar's height, in scene units. */
const BAR = 40;

Config.fontSettings = { fontFamily: 'Lato', fontSize: 24 };

startApp(
  desktopHost({ id: 'showcase', title: 'Solid Multiplatform' }),
  (context) => {
    const chrome = context.chrome;
    // The bar's own inset, followed the event-driven way: the scene moves
    // below the bar in custom mode and back up when fullscreen hides it.
    const [top, setTop] = createSignal(
      chrome !== undefined &&
        chrome.mode !== 'native' &&
        !chrome.state().fullscreen
        ? BAR
        : 0,
    );
    if (chrome !== undefined) {
      onCleanup(
        onChromeStateChange(() =>
          setTop(
            chrome.mode !== 'native' && !chrome.state().fullscreen ? BAR : 0,
          ),
        ),
      );
    }
    return (
      <ThemeProvider theme={darkTheme}>
        <Show when={chrome !== undefined}>
          <TitleBar title="Solid Multiplatform" height={BAR} />
        </Show>
        <view y={top()}>
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
        </view>
      </ThemeProvider>
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
