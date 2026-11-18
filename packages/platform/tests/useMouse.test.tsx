import * as v from 'vitest';
import * as lng from '@solid-multiplatform/platform';
import { useMouse } from '../src/primitives/useMouse.js';
import { useFocusManager } from '../src/core/focusManager.js';
import { renderer } from './setup.js';

const dispatchMouseDown = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }),
  );

// A click is a press and a release on the same node.
const dispatchClick = (x: number, y: number) => {
  dispatchMouseDown(x, y);
  window.dispatchEvent(
    new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }),
  );
};

const dispatchMouseMove = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
  );

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

v.describe('useMouse', () => {
  v.test('click invokes onMouseClick on the focused element', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;
    const onClick = v.vi.fn();

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={200}
            width={300}
            height={150}
            onMouseClick={onClick}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    btn.setFocus();
    await wait(20); // setFocus defers via post-mutation scheduler
    v.assert.equal(lng.activeElement(), btn, 'btn is the active element');

    dispatchClick(150, 250);

    v.assert.equal(onClick.mock.calls.length, 1);
    dispose();
  });

  v.test(
    'click walks up to ancestor with onMouseClick when active is a child',
    async () => {
      let app!: lng.ElementNode;
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;
      const onClickParent = v.vi.fn();

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={parent}
              x={50}
              y={50}
              width={400}
              height={400}
              onMouseClick={onClickParent}
            >
              <view ref={child} x={100} y={100} width={50} height={50} />
            </view>
          </view>
        );
        useMouse(app, 5);
        return root;
      });

      await wait(20);
      child.setFocus();
      await wait(20);
      v.assert.equal(lng.activeElement(), child);

      // (75, 75) is inside parent (50–450, 50–450) but outside child (150–200, 150–200)
      dispatchClick(75, 75);

      v.assert.equal(onClickParent.mock.calls.length, 1);
      dispose();
    },
  );

  v.test('mousemove focuses the deepest matching child', async () => {
    let app!: lng.ElementNode;
    let outer!: lng.ElementNode;
    let inner!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={outer}
            x={0}
            y={0}
            width={500}
            height={500}
            onFocus={() => {}}
          >
            <view
              ref={inner}
              x={50}
              y={50}
              width={100}
              height={100}
              onFocus={() => {}}
            />
          </view>
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    dispatchMouseMove(75, 75);
    await wait(80);

    v.assert.equal(lng.activeElement(), inner, 'inner is focused');
    dispose();
  });

  v.test('z-index decides which overlapping sibling wins', async () => {
    let app!: lng.ElementNode;
    let low!: lng.ElementNode;
    let high!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={low}
            x={50}
            y={50}
            width={300}
            height={300}
            zIndex={1}
            onFocus={() => {}}
          />
          <view
            ref={high}
            x={50}
            y={50}
            width={300}
            height={300}
            zIndex={5}
            onFocus={() => {}}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    dispatchMouseMove(100, 100);
    await wait(80);

    v.assert.equal(lng.activeElement(), high, 'higher z-index wins');
    dispose();
  });

  v.test(
    'skipFocus and alpha:0 elements are excluded from hit testing',
    async () => {
      let app!: lng.ElementNode;
      let btn!: lng.ElementNode;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={btn}
              x={50}
              y={50}
              width={200}
              height={200}
              onFocus={() => {}}
            />
            <view
              x={50}
              y={50}
              width={200}
              height={200}
              zIndex={10}
              skipFocus={true}
              onFocus={() => {}}
            />
            <view
              x={50}
              y={50}
              width={200}
              height={200}
              zIndex={20}
              alpha={0}
              onFocus={() => {}}
            />
          </view>
        );
        useMouse(app, 5);
        return root;
      });

      await wait(20);
      dispatchMouseMove(100, 100);
      await wait(80);

      v.assert.equal(
        lng.activeElement(),
        btn,
        'btn is focused; skipFocus/alpha:0 ignored despite higher z',
      );
      dispose();
    },
  );

  v.test(
    'mousemove applies hoverState when customStates option is set',
    async () => {
      let app!: lng.ElementNode;
      let btn!: lng.ElementNode;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={btn}
              x={50}
              y={50}
              width={200}
              height={200}
              $hover={{ color: 0x00ff00ff }}
            />
          </view>
        );
        useMouse(app, 5, {
          customStates: { hoverState: '$hover', pressedState: '$pressed' },
        });
        return root;
      });

      await wait(20);
      dispatchMouseMove(100, 100);
      await wait(80);

      v.assert.ok(btn.states.has('$hover'));
      dispose();
    },
  );

  v.test(
    'moving from element A to element B transfers hoverState',
    async () => {
      let app!: lng.ElementNode;
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={a}
              x={0}
              y={0}
              width={200}
              height={200}
              $hover={{ color: 0xff0000ff }}
            />
            <view
              ref={b}
              x={500}
              y={500}
              width={200}
              height={200}
              $hover={{ color: 0x00ff00ff }}
            />
          </view>
        );
        useMouse(app, 5, {
          customStates: { hoverState: '$hover', pressedState: '$pressed' },
        });
        return root;
      });

      await wait(20);
      dispatchMouseMove(100, 100);
      await wait(80);
      v.assert.ok(a.states.has('$hover'), 'A receives hover');

      dispatchMouseMove(600, 600);
      await wait(80);
      v.assert.notOk(a.states.has('$hover'), 'A loses hover');
      v.assert.ok(b.states.has('$hover'), 'B receives hover');
      dispose();
    },
  );

  v.test(
    'forwardStates: hoverState propagates to ancestor with forwardStates',
    async () => {
      let app!: lng.ElementNode;
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={parent}
              x={0}
              y={0}
              width={500}
              height={500}
              forwardStates={true}
              $hover={{ color: 0x00ff00ff }}
            >
              <view
                ref={child}
                x={50}
                y={50}
                width={100}
                height={100}
                $hover={{ color: 0xff0000ff }}
              />
            </view>
          </view>
        );
        useMouse(app, 5, {
          customStates: { hoverState: '$hover', pressedState: '$pressed' },
        });
        return root;
      });

      await wait(20);
      dispatchMouseMove(75, 75);
      await wait(80);

      v.assert.ok(
        parent.states.has('$hover'),
        'parent receives forwarded hover',
      );
      dispose();
    },
  );

  v.test(
    'precision (deviceLogicalPixelRatio): event coords are scaled to logical bounds',
    async () => {
      let app!: lng.ElementNode;
      let btn!: lng.ElementNode;

      const originalRO = lng.Config.rendererOptions;
      lng.Config.rendererOptions = {
        ...(originalRO as any),
        deviceLogicalPixelRatio: 2,
      } as any;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={btn}
              x={100}
              y={100}
              width={50}
              height={50}
              onFocus={() => {}}
            />
          </view>
        );
        useMouse(app, 5);
        return root;
      });

      await wait(20);
      // Logical (125, 125) is inside btn. At device-pixel-ratio 2, mouse reports (250, 250).
      dispatchMouseMove(250, 250);
      await wait(80);

      v.assert.equal(lng.activeElement(), btn);

      lng.Config.rendererOptions = originalRO;
      dispose();
    },
  );

  v.test('mousedown applies pressedState; click clears it', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={50}
            y={50}
            width={200}
            height={200}
            $hover={{ color: 0x00ff00ff }}
            $pressed={{ color: 0x0000ffff }}
          />
        </view>
      );
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    // mousedown finds elements via hoverState — apply hover first by moving
    dispatchMouseMove(100, 100);
    await wait(80);
    v.assert.ok(btn.states.has('$hover'), 'hover applied first');

    dispatchMouseDown(100, 100);
    v.assert.ok(btn.states.has('$pressed'), 'pressed applied on mousedown');

    dispatchClick(100, 100);
    v.assert.notOk(btn.states.has('$pressed'), 'pressed cleared on click');
    dispose();
  });
});

