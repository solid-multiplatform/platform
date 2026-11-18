// startApp on the DOM host: one call declares capabilities, builds the
// renderer, wires keys to focus, renders, and tears all of it down.
import { expect, test, vi } from 'vitest';
import {
  activeElement,
  Config,
  getRenderer,
  useCapabilities,
  type ElementNode,
} from '@solid-multiplatform/platform';
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('startApp runs an app on a host and its disposer tears it down', async () => {
  const root = document.body.appendChild(document.createElement('div'));
  let context!: HostContext<HTMLElement>;
  let first!: ElementNode;
  let second!: ElementNode;
  const onEnter = vi.fn();

  const stop = startApp(
    domHost({ root, target: 'tizen' }),
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
