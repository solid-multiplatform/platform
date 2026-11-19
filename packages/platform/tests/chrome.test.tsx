// The window chrome primitives: the regions they publish for the host's hit
// test, the batching behind them (one native call per layout turn), and the
// top inset a mounted <TitleBar> publishes. The desktop runtime test
// (packages/host-desktop/tests/chrome) drives the same primitives against a
// real window; this one checks what they measure, without a host.
import * as v from 'vitest';
import { createComponent, createSignal, Show } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  TitleBar,
  WindowDragRegion,
  WindowNoDrag,
} from '@solid-multiplatform/platform/primitives';
import {
  notifyChromeStateChange,
  setChromeRegionSink,
  type ChromeRegion,
  type WindowChrome,
  type WindowChromeState,
} from '../src/sdk/chrome.js';
// The source path, not the package subpath: the primitives read this module,
// and in vitest the package path resolves to `dist`, another instance of it.
import {
  updateViewport,
  viewport,
  zeroInsets,
} from '../src/sdk/viewport.js';
import { HostScope } from '../src/app/context.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

/** The chrome the desktop host would supply, with a state the test drives. */
function fakeChrome(mode: 'native' | 'custom' | 'hidden'): {
  chrome: WindowChrome;
  state: WindowChromeState;
} {
  const state: WindowChromeState = {
    focused: true,
    minimized: false,
    maximized: false,
    fullscreen: false,
    resizable: true,
  };
  const chrome: WindowChrome = {
    os: 'linux',
    mode,
    hitTestInstalled: mode !== 'native',
    state: () => ({ ...state }),
    minimize: () => true,
    toggleMaximized: () => true,
    setFullscreen: () => true,
    requestClose: () => {},
    showSystemMenu: () => true,
  };
  return { chrome, state };
}

let stop: (() => void) | undefined;
let batches: ChromeRegion[][] = [];

async function mount(
  chrome: WindowChrome,
  app: () => lng.JSX.Element,
): Promise<void> {
  const before = lng.rootNode.children.slice();
  const dispose = renderer.render(() =>
    createComponent(HostScope.Provider, {
      value: { target: 'desktop', chrome },
      get children() {
        return app();
      },
    }),
  );
  stop = () => {
    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.includes(child)) continue;
      lng.rootNode.removeChild(child);
      (child as lng.ElementNode).destroy();
    }
  };
  await settle();
}

v.beforeEach(() => {
  batches = [];
  setChromeRegionSink((regions) =>
    batches.push(regions.map((region) => ({ ...region }))),
  );
});

v.afterEach(() => {
  stop?.();
  stop = undefined;
  setChromeRegionSink(undefined);
});