// A click and a wheel act as keys through the focus manager itself, so they
// do not depend on what the engine's KeyboardEvent constructor honours (LG
// webOS 3.x drops key/keyCode) or on there being a document at all.
v.describe('clicks and wheel steps as keys', () => {
  v.test('a click focuses the element and reaches onEnter', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;
    const onEnter = v.vi.fn();
    const keydown = v.vi.fn();
    document.addEventListener('keydown', keydown);

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={200}
            width={300}
            height={150}
            onEnter={onEnter}
          />
        </view>
      );
      useFocusManager();
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    dispatchClick(150, 250);
    await wait(20);

    v.assert.equal(lng.activeElement(), btn);
    v.assert.equal(onEnter.mock.calls.length, 1);
    const event = onEnter.mock.calls[0]![0] as KeyboardEvent;
    v.assert.equal(event.key, 'Enter');
    v.assert.equal(event.keyCode, 13);
    v.assert.equal(keydown.mock.calls.length, 0, 'no DOM event is made up');

    document.removeEventListener('keydown', keydown);
    dispose();
  });

  v.test('a wheel over nothing scrollable presses Up or Down', async () => {
    let app!: lng.ElementNode;
    let list!: lng.ElementNode;
    const keys: string[] = [];

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={list}
            width={500}
            height={500}
            onUp={(e) => {
              keys.push(e.key);
              return true;
            }}
            onDown={(e) => {
              keys.push(e.key);
              return true;
            }}
          />
        </view>
      );
      useFocusManager();
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    list.setFocus();
    await wait(20);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await wait(300); // one step per quarter second
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));

    v.assert.deepEqual(keys, ['ArrowDown', 'ArrowUp']);
    dispose();
  });
});

v.describe('cursor styles', () => {
  v.test(
    'hovering applies pointer/grab cursors and leaving resets them',
    async () => {
      let app!: lng.ElementNode;
      let button!: lng.ElementNode;
      let surface!: lng.ElementNode;

      const dispose = renderer.render(() => {
        const root = (
          <view ref={app} width={1920} height={1080}>
            <view
              ref={button}
              x={100}
              y={200}
              width={200}
              height={100}
              onMouseClick={() => {}}
            />
            <view
              ref={surface}
              x={500}
              y={200}
              width={200}
              height={100}
              cursorStyle="grab"
            />
          </view>
        );
        useFocusManager();
        useMouse(root, 1);
        return root;
      });

      await wait(20);
      dispatchMouseMove(150, 250);
      await wait(20);
      v.expect(document.documentElement.style.cursor).toBe('pointer');

      dispatchMouseMove(550, 250);
      await wait(20);
      v.expect(document.documentElement.style.cursor).toBe('grab');

      dispatchMouseMove(1500, 900);
      await wait(20);
      v.expect(document.documentElement.style.cursor).toBe('');
      dispose();
    },
  );
});
