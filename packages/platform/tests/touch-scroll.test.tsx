// `scroll="touch"` on the layout primitives: a real scene pointer drag moves
// the view, a horizontal rail inside a vertical page claims only horizontal
// drags, and a vertical drag that starts on the rail moves the page.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import {
  Column,
  Row,
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/primitives';
import { createScenePointer, type ScenePointer } from '../src/sdk/input.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const keys = new EventTarget();

/** Wait until the scene stops writing `read()`, so no fixed-duration guess. */
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

interface Mounted {
  row: lng.ElementNode;
  column: lng.ElementNode;
  pointer: ScenePointer;
  dispose(): void;
}

async function mount(): Promise<Mounted> {
  let row!: lng.ElementNode;
  let column!: lng.ElementNode;
  let app!: lng.ElementNode;
  let pointer!: ScenePointer;
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    const tree = (
      <view ref={app} width={1920} height={1080}>
        {/* The page's viewport. */}
        <view width={400} height={300} clipping>
          <Column ref={column} scroll="touch" gap={0} width={400}>
            <view width={400} height={100} />
            {/* The rail's viewport, inside the page. */}
            <view width={400} height={120} clipping>
              <Row ref={row} scroll="touch" gap={0} autofocus>
                {Array.from({ length: 10 }, () => (
                  <view width={150} height={120} />
                ))}
              </Row>
            </view>
            <view width={400} height={100} />
            <view width={400} height={100} />
          </Column>
        </view>
      </view>
    );
    pointer = createScenePointer(app);
    return tree;
  }) as unknown as () => void;
  await settle();
  return {
    row,
    column,
    pointer,
    dispose() {
      pointer.dispose();
      dispose();
    },
  };
}

v.describe('touch scrolling on Row and Column', () => {
  v.test('a horizontal drag moves a rail and snaps to its slot', async () => {
    const m = await mount();
    try {
      // Start on the rail, move left by 60 scene units.
      m.pointer.down(1, { x: 300, y: 150 });
      m.pointer.move(1, { x: 240, y: 150 });
      // `start` is at the first move past the slop; the next move is the
      // drag. The rail follows the pointer, the page does not move.
      m.pointer.move(1, { x: 200, y: 150 });
      v.expect(m.row.x).toBeLessThan(-30);
      v.expect(m.column.y || 0).toBe(0);

      // Release still: a horizontal Row snaps to item + gap (150 here).
      await pause(120);
      m.pointer.move(1, { x: 200, y: 150 });
      m.pointer.up(1, { x: 200, y: 150 });
      await waitStable(() => m.row.x);
      v.expect(m.row.x % 150).toBe(0);
    } finally {
      m.dispose();
    }
  });

  v.test(
    'a vertical drag that starts on a rail scrolls the page, not the rail',
    async () => {
      const m = await mount();
      try {
        // Down on the rail, then up: the dominant axis is vertical, so the
        // vertical Column (an ancestor) claims the gesture.
        m.pointer.down(1, { x: 60, y: 180 });
        m.pointer.move(1, { x: 62, y: 150 });
        m.pointer.move(1, { x: 62, y: 120 });
        v.expect(m.column.y).toBeLessThan(-20);
        v.expect(m.row.x || 0).toBe(0);

        await pause(120);
        m.pointer.move(1, { x: 62, y: 120 });
        m.pointer.up(1, { x: 62, y: 120 });
      } finally {
        m.dispose();
      }
    },
  );

  v.test('a vertical drag on the page scrolls the Column', async () => {
    const m = await mount();
    try {
      // Start below the rail, on the page itself.
      m.pointer.down(1, { x: 100, y: 260 });
      m.pointer.move(1, { x: 100, y: 230 });
      m.pointer.move(1, { x: 100, y: 200 });
      v.expect(m.column.y).toBeLessThan(-20);
      await pause(120);
      m.pointer.move(1, { x: 100, y: 200 });
      m.pointer.up(1, { x: 100, y: 200 });
    } finally {
      m.dispose();
    }
  });

  v.test('focus keys scroll the same rail, only as far as needed', async () => {
    const m = await mount();
    try {
      await settle();
      // Six Rights: item 6 is at content x 900..1050, the viewport is 400.
      for (let i = 0; i < 6; i++) {
        keys.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        await settle();
      }
      await waitStable(() => m.row.x);
      v.expect(m.row.selected).toBe(6);
      v.expect(-m.row.x).toBeCloseTo(6 * 150 + 150 - 400, 0);
    } finally {
      m.dispose();
    }
  });

  v.test('a television keeps focus scrolling', async () => {
    // webOS reports a mouse, but it is a television: the focus model stays,
    // and `scroll="touch"` binds nothing.
    lng.setCapabilities('webos');
    const m = await mount();
    try {
      v.expect(m.row.onPointerDrag).toBeUndefined();
      v.expect(m.column.onPointerDrag).toBeUndefined();
    } finally {
      m.dispose();
      lng.resetCapabilities();
    }
  });
});
