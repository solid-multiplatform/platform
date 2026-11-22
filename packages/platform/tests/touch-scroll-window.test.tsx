// `scroll="touch"`: after the page has been carried down, its own box sits
// part way up the screen while its content paints across the clipping
// ancestor's window. A press in that window — even below the node's own box
// — must still reach the scroller. Regression test for the reported bug:
// after a fling reached the bottom, no drag could move the page until the
// screen was remounted.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { Column, useFocusManager, type KeyEventTarget } from '@solid-multiplatform/platform/primitives';
import { createScenePointer, type ScenePointer } from '../src/sdk/input.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const keys = new EventTarget();

/** Wait until `read()` reports the same value for a few reads in a row. */
async function waitStable(read: () => number) {
  let last = read();
  let quiet = 0;
  for (let i = 0; i < 200 && quiet < 4; i++) {
    await pause(30);
    const value = read();
    if (value === last) {
      quiet++;
    } else {
      quiet = 0;
      last = value;
    }
  }
  if (quiet < 4) throw new Error('the scroller never settled');
}

v.describe('the touch scroller hit window', () => {
  v.beforeEach(() => lng.setCapabilities('android'));
  v.afterEach(() => lng.resetCapabilities());

  v.test('a scrolled page is still hittable below its own box', async () => {
    let column!: lng.ElementNode;
    let app!: lng.ElementNode;
    let pointer!: ScenePointer;
    const dispose = renderer.render(() => {
      useFocusManager(undefined, keys as unknown as KeyEventTarget);
      const tree = (
        <view ref={app} width={1920} height={1080}>
          {/* The page's viewport: 300 tall, the content ten times that. */}
          <view width={400} height={300} clipping>
            <Column
              ref={column}
              scroll="touch"
              gap={0}
              width={400}
              height={300}
            >
              {Array.from({ length: 10 }, () => (
                <view width={400} height={100} />
              ))}
            </Column>
          </view>
        </view>
      );
      pointer = createScenePointer(app);
      return tree;
    }) as unknown as () => void;

    try {
      await settle();
      // Before any scroll the page fills the window: a press low in it
      // lands on the page.
      v.expect(pointer.down(1, { x: 200, y: 250 })).toBe(true);
      pointer.up(1, { x: 200, y: 250 });

      // Carry the page down by 250 units and let the release fling settle:
      // the Column's own box moves up with the content, far past the point
      // used below.
      pointer.down(1, { x: 200, y: 260 });
      for (let y = 240; y >= 10; y -= 50) {
        pointer.move(1, { x: 200, y });
        await pause(16);
      }
      await pause(120);
      pointer.up(1, { x: 200, y: 10 });
      await waitStable(() => column.y || 0);
      const settled = column.y || 0;
      v.expect(settled).toBeLessThan(-200);

      // A press at y 150 is below the Column's own box but inside the
      // window its content paints across. Before the fix the hit test found
      // nothing there: no press, no drag — the page was stuck until it was
      // remounted.
      v.expect(pointer.down(1, { x: 200, y: 150 })).toBe(true);

      // That press must scroll: drag the page back toward the top.
      pointer.move(1, { x: 200, y: 170 });
      pointer.move(1, { x: 200, y: 210 });
      v.expect(column.y).toBeGreaterThan(settled);
      pointer.up(1, { x: 200, y: 210 });
    } finally {
      pointer.dispose();
      dispose();
    }
  });
});
