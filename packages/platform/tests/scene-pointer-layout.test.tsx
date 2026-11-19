// A pointer press that arrives before a flex container has placed its
// children. Flex waits for its text children to be measured, which a real
// renderer does in a frame: until then every row is at the container's
// origin, and a click on the first row used to activate the last one.
import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { createScenePointer } from '../src/sdk/input.js';
import { renderer } from './setup.js';

const microtask = () => Promise.resolve();
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

v.test('a click before flex layout hits no row; after it, the row under the point', async () => {
  const entered: string[] = [];
  let app!: lng.ElementNode;
  let column!: lng.ElementNode;
  let label!: lng.ElementNode;
  let pointer!: ReturnType<typeof createScenePointer>;
  const row = (name: string) => (
    <view
      width={200}
      height={40}
      onMouseClick={() => {
        entered.push(name);
      }}
    />
  );
  const dispose = renderer.render(() => {
    const view = (
      <view ref={app} width={400} height={400}>
        <view
          ref={column}
          width={400}
          height={400}
          display="flex"
          flexDirection="column"
          gap={10}
        >
          {row('first')}
          {row('second')}
          {row('third')}
          <text ref={label} skipFocus>
            A line whose size is known once it has been measured
          </text>
        </view>
      </view>
    );
    pointer = createScenePointer(app);
    return view;
  });
  const click = (x: number, y: number) => {
    pointer.down(1, { x, y });
    pointer.up(1, { x, y });
  };
  const rows = () =>
    column.children.slice(0, 3).map((child) => (child as lng.ElementNode).y);

  // As a host without synchronous text metrics leaves it: unmeasured.
  label.width = 0;
  label.height = 0;

  // The same tick as the mount, and after the layout microtask: the text is
  // unmeasured, so nothing is placed and nothing may be hit.
  click(20, 20);
  await microtask();
  click(20, 20);
  await task();
  click(20, 20);
  v.expect(rows()).toEqual([0, 0, 0]);
  v.expect(entered).toEqual([]);

  // The text is measured: the column lays out, and each row is where it is.
  label.width = 300;
  label.height = 24;
  column.updateLayout();
  v.expect(rows()).toEqual([0, 50, 100]);
  click(20, 20);
  click(20, 70);
  click(20, 120);
  v.expect(entered).toEqual(['first', 'second', 'third']);

  pointer.dispose();
  dispose();
});
