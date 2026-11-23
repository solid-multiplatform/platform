// The real gallery at phone size: fling the second rail to its end and read
// the frame's pixels in that band — a rail at a deep offset must still be
// drawn. (The scaffold vendored a four-day-old renderer archive, so the
// renderer's cull fix was missing from shipped APKs while every test in
// tree passed; this guards the shape the synthetic cull test cannot: the
// gallery's explicit-width Row inside its clipping shelf.)
import { expect, test } from 'vitest';
const setup = await import('./setup-phone');
import * as lng from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { App } from '../../../../apps/gallery/src/App';

// Keep the drawing buffer readable, like the other pixel tests.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  type: string,
  attributes?: Record<string, unknown>,
) {
  return getContext.call(
    this,
    type,
    type.startsWith('webgl')
      ? { ...attributes, preserveDrawingBuffer: true }
      : attributes,
  );
} as typeof getContext;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('a rail at its end stays drawn', { timeout: 60000 }, async () => {
  document.body.innerHTML =
    '<div id="app" style="width:390px;height:844px"></div>';
  const surface = document.getElementById('app')!;
  surface.setPointerCapture = () => {};
  surface.releasePointerCapture = () => {};
  const entry = appEntry(App, {}, {});
  const stop = startApp(
    webHost({ root: surface, namespace: 'rail-deep', semantics: false }),
    entry.root,
    entry.options,
  ) as () => void;
  await setup.settle();
  await sleep(300);

  // Every horizontal touch scroller, in tree order.
  const rails: lng.ElementNode[] = [];
  const walk = (node: lng.ElementNode) => {
    if ((node as { scrollAxis?: string }).scrollAxis === 'x') rails.push(node);
    for (const child of (node.children ?? []) as lng.ElementNode[]) {
      if (typeof child === 'object' && child !== null) walk(child);
    }
  };
  for (const child of lng.rootNode.children as lng.ElementNode[]) walk(child);
  expect(rails.length).toBeGreaterThanOrEqual(2);
  const rail = rails[1]!;
  const y = ((rail.absY as number) || 0) + ((rail.height as number) || 0) / 2;

  const at = (x: number, yc: number) => ({ x, y: yc });
  const canvas = surface.querySelector('canvas')!;
  const box = canvas.getBoundingClientRect();
  const client = (x: number, yc: number) => ({
    clientX: box.left + (x * box.width) / 390,
    clientY: box.top + (yc * box.height) / 844,
  });
  const send = (type: string, pt: { x: number; y: number }) => {
    surface.dispatchEvent(
      new PointerEvent(type, {
        ...client(pt.x, pt.y),
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  // Fling the rail far to its end.
  const start = at(320, y);
  send('pointerdown', start);
  for (let dx = 40; dx <= 320; dx += 40) {
    await sleep(9);
    send('pointermove', at(320 - dx, y));
  }
  send('pointerup', at(0, y));
  await sleep(900);

  // Read pixels in the rail's band.
  const gl = (canvas.getContext('webgl2') ??
    canvas.getContext('webgl')) as WebGLRenderingContext;
  const scale = canvas.width / 390;
  const band = { top: Math.max(0, y - 40), bottom: Math.min(844, y + 40) };
  let lit = 0;
  let total = 0;
  for (let sy = band.top; sy < band.bottom; sy += 6) {
    for (let sx = 20; sx < 370; sx += 6) {
      const out = new Uint8Array(4);
      gl.readPixels(
        Math.round(sx * scale),
        canvas.height - 1 - Math.round(sy * scale),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      total++;
      if (out[0]! + out[1]! + out[2]! > 90) lit++;
    }
  }
  expect(lit / total).toBeGreaterThan(0.1);
  stop();
});
