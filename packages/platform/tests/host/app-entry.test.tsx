// What a generated entry does for a component app: `appEntry` splits the
// project's settings from the host options, and `startApp` hands the
// component its host, so the app takes no props.
import { expect, test } from 'vitest';
import { Config } from '@solid-multiplatform/platform';
import {
  Screen,
  Text,
  useHost,
  usePlugin,
  useTheme,
  type HostInfo,
} from '@solid-multiplatform/platform/app';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { startApp, type HostContext } from '@solid-multiplatform/platform/host';
import { domHost } from '@solid-multiplatform/platform/host/dom';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof MutationObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;
Config.domRendererEnabled = true;

test('a component app reads its host, plugins and theme without props', async () => {
  const root = document.body.appendChild(document.createElement('div'));
  let host!: HostInfo;
  let seen: unknown[] = [];
  let context!: HostContext<HTMLElement>;
  function App() {
    host = useHost();
    seen = [
      usePlugin<{ id: string }>('greeting')?.id,
      useTheme().colorScheme,
    ];
    return (
      <Screen>
        <Text>Hello</Text>
      </Screen>
    );
  }
  const keyMap = { Enter: ['Enter', 'Select'] };
  const entry = appEntry(
    App,
    { greeting: { id: 'g' } },
    { fonts: [], keyMap, theme: 'light', designSize: { width: 1920, height: 1080 } },
    // The `options` export of src/app.tsx wins over the project config.
    { theme: 'dark' },
  );
  // Only what startApp understands is passed on to it.
  expect(entry.options).toEqual({ fonts: [], keyMap });

  const stop = startApp(
    domHost({ root, target: 'tizen', namespace: 'entry-test' }),
    (launched) => {
      context = launched;
      return entry.root();
    },
    entry.options,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));

  expect(host.target).toBe('tizen');
  expect(host.capabilities.inputs).toEqual(['remote']);
  expect(host.native).toBe(context.native);
  expect(seen).toEqual(['g', 'dark']);
  (stop as () => void)();
  root.remove();
});
