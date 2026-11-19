// The chrome test's app: a scene title bar in `custom` mode, driven from
// outside by real X events (tests/chrome/run.mjs). It prints what the
// runtime reports and the pixels the renderer drew, so the driver can check
// the chrome state, the insets and the hit-test classifications after each
// real drag, click or key.
//
//   READY <json>   once, after the first frame
//   STATE <json>   whenever the window state event says it changed
//   VIEW <json>    whenever the viewport's insets change
//   PROBE <json>   on F9: viewport insets and pixels of the next frame
//   IDLE <json>    in "idle" mode: the counters over three seconds
//   DISPOSED       from the app's cleanup
import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { Config, getRenderer } from '@solid-multiplatform/platform';
import { Screen } from '@solid-multiplatform/platform/app';
import { TitleBar, WindowDragRegion, WindowNoDrag } from '@solid-multiplatform/platform/primitives';
import { startApp, type HostContext } from '@solid-multiplatform/platform/host';
import { onChromeStateChange } from '@solid-multiplatform/platform/chrome';
import { viewport } from '@solid-multiplatform/platform/viewport';
import type { RendererMain } from '@solid-multiplatform/renderer';
import {
  desktopHost,
  DesktopPlatform,
  type DesktopSurface,
} from '@solid-multiplatform/host-desktop';

const BAR = 40;
const CONTENT = 0x336699ff;
const ACCENT = 0xffcc00ff;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** RGBA at points of the next frame, x and y from the top left in pixels. */
function pixels(points: [number, number][]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    const stage = getRenderer() as RendererMain;
    const read = (): void => {
      stage.off('idle', read);
      try {
        const canvas = stage.canvas;
        const gl = canvas.getContext('webgl') as WebGLRenderingContext;
        resolve(
          points.map(([x, y]) => {
            const rgba = new Uint8Array(4);
            gl.readPixels(
              x,
              canvas.height - 1 - y,
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              rgba,
            );
            return Array.from(rgba);
          }),
        );
      } catch (error) {
        reject(error as Error);
      }
    };
    stage.on('idle', read);
    stage.requestRender();
  });
}

let announce: () => void = () => {};

function App(props: { context: HostContext<DesktopSurface> }): unknown {
  const context = props.context;
  const chrome = context.chrome!;
  const mode = chrome.mode;
  let pressed = 0;
  const points: [number, number][] = [
    [2, 2],
    [2, BAR + 2],
    [400, 200],
  ];
  let ready = false;

  const hit = (): Record<string, string> => {
    const query = (x: number, y: number): string => __solid.test!.hitTest(x, y);
    const v = viewport();
    return {
      bar: query(100, 20),
      titleEdge: query(2, 2),
      content: query(500, 250),
      nested: query(200, BAR + 110),
      nestedControl: query(260, BAR + 130),
      // A framework control: interactive, so the drag region around it
      // leaves it a press of its own without an explicit WindowNoDrag.
      interactive: query(370, BAR + 130),
      maximize: query(v.width - 54, 20),
      close: query(v.width - 18, 20),
      leftEdge: query(2, Math.round(v.height / 2)),
    };
  };

  const report = async (kind: 'READY' | 'PROBE'): Promise<void> => {
    const v = viewport();
    const drawn = await pixels(points);
    console.log(
      `${kind} ` +
        JSON.stringify({
          mode: chrome.mode,
          os: chrome.os,
          hitTestInstalled: chrome.hitTestInstalled,
          state: chrome.state(),
          viewport: {
            width: v.width,
            height: v.height,
            safeAreaTop: v.safeArea.top,
            systemBarTop: v.insets.systemBars.top,
          },
          pixels: drawn,
          pressed,
          hit: __solid.test === undefined ? undefined : hit(),
        }),
    );
  };
  announce = () => {
    ready = true;
    void report('READY');
  };

  onMount(() => {
    onCleanup(onChromeStateChange(() => {
      if (ready) console.log('STATE ' + JSON.stringify(chrome.state()));
    }));
    onCleanup(() => console.log('DISPOSED'));
    const keys = context.keys as unknown as EventTarget;
    const key = (event: Event): void => {
      const pressed = event as KeyboardEvent;
      if (pressed.key === 'F6' || pressed.key === 'F7') {
        // F7 maximizes, F6 restores, from wherever the window is: the
        // driver's button click may have toggled it once or (a doubled X
        // delivery) twice, and these two must land on a known state.
        const want = pressed.key === 'F7';
        if (chrome.state().maximized !== want) chrome.toggleMaximized();
      } else if (pressed.key === 'F8') {
        chrome.setFullscreen(!chrome.state().fullscreen);
      } else if (pressed.key === 'F9') {
        void report('PROBE');
      }
    };
    keys.addEventListener('keydown', key);
    onCleanup(() => keys.removeEventListener('keydown', key));
  });

  createEffect(() => {
    const v = viewport();
    if (!ready) return;
    console.log(
      'VIEW ' +
        JSON.stringify({
          width: v.width,
          height: v.height,
          safeAreaTop: v.safeArea.top,
          systemBarTop: v.insets.systemBars.top,
        }),
    );
  });

  return (
    <>
      <Screen padding={0}>
        <view
          x={0}
          y={0}
          width={viewport().width}
          height={viewport().height}
          color={CONTENT}
        />
        <view x={20} y={20} width={80} height={40} color={ACCENT} />
      </Screen>
      <Show when={mode !== 'native'}>
        <TitleBar title="Solid chrome test" height={BAR} />
        {/* A drag region with an explicit no-drag control and a framework
            control: the interactive node wins without being wrapped. */}
        <WindowDragRegion x={200} y={BAR + 100} width={260} height={60}>
          <WindowNoDrag x={10} y={5} width={100} height={50}>
            <view width={100} height={50} color={CONTENT} />
          </WindowNoDrag>
          <view
            x={130}
            y={8}
            width={80}
            height={44}
            role="button"
            ariaLabel="A control inside the drag region"
            onEnter={() => {
              pressed++;
            }}
          >
            <view width={80} height={44} color={ACCENT} />
          </view>
        </WindowDragRegion>
      </Show>
    </>
  );
}

async function run(): Promise<void> {
  Config.fontSettings = { fontFamily: 'Lato', fontSize: 32 };
  const setup = (await new DesktopPlatform().fetch(
    'setup.json',
    'json',
  )) as { idleMs: number };
  const idle = __solid.args.includes('idle');
  startApp(
    desktopHost({ id: 'solid.test.chrome', title: 'Solid chrome test' }),
    (context) => <App context={context} />,
    {
      fonts: [
        {
          type: 'msdf',
          fontFamily: 'Lato',
          atlasDataUrl: 'fonts/Lato-Regular.msdf.json',
          atlasUrl: 'fonts/Lato-Regular.msdf.png',
        },
      ] as never,
    },
  );
  if (idle) {
    await sleep(800);
    const before = __solid.stats();
    await sleep(setup.idleMs);
    const after = __solid.stats();
    console.log(
      'IDLE ' +
        JSON.stringify({
          ms: setup.idleMs,
          wakeups: after.wakeups - before.wakeups,
          frames: after.frames - before.frames,
          presents: after.presents - before.presents,
        }),
    );
    __solid.exit(0);
  } else {
    // Room to drag and resize on a 1280 x 720 screen.
    __solid.window?.setSize(800, 500);
    for (let waited = 0; waited < 4000; waited += 50) {
      if (viewport().width === 800 && viewport().height === 500) break;
      await sleep(50);
    }
    await sleep(300);
    announce();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  __solid.exit(1);
});
