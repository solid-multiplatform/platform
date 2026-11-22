// The touch scroller's gesture survival: a layout pass while the finger is
// down (or while a fling is in flight) must not kill the gesture; a press
// that lands on a flying scroller catches it; and a scroller claims its own
// content's region, not its whole clipping window, so a sibling sharing that
// window stays reachable.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import {
  Column,
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/primitives';
import { createScenePointer, type ScenePointer } from '../src/sdk/input.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const keys = new EventTarget();

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
  return last;
}

interface Mounted {
  column: lng.ElementNode;
  container: lng.ElementNode;
  app: lng.ElementNode;
  pointer: ScenePointer;
  dispose(): void;
  /** A child mount: what a growing feed does mid-gesture. */
  appendRow(): void;
}

async function mount(): Promise<Mounted> {
  let column!: lng.ElementNode;
  let container!: lng.ElementNode;
  let app!: lng.ElementNode;
  let pointer!: ScenePointer;
  const rows: lng.ElementNode[] = [];
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    const tree = (
      <view ref={app} width={1920} height={1080}>
        <view width={400} height={300} clipping>
          <Column
            ref={column}
            scroll="touch"
            gap={0}
            width={400}
            height={300}
          >
            {Array.from({ length: 9 }, () => (
              <view width={400} height={100} />
            ))}
            <view ref={container} width={400} height={100} />
            {Array.from({ length: 2 }, () => (
              <view width={400} height={100} />
            ))}
          </Column>
        </view>
      </view>
    );
    pointer = createScenePointer(app);
    rows.push(container);
    return tree;
  }) as unknown as () => void;
  await settle();
  return {
    column,
    container,
    app,
    pointer,
    dispose() {
      pointer.dispose();
      dispose();
    },
    appendRow() {
      const row = lng.createElement('view');
      row.width = 400;
      row.height = 100;
      column.insertChild(row, column.children.length);
    },
  };
}

v.describe('gesture survival in the touch scroller', () => {
  v.beforeEach(() => lng.setCapabilities('android'));
  v.afterEach(() => lng.resetCapabilities());

  v.test(
    'children mounting mid-drag do not freeze the drag',
    { timeout: 20000 },
    async () => {
      const m = await mount();
      try {
        m.pointer.down(1, { x: 100, y: 260 });
        m.pointer.move(1, { x: 100, y: 230 });
        m.pointer.move(1, { x: 100, y: 200 });
        const before = m.column.y;
        v.expect(before).toBeLessThan(0);

        // The next page of rows resolves and mounts mid-drag.
        m.appendRow();
        await settle();

        // The finger keeps moving: the page must keep following it.
        m.pointer.move(1, { x: 100, y: 170 });
        m.pointer.move(1, { x: 100, y: 140 });
        v.expect(m.column.y).toBeLessThan(before - 25);
        m.pointer.up(1, { x: 100, y: 140 });
        await waitStable(() => m.column.y || 0);
      } finally {
        m.dispose();
      }
    },
  );

  v.test(
    'children mounting mid-fling do not kill the fling',
    { timeout: 20000 },
    async () => {
      const m = await mount();
      try {
        // Fling down.
        m.pointer.down(1, { x: 100, y: 260 });
        for (let y = 240; y >= 20; y -= 60) {
          m.pointer.move(1, { x: 100, y });
          await pause(16);
        }
        m.pointer.up(1, { x: 100, y: 20 });
        await pause(60);
        const inFlight = m.column.y || 0;
        v.expect(inFlight).toBeLessThan(-50);

        // Rows mount while the flight runs: it must continue moving.
        m.appendRow();
        m.appendRow();
        await settle();
        await pause(120);
        v.expect(m.column.y || 0).toBeLessThan(inFlight - 30);
        await waitStable(() => m.column.y || 0);
      } finally {
        m.dispose();
      }
    },
  );

  v.test(
    'a press that lands on a flying scroller catches it',
    { timeout: 20000 },
    async () => {
      const m = await mount();
      try {
        // Fling down hard.
        m.pointer.down(1, { x: 100, y: 260 });
        for (let y = 240; y >= 20; y -= 60) {
          m.pointer.move(1, { x: 100, y });
          await pause(16);
        }
        m.pointer.up(1, { x: 100, y: 20 });

        // A fresh finger lands and holds still, the way a stop gesture
        // does: the flight must freeze under it, not run on to settle.
        await pause(80);
        v.expect(m.pointer.down(2, { x: 150, y: 150 })).toBe(true);
        const caught = m.column.y || 0;
        await pause(400);
        v.expect(m.column.y || 0).toBe(caught);
        m.pointer.up(2, { x: 150, y: 150 });
        await waitStable(() => m.column.y || 0);
      } finally {
        m.dispose();
      }
    },
  );

  v.test(
    'two scrollers in one window each claim their own half',
    { timeout: 20000 },
    async () => {
      let left!: lng.ElementNode;
      let right!: lng.ElementNode;
      let app!: lng.ElementNode;
      let pointer!: ScenePointer;
      const dispose = renderer.render(() => {
        useFocusManager(undefined, keys as unknown as KeyEventTarget);
        const tree = (
          <view ref={app} width={1920} height={1080}>
            <view width={400} height={300} clipping>
              <Column
                ref={left}
                x={0}
                scroll="touch"
                gap={0}
                width={200}
                height={300}
              >
                {Array.from({ length: 12 }, () => (
                  <view width={200} height={100} />
                ))}
              </Column>
              <Column
                ref={right}
                x={200}
                scroll="touch"
                gap={0}
                width={200}
                height={300}
              >
                {Array.from({ length: 12 }, () => (
                  <view width={200} height={100} />
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
        // Drag on the LEFT half: the left column scrolls; the right one,
        // probed first because it is the later sibling, must not claim the
        // point (the whole window once was its claim).
        pointer.down(1, { x: 60, y: 250 });
        pointer.move(1, { x: 60, y: 220 });
        pointer.move(1, { x: 60, y: 190 });
        v.expect(left.y).toBeLessThan(-20);
        v.expect(right.y).toBe(0);
        pointer.up(1, { x: 60, y: 190 });
        await waitStable(() => left.y || 0);

        // And the right half scrolls the right column.
        pointer.down(1, { x: 340, y: 250 });
        pointer.move(1, { x: 340, y: 220 });
        pointer.move(1, { x: 340, y: 190 });
        v.expect(right.y).toBeLessThan(-20);
        pointer.up(1, { x: 340, y: 190 });
        await waitStable(() => right.y || 0);
      } finally {
        pointer.dispose();
        dispose();
      }
    },
  );
});
