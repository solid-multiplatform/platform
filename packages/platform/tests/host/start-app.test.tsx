// startApp on the DOM host: one call declares capabilities, builds the
// renderer, wires keys to focus, renders, and tears all of it down.
import { expect, test, vi } from 'vitest';
import {
  activeElement,
  Config,
  deviceInfo,
  getRenderer,
  useCapabilities,
  useColorScheme,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { startApp, type HostContext } from '@solid-multiplatform/platform/host';
import { domHost } from '@solid-multiplatform/platform/host/dom';
import {
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';

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
  matches: query === '(prefers-color-scheme: dark)',
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;
Config.domRendererEnabled = true;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('startApp runs an app on a host and its disposer tears it down', async () => {
  const root = document.body.appendChild(document.createElement('div'));
  let context!: HostContext<HTMLElement>;
  let first!: ElementNode;
  let second!: ElementNode;
  const onEnter = vi.fn();
  // Device services come from the host: none before it launches.
  expect(serviceAvailable('clipboard')).toBe('unavailable');

  const stop = startApp(
    domHost({ root, target: 'tizen', namespace: 'demo' }),
    (host) => {
      context = host;
      return (
        <view width={400} height={200}>
          <view
            ref={first}
            autofocus
            width={100}
            height={100}
            onRight={() => second.setFocus()}
          />
          <view
            ref={second}
            x={120}
            width={100}
            height={100}
            onEnter={onEnter}
          />
        </view>
      );
    },
    { renderer: { appWidth: 1280, appHeight: 720 } },
  );
  await tick();

  expect(useCapabilities().target).toBe('tizen');
  expect(useCapabilities().inputs).toEqual(['remote']);
  expect(context.surface).toBe(root);
  expect(context.keys).toBe(document);
  expect(context.pointer).toBeDefined();
  expect(context.text).toBeDefined();
  expect(serviceAvailable('clipboard')).toBe('available');
  expect((await deviceInfo()).platform).toBe('web');
  // Settings are stored under the host's namespace.
  const settings = await loadService('settings');
  await settings.set('volume', '7');
  expect(localStorage.getItem('demo:volume')).toBe('7');
  await settings.remove('volume');
  // The viewport binding found the colour scheme service already installed.
  expect(useColorScheme()).toBe('dark');
  expect(root.querySelectorAll('div').length).toBeGreaterThan(2);

  // Keys reach the focus manager through the host's key source.
  expect(activeElement()).toBe(first);
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39 }),
  );
  await tick();
  expect(activeElement()).toBe(second);
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }),
  );
  expect(onEnter).toHaveBeenCalledTimes(1);

  expect(typeof stop).toBe('function');
  (stop as () => void)();
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }),
  );
  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(getRenderer()).toBeDefined();
  expect(serviceAvailable('clipboard')).toBe('unavailable');
  expect(serviceAvailable('settings')).toBe('unavailable');
  await expect(deviceInfo()).rejects.toMatchObject({
    name: 'CapabilityError',
    capability: 'deviceInfo',
  });
});

test('the web host keeps settings under `app` unless told otherwise', async () => {
  const root = document.body.appendChild(document.createElement('div'));
  const stop = startApp(
    domHost({ root }),
    () => <view width={10} height={10} />,
    { renderer: { appWidth: 1280, appHeight: 720 } },
  );
  await tick();
  const settings = await loadService('settings');
  await settings.set('k', 'v');
  expect(localStorage.getItem('app:k')).toBe('v');
  await settings.remove('k');
  (stop as () => void)();
  expect(serviceAvailable('settings')).toBe('unavailable');
});

test('a host that fails while starting leaves no renderer factory installed', async () => {
  const { getRendererFactory } = await import('@solid-multiplatform/platform');
  const root = document.body.appendChild(document.createElement('div'));
  expect(() =>
    startApp(domHost({ root }), () => {
      throw new Error('app failed');
    }),
  ).toThrow('app failed');
  expect(getRendererFactory()).toBeUndefined();
});