v.describe('WindowDragRegion and WindowNoDrag', () => {
  v.it('publish one measured rectangle each, in scene units', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <>
        <WindowDragRegion x={100} y={50} width={200} height={80} />
        <WindowNoDrag x={10} y={400} width={64} height={32} />
      </>
    ));
    const all = batches.flat();
    v.expect(all).toContainEqual({ x: 100, y: 50, width: 200, height: 80, drag: true });
    v.expect(all).toContainEqual({ x: 10, y: 400, width: 64, height: 32, drag: false });
    // One batch per layout turn, not one native call per region.
    v.expect(batches.length).toBe(1);
  });

  v.it('coalesce several updates of one turn into one batch', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <>
        <WindowNoDrag x={0} y={0} width={10} height={10} />
        <WindowNoDrag x={20} y={0} width={10} height={10} />
        <WindowNoDrag x={40} y={0} width={10} height={10} />
      </>
    ));
    v.expect(batches.length).toBe(1);
    v.expect(batches[0]).toHaveLength(3);
  });

  v.it('measure a region inside another view with the parent offset', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <view x={30} y={70} width={300} height={200}>
        <WindowDragRegion x={10} y={20} width={100} height={40} />
      </view>
    ));
    v.expect(batches.flat()).toContainEqual({
      x: 40,
      y: 90,
      width: 100,
      height: 40,
      drag: true,
    });
  });

  v.it('publish an empty batch when the region unmounts', async () => {
    const [show, setShow] = createSignal(true);
    await mount(fakeChrome('custom').chrome, () => (
      <Show when={show()}>
        <WindowDragRegion x={0} y={0} width={100} height={40} />
      </Show>
    ));
    v.expect(batches.flat()).toHaveLength(1);
    setShow(false);
    await settle();
    v.expect(batches[batches.length - 1]).toEqual([]);
  });

  v.it('leave the interactive nodes inside a drag region their own press', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <WindowDragRegion x={100} y={50} width={200} height={80}>
        <view x={10} y={5} width={100} height={50} color={0xff0000ff} />
        <view
          x={120}
          y={5}
          width={60}
          height={50}
          role="button"
          onEnter={() => {}}
        />
      </WindowDragRegion>
    ));
    v.expect(batches.flat()).toEqual([
      { x: 100, y: 50, width: 200, height: 80, drag: true },
      // The plain view is not interactive: it drags with the region around
      // it. The control is: it keeps its press, without a WindowNoDrag.
      { x: 220, y: 55, width: 60, height: 50, drag: false },
    ]);
  });

  v.it('publish nothing in native mode', async () => {
    await mount(fakeChrome('native').chrome, () => (
      <WindowDragRegion x={0} y={0} width={100} height={40} />
    ));
    v.expect(batches).toEqual([]);
  });

  v.it('follow a viewport change, not just the initial layout', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <WindowDragRegion
        x={0}
        y={0}
        width={viewport().width}
        height={40}
      />
    ));
    v.expect(batches[batches.length - 1][0]).toMatchObject({
      width: viewport().width,
      drag: true,
    });
    updateViewport({
      width: 800,
      height: 600,
      scale: 1,
      safeArea: zeroInsets,
      keyboardInset: 0,
      reducedMotion: false,
    });
    await settle();
    v.expect(batches[batches.length - 1][0]).toMatchObject({
      width: 800,
      drag: true,
    });
  });
});

v.describe('TitleBar', () => {
  v.it('draws the bar with its drag region and the three controls', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <TitleBar title="Solid" height={40} />
    ));
    const all = batches.flat();
    // The bar's own drag region, then a no-drag area per platform control:
    // the framework's controls are not part of the drag region.
    v.expect(all.filter((region) => region.drag)).toEqual([
      { x: 0, y: 0, width: viewport().width, height: 40, drag: true },
    ]);
    v.expect(all.filter((region) => !region.drag)).toHaveLength(3);
    // The close button is the last control, at the trailing end of the bar.
    const close = all.filter((region) => !region.drag)[2];
    v.expect(close).toEqual({
      x: viewport().width - 36,
      y: 0,
      width: 36,
      height: 40,
      drag: false,
    });
    // A mounted bar is the top inset, both system-bar and safe-area.
    v.expect(viewport().insets.systemBars.top).toBe(40);
    v.expect(viewport().safeArea.top).toBe(40);
  });

  v.it('hide, and remove the inset, when fullscreen arrives as an event', async () => {
    const { chrome, state } = fakeChrome('custom');
    await mount(chrome, () => <TitleBar title="Solid" height={40} />);
    v.expect(viewport().safeArea.top).toBe(40);
    state.fullscreen = true;
    // The state follows events; the test plays the window system's.
    notifyChromeStateChange();
    await settle();
    v.expect(viewport().safeArea.top).toBe(0);
    v.expect(batches[batches.length - 1]).toEqual([]);
    state.fullscreen = false;
    notifyChromeStateChange();
    await settle();
    v.expect(viewport().safeArea.top).toBe(40);
    v.expect(batches[batches.length - 1].length).toBeGreaterThan(0);
  });

  v.it('removes the inset when it unmounts', async () => {
    await mount(fakeChrome('custom').chrome, () => (
      <TitleBar title="Solid" height={40} />
    ));
    v.expect(viewport().safeArea.top).toBe(40);
    stop?.();
    stop = undefined;
    await settle();
    v.expect(viewport().safeArea.top).toBe(0);
  });

  v.it('renders nothing in native mode and warns about the duplicate', async () => {
    const warn = v.vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mount(fakeChrome('native').chrome, () => (
        <TitleBar title="Solid" height={40} />
      ));
      v.expect(lng.rootNode.children.length).toBe(0);
      v.expect(batches).toEqual([]);
      v.expect(viewport().safeArea.top).toBe(0);
      v.expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
