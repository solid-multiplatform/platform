import * as lng from '@solid-multiplatform/platform';
import * as v from 'vitest';
import { installServices } from '../src/sdk/registry.ts';
import { webServices } from '../src/hosts/web-services/index.ts';
import { setCapabilities } from '../src/sdk/capabilities.ts';

lng.Config.domRendererEnabled = true;

// jsdom's frame timestamp can have a different origin from performance.now().
// Keep real frame scheduling/cancellation, but use the animation's start clock.
const requestFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (callback) =>
  requestFrame(() => callback(performance.now()));

globalThis.ResizeObserver = class MockResizeObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

globalThis.MutationObserver = class MockMutationObserver {
  constructor() {}
  observe() {}
  disconnect() {}
} as any;

// Every test file starts as the web target. Capabilities are module state:
// a file that set a television and reset it left the next file without a
// target, and focus behaviour followed the leftovers.
setCapabilities('web');

export const root = document.createElement('div');
document.body.appendChild(root);

if (!document.fonts) {
  // @ts-expect-error @ts-ignore
  document.fonts = {
    add: () => {},
    delete: () => {},
    check: () => true,
    load: () => Promise.resolve(),
    forEach: () => {},
    ready: Promise.resolve(),
  };
}

// jsdom stands in for a browser: unit tests get the browser's services.
installServices(webServices);

export const renderer = lng.createRenderer(undefined, root);

export const waitForUpdate = () => {
  return v.vi.waitFor(() => {
    let toReturn = false;
    setTimeout(() => {
      toReturn = true;
    }, 1);
    return toReturn;
  }, 1);
};
