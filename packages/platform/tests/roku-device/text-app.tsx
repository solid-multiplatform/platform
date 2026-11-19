// Draws the device text test through the platform's JSX path, as an app
// would: fonts loaded with loadFonts, texts as <text>. run-text.mjs installs
// it, takes a screenshot and probes the ink. On the console it reports what
// the platform sees (each text's size and lines), how each font load ended,
// how many timers ran while the scene was idle, and what the device's own
// getFontMeasure() says for a set of strings.
import {
  createElement,
  insertNode,
  setProp,
  tmTransaction,
} from '@roku-sdk/solid';
import { getFontMeasure, whenFontReady } from '@roku-sdk/rsg-ts/runtime';
import { type JSXElement } from 'solid-js';
import {
  createRenderer,
  loadFonts,
  setRendererFactory,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { rokuHost } from '@solid-multiplatform/platform/roku';
import robotoRegular from './fonts/Roboto-Regular.ttf';
import robotoBold from './fonts/Roboto-Bold.ttf';
import ralewayExtraBold from './fonts/Raleway-ExtraBold.ttf';
import onestRegular from './fonts/Onest-Regular.ttf';
import {
  BG,
  GAP,
  INK,
  MARK,
  MEASURED_SIZES,
  MEASURED_STRINGS,
  MISSING,
  ROWS,
  SCREEN,
  TEXTS,
} from './text-cases.mjs';

// Every timer armed from here on, for the idle count. `timeout` is the
// test's own clock and is not counted.
let scheduled = 0;
const timeout = globalThis.setTimeout;
const interval = globalThis.setInterval;
globalThis.setTimeout = ((handler: () => void, ms?: number) => {
  scheduled++;
  return timeout(handler, ms);
}) as typeof globalThis.setTimeout;
globalThis.setInterval = ((handler: () => void, ms?: number) => {
  scheduled++;
  return interval(handler, ms);
}) as typeof globalThis.setInterval;
const sleep = (ms: number) => new Promise<void>((done) => timeout(done, ms));
const log = (line: string) => console.log('TEXT ' + line);

/** The fonts the app registers. The file of the last is not in the package (the runner removes it). */
const FONTS = [
  { fontFamily: 'Roboto', fontUrl: robotoRegular },
  { fontFamily: 'Roboto700', fontUrl: robotoBold },
  { fontFamily: 'Raleway', fontUrl: ralewayExtraBold },
  { fontFamily: MISSING, fontUrl: onestRegular },
];

type Case = { x: number; y: number; text: string; props: Record<string, unknown> };
interface Backend {
  w: number;
  h: number;
  absX: number;
  absY: number;
  layout?: { lines?: { text: string }[] };
}
const nodes: Record<string, ElementNode> = {};
const marks: Record<string, ElementNode> = {};

function label(name: string, c: Case): JSXElement {
  return (
    <text
      ref={(node: ElementNode) => (nodes[name] = node)}
      x={c.x}
      y={c.y}
      color={INK}
      {...c.props}
    >
      {c.text}
    </text>
  );
}

function row(name: string, c: Case): JSXElement {
  return (
    <view x={c.x} y={c.y} display="flex" gap={GAP} height={MARK.h}>
      <text ref={(node: ElementNode) => (nodes[name] = node)} color={INK} {...c.props}>
        {c.text}
      </text>
      <view
        ref={(node: ElementNode) => (marks[name] = node)}
        width={MARK.w}
        height={MARK.h}
        color={MARK.color}
      />
    </view>
  );
}

/** What the platform reads for each text, and where each row's mark went. */
function report() {
  for (const name of Object.keys(nodes)) {
    const node = nodes[name]!;
    const backend = node.lng as unknown as Backend;
    log(
      'NODE ' +
        name +
        ' ' +
        JSON.stringify({
          x: backend.absX,
          y: backend.absY,
          width: node.width,
          height: node.height,
          w: backend.w,
          h: backend.h,
          lines: (backend.layout?.lines ?? []).map((line) => line.text),
        }),
    );
  }
  for (const name of Object.keys(marks))
    log('MARK ' + name + ' ' + (marks[name]!.lng as unknown as Backend).absX);
}

/** The device's own measurements of the packaged fonts, a Font node at a time. */
async function measureOnDevice(root: object) {
  const measure = getFontMeasure();
  for (const [key, uri] of [['regular', robotoRegular], ['bold', robotoBold], ['raleway', ralewayExtraBold]] as const) {
    for (const size of MEASURED_SIZES) {
      const font = createElement('font') as unknown as { r: never };
      // Size before uri: the firmware otherwise first publishes the font at size 1.
      setProp(font as never, 'preUpdate', true as never);
      setProp(font as never, 'size', size as never);
      setProp(font as never, 'uri', uri as never);
      insertNode(root as never, font as never);
      let late = false;
      const stop = timeout(() => (late = true), 2000);
      try {
        await whenFontReady(font.r, { signal: { get aborted() { return late; }, reason: 'timeout' } });
        log(
          `DEVICE ${key} ${size} ${measure.getAscent(font.r)} ${measure.getOneLineHeight(font.r)} ` +
            MEASURED_STRINGS.map((text) => measure.getOneLineWidth(font.r, text, 100000)).join(','),
        );
      } catch (error) {
        log(`DEVICE ${key} ${size} failed ${String(error)}`);
      }
      clearTimeout(stop);
      tmTransaction.removeNode(root as never, font as never);
    }
  }
}

async function run(root: object, loads: Promise<void>[]) {
  await Promise.all(loads);
  // The last flush after the last font settled.
  await sleep(600);
  const before = scheduled;
  await sleep(2000);
  log('IDLE timers=' + (scheduled - before));
  report();
  log('READY');
  // The screenshot is taken now; nothing below changes the screen.
  await sleep(1500);
  await measureOnDevice(root);
  log('DONE');
}

// The test renders each text on its own, so it takes the host's surface and
// renderer and calls createRenderer itself.
rokuHost().launch((context) => {
  setRendererFactory(
    (settings) => context.createRenderer(settings),
    context.loadFonts,
  );
  return mount({ root: context.surface });
});

function mount(host: { root: object }): () => void {
  log('START');
  const started = Date.now();
  // One call per font, to see how each load ends and when.
  const loads = FONTS.map((font) =>
    loadFonts([font]).then(
      () => log(`FONT ${font.fontFamily} loaded ${Date.now() - started}`),
      (error: unknown) =>
        log(`FONT ${font.fontFamily} rejected ${Date.now() - started} ${error instanceof Error ? error.message : String(error)}`),
    ),
  );
  const { render } = createRenderer();
  render(() => <view width={SCREEN.w} height={SCREEN.h} color={BG} />);
  for (const name of Object.keys(TEXTS))
    render(() => label(name, (TEXTS as Record<string, Case>)[name]!));
  for (const name of Object.keys(ROWS))
    render(() => row(name, (ROWS as Record<string, Case>)[name]!));
  run(host.root, loads).catch((error) => log('ERROR ' + String((error as Error)?.stack ?? error)));
  return () => {};
}
