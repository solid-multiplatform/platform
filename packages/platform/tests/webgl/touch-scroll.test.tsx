// A `Row scroll="touch"` in a real browser engine: pointer events go through
// the web host's pointer sink, the rail follows the drag, the release flings,
// the rail snaps to item + gap, and a settled rail requests no more frames.
import { expect, test } from 'vitest';
import type { ElementNode } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { Row } from '@solid-multiplatform/platform/primitives';
import { frameCount, settle } from './setup';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const ITEM = 180;
const GAP = 20;
const VIEWPORT = 580;
const MAX = 12 * ITEM + 11 * GAP - VIEWPORT; // 1800, a multiple of the slot

const mount = () => {
  document.body.innerHTML =
    '<div id="app" style="width:1920px;height:1080px"></div>';
  const surface = document.getElementById('app')!;
  // A synthetic PointerEvent has no active pointer to capture; the host's
  // capture call is a no-op here and the surface keeps receiving the moves.
  surface.setPointerCapture = () => {};
  surface.releasePointerCapture = () => {};
  let row!: ElementNode;
  const stop = startApp(
    webHost({
      root: surface,
      namespace: 'touch-scroll-test',
      semantics: false,
    }),
    () => (
      <view width={1920} height={1080}>
        <view width={VIEWPORT} height={200} clipping>
          <Row
            ref={(node: ElementNode) => {
              row = node;
            }}
            scroll="touch"
            gap={GAP}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <view
                width={ITEM}
                height={200}
                color={i % 2 === 0 ? 0x243145ff : 0x385f92ff}
              />
            ))}
          </Row>
        </view>
      </view>
    ),
    {},
  ) as () => void;
  return { surface, row, stop };
};

/** Client coordinates for a scene point, through the fitted canvas. */
function pointerAt(surface: HTMLElement) {
  const canvas = surface.querySelector('canvas')!;
  const box = canvas.getBoundingClientRect();
  return (x: number, y: number) => ({
    clientX: box.left + (x * box.width) / 1920,
    clientY: box.top + (y * box.height) / 1080,
  });
}

/** Wait until `read()` reports the same value for `quiet` frames in a row. */
async function waitForStable(read: () => number, quiet = 8) {
  let last = read();
  let still = 0;
  for (let i = 0; i < 400 && still < quiet; i++) {
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
    throw new Error('timed out waiting for the rail to settle');
}

test('a mouse drag flings a Row, snaps it and stops', async () => {
  const { surface, row, stop } = mount();
  try {
    await settle();
    const at = pointerAt(surface);
    // Keep the scene point in the source object so the events read naturally.
    const send = (type: string, x: number, y: number) => {
      const point = at(x, y);
      surface.dispatchEvent(
        new PointerEvent(type, {
          ...point,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    // Drag left from x=500 to x=100 over about 100 ms: a real fling.
    send('pointerdown', 500, 100);
    for (let x = 470; x >= 100; x -= 30) {
      await sleep(9);
      send('pointermove', x, 100);
    }
    // The rail followed the pointer.
    const dragged = -row.x;
    expect(dragged).toBeGreaterThan(300);
    // The page/row itself is clipped, so the drag reached the rail.
    send('pointerup', 100, 100);

    // The horizontal Row snaps to item + gap. Wait for the engine to rest
    // (it writes the exact slot on its last frame), then for the renderer to
    // go quiet.
    await waitForStable(() => row.x);
    await settle();

    const settled = -row.x;
    // A fling carried it past where the finger released, and the snap put it
    // on a slot. How far the fling travels depends on the engine's event
    // timing; the bound is `max`.
    expect(settled).toBeGreaterThan(dragged + 50);
    expect(settled).toBeLessThanOrEqual(MAX + 0.5);
    const slot = ITEM + GAP;
    const nearest = Math.round(settled / slot) * slot;
    expect(Math.abs(settled - nearest)).toBeLessThan(0.05);

    // Frames zero after settle: the engine, not just the renderer, rested.
    const before = frameCount();
    await sleep(600);
    expect(frameCount()).toBe(before);
  } finally {
    stop();
  }
});
