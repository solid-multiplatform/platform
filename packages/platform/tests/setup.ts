import * as lng from '@solid-multiplatform/platform';
import * as v from 'vitest';
import { installServices } from '../src/sdk/registry.ts';
import { webServices } from '../src/hosts/web-services/index.ts';
import { setCapabilities } from '../src/sdk/capabilities.ts';
import { updateViewport, zeroInsets } from '../src/sdk/viewport.ts';

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
// The viewport is module state too, and the layout-audit files resize it to
// phone and TV profiles: a file that ran after them in the same worker
// inherited the last profile (a drawer finder assuming 1920x1080 broke once
// a 320-pt profile had run). Start every file on the default scene.
updateViewport(
  {
    width: 1920,
    height: 1080,
    scale: 1,
    safeArea: zeroInsets,
    keyboardInset: 0,
    reducedMotion: false,
  },
  null,
);

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
