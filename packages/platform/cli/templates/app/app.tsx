import { createSignal, onCleanup } from 'solid-js';
import { Config } from '@solid-multiplatform/platform';
import {
  mountApp,
  type AppOptions,
  type HostWiring,
} from '@solid-multiplatform/platform/host';
import { Home } from './screens/Home';

export interface Plugin {
  run(): Promise<string>;
}

/** What the app runs on: the target's name and, on native targets, its root view. */
export interface AppHost {
  target: string;
  native?: unknown;
}

/** The fonts the app loads, from where the target serves its font files. */
export function appOptions(fontRoot?: string): AppOptions {
  if (!fontRoot) return {};
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  return {
    fonts: [
      {
        type: 'msdf',
        fontFamily: 'Lato',
        atlasUrl: fontRoot + '/Lato-Regular.msdf.png',
        atlasDataUrl: fontRoot + '/Lato-Regular.msdf.json',
      },
    ],
  };
}

export function App(props: { plugins: Record<string, Plugin>; host: AppHost }) {
  const [message, setMessage] = createSignal('__APP_NAME__');
  let active = true,
    latest = 0;
  onCleanup(() => {
    active = false;
  });
  // Shows what the plugin returns; a slower earlier run does not overwrite it.
  function run(name: string) {
    const call = ++latest;
    const show = (value: unknown) => {
      if (active && call === latest) setMessage(String(value));
    };
    void Promise.resolve()
      .then(() => props.plugins[name]!.run())
      .then(show, show);
  }
  return (
    <Home
      names={Object.keys(props.plugins)}
      message={message()}
      onRun={run}
      target={props.host.target}
      native={props.host.native as object | undefined}
    />
  );
}

/**
 * The entry of the targets that do not start through `startApp` yet (Roku,
 * Android, iOS, tvOS, desktop): each one's generated entry calls it with what
 * its host has. Browser targets start `App` with `startApp`.
 */
export function mount(
  plugins: Record<string, Plugin>,
  fontRoot?: string,
  pointer?: HostWiring['pointer'],
  host?: { target: string; root?: object; semantics?: HostWiring['semantics'] },
) {
  return mountApp(
    () => (
      <App
        plugins={plugins}
        host={{ target: host?.target ?? '', native: host?.root }}
      />
    ),
    { pointer, semantics: host?.semantics },
    appOptions(fontRoot),
  );
}
