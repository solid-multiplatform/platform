// The real gallery app at phone size (mobile family) in a real browser
// engine. A fling carries the Library page to the bottom; afterwards a drag
// from the LOWER part of the screen — outside the page node's own translated
// box, inside the window its content paints across — must still scroll it.
// Regression test for the reported bug: after the momentum reached the
// bottom, the page was stuck until its screen was remounted.
import { expect, test } from 'vitest';
// Phone scene units: the mobile shell (tab bar, phone page layout) turns on
// below 760 wide, as uiFamily() decides it.
const setup = await import('./setup-phone');
import type { ElementNode } from '@solid-multiplatform/platform';
import { rootNode } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { App } from '../../../../apps/gallery/src/App';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const W = 390;
const H = 844;

const mount = () => {
  document.body.innerHTML =
    `<div id="app" style="width:${W}px;height:${H}px"></div>`;
  const surface = document.getElementById('app')!;
  surface.setPointerCapture = () => {};
  surface.releasePointerCapture = () => {};
  const entry = appEntry(App, {}, {});
  const stop = startApp(
    webHost({
      root: surface,
      namespace: 'gallery-phone-fling',
      semantics: false,
    }),
    entry.root,
    entry.options,
  ) as () => void;
  return { surface, stop };
};

/** Every touch scroller on the y axis in tree order (the Library page). */
function pages(): ElementNode[] {
  const found: ElementNode[] = [];
  const walk = (node: ElementNode) => {
    if ((node as { scrollAxis?: string }).scrollAxis === 'y') found.push(node);
    const children = node.children;
    if (!children || typeof children[Symbol.iterator] !== 'function') return;
    for (const child of children) {
      if (typeof child === 'object' && child !== null)
        walk(child as unknown as ElementNode);
    }
  };
  for (const child of rootNode.children)
    walk(child as unknown as ElementNode);
  return found;
}

/** Client coordinates for a scene point, through the fitted canvas. */
function pointerAt(surface: HTMLElement) {
  const canvas = surface.querySelector('canvas')!;
  const box = canvas.getBoundingClientRect();
  return (x: number, y: number) => ({
    clientX: box.left + (x * box.width) / W,
    clientY: box.top + (y * box.height) / H,
  });
}

/** Wait until `read()` reports the same value for `quiet` frames in a row. */
async function waitForStable(read: () => number, quiet = 8) {
  let last = read();
  let still = 0;
  for (let i = 0; i < 600 && still < quiet; i++) {
    await sleep(32);
    const value = read();
    if (value === last) {
      still++;
    } else {
      still = 0;
      last = value;
    }
  }
  if (still < quiet)
    throw new Error('timed out waiting for the page to settle');
  return last;
}

test('a fling to the bottom does not stick the phone page', { timeout: 120000 }, async () => {
  const { surface, stop } = mount();
  try {
    await setup.settle();
    await sleep(300);
    const at = pointerAt(surface);
    const send = (type: string, x: number, y: number) => {
      const point = at(x, y);
      surface.dispatchEvent(
        new PointerEvent(type, {
          ...point,
          pointerId: 1,
          pointerType: 'touch',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    const page = () => pages()[0];
    const yOf = () => (page()?.y as number) || 0;

    // ---- A hard fling down: the page carries to the bottom and settles.
    send('pointerdown', 195, 700);
    for (let y = 640; y >= 80; y -= 60) {
      await sleep(9);
      send('pointermove', 195, y);
    }
    send('pointerup', 195, 80);
    const flung = await waitForStable(yOf);
    expect(-flung).toBeGreaterThan(0);

    // ---- A slow drag from the LOWER screen — below the page node's own
    // translated box, inside its clipping window. Before the fix the press
    // landed on nothing and the page was stuck.
    send('pointerdown', 195, 600);
    for (let i = 1; i <= 6; i++) {
      await sleep(16);
      send('pointermove', 195, 600 + i * 12);
    }
    await sleep(120);
    send('pointerup', 195, 672);
    const afterDrag = await waitForStable(yOf);
    expect(afterDrag).toBeGreaterThan(flung);
    // (No idle-frame assertion here: the real gallery animates its pulse dot
    // while idle, by design.)
  } finally {
    stop();
  }
});
