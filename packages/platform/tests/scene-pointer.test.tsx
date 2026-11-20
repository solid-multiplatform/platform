// The scene's one pointer path: a host pushes down/move/up/wheel in scene
// coordinates and the framework finds the node and recognises the gesture.
// Every test drives a real ElementNode tree through a fake host pointer
// source; nothing is registered by the "app".
import * as v from 'vitest';
import type { JSX } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  pushFocusTrap,
  useFocusManager,
} from '@solid-multiplatform/platform/focusManager';
import {
  createInputScope,
  createScenePointer,
  type PointerSink,
  type PointerSource,
  type ScenePointer,
  type ScenePointerOptions,
} from '../src/sdk/input.js';
import { dragToScroll, scrollAxis, wheelToScroll } from '../src/sdk/scroll.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

/** A host's pointer: it only knows where the pointer is. */
class FakePointerHost implements PointerSource {
  sink: PointerSink | undefined;
  cursor = v.vi.fn<(style: string | undefined) => void>();
  connect(sink: PointerSink) {
    this.sink = sink;
    return () => {
      this.sink = undefined;
    };
  }
  setCursor(style: string | undefined) {
    this.cursor(style);
  }
  down(x: number, y: number, id = 1) {
    return this.sink!.down(id, { x, y });
  }
  move(x: number, y: number, id = 1) {
    this.sink!.move(id, { x, y });
  }
  up(x: number, y: number, id = 1) {
    this.sink!.up(id, { x, y });
  }
  click(x: number, y: number) {
    this.down(x, y);
    this.up(x, y);
  }
  wheel(x: number, y: number, dx: number, dy: number) {
    return this.sink!.wheel({ x, y }, dx, dy);
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Mounted {
  app: lng.ElementNode;
  host: FakePointerHost;
  pointer: ScenePointer;
  dispose(): void;
}

/** Renders `view` in a 1920x1080 root and connects a fake host's pointer to it. */
async function mount(
  view: () => JSX.Element,
  options: ScenePointerOptions = {},
): Promise<Mounted> {
  let app!: lng.ElementNode;
  let pointer!: ScenePointer;
  const host = new FakePointerHost();
  const dispose = renderer.render(() => {
    useFocusManager(undefined, new KeyTarget());
    const root = (
      <view ref={app} width={1920} height={1080}>
        {view()}
      </view>
    );
    pointer = createScenePointer(app, {
      ...options,
      cursor: (style) => host.setCursor(style),
    });
    host.connect(pointer);
    return root;
  }) as unknown as () => void;
  await settle();
  return {
    app,
    host,
    pointer,
    dispose() {
      pointer.dispose();
      dispose();
    },
  };
}

v.describe('hover, press and click', () => {
  v.test(
    'hover and pressed states follow the pointer with nothing registered',
    async () => {
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const m = await mount(() => (
        <>
          <view
            ref={a}
            x={100}
            y={100}
            width={200}
            height={100}
            onEnter={() => {}}
          />
          <view
            ref={b}
            x={400}
            y={100}
            width={200}
            height={100}
            onEnter={() => {}}
          />
        </>
      ));

      m.host.move(150, 150);
      v.expect(a.states.has('$hover')).toBe(true);
      m.host.move(450, 150);
      v.expect(a.states.has('$hover')).toBe(false);
      v.expect(b.states.has('$hover')).toBe(true);

      v.expect(m.host.down(450, 150)).toBe(true);
      v.expect(b.states.has('$pressed')).toBe(true);
      m.host.up(450, 150);
      v.expect(b.states.has('$pressed')).toBe(false);

      // Nothing there: no hover, and the press lands on nothing.
      m.host.move(900, 900);
      v.expect(b.states.has('$hover')).toBe(false);
      v.expect(m.host.down(900, 900)).toBe(false);

      m.host.move(150, 150);
      m.host.sink!.leave();
      v.expect(a.states.has('$hover')).toBe(false);
      m.dispose();
    },
  );

  v.test(
    'a click focuses the node, then presses Enter on it as a remote would',
    async () => {
      let first!: lng.ElementNode;
      let second!: lng.ElementNode;
      const order: string[] = [];
      const m = await mount(() => (
        <view onEnter={() => order.push('parent')}>
          <view
            ref={first}
            autofocus
            width={100}
            height={100}
            onEnter={() => true}
          />
          <view
            ref={second}
            x={200}
            width={100}
            height={100}
            onFocus={() => order.push('focus')}
            onEnter={() => {
              order.push('enter');
            }}
            onEnterRelease={() => {
              order.push('release');
            }}
          />
        </view>
      ));
      v.expect(lng.activeElement()).toBe(first);

      m.host.click(250, 50);
      await settle();
      v.expect(lng.activeElement()).toBe(second);
      // onEnter did not claim the key, so it bubbled, as it does from a remote.
      v.expect(order).toEqual(['focus', 'enter', 'parent', 'release']);
      m.dispose();
    },
  );

  v.test(
    'onMouseClick replaces the default click and gets the scene point',
    async () => {
      let button!: lng.ElementNode;
      let other!: lng.ElementNode;
      const onClick = v.vi.fn();
      const onEnter = v.vi.fn();
      const m = await mount(() => (
        <>
          <view
            ref={other}
            autofocus
            width={50}
            height={50}
            onEnter={() => {}}
          />
          <view
            ref={button}
            x={100}
            y={200}
            width={300}
            height={150}
            onMouseClick={onClick}
            onEnter={onEnter}
          />
        </>
      ));
      m.host.click(150, 250);
      await settle();
      v.expect(onClick).toHaveBeenCalledTimes(1);
      v.expect(onClick.mock.calls[0]![0]).toEqual({ x: 150, y: 250 });
      v.expect(onClick.mock.calls[0]![1]).toBe(button);
      v.expect(onEnter).not.toHaveBeenCalled();
      v.expect(lng.activeElement()).toBe(other);
      m.dispose();
    },
  );

  v.test('releasing somewhere else is not a click', async () => {
    const onEnter = v.vi.fn();
    const m = await mount(() => (
      <>
        <view x={0} y={0} width={100} height={100} onEnter={onEnter} />
        <view x={300} y={0} width={100} height={100} onEnter={onEnter} />
      </>
    ));
    m.host.down(50, 50);
    m.host.up(350, 50);
    await settle();
    v.expect(onEnter).not.toHaveBeenCalled();
    m.dispose();
  });

  v.test('the cursor follows cursorStyle through the host hook', async () => {
    const m = await mount(() => (
      <>
        <view x={100} y={200} width={200} height={100} onEnter={() => {}} />
        <view x={500} y={200} width={200} height={100} cursorStyle="grab" />
      </>
    ));
    m.host.move(150, 250);
    v.expect(m.host.cursor).toHaveBeenLastCalledWith('pointer');
    m.host.move(160, 250);
    // Told once per change, not once per move.
    v.expect(m.host.cursor).toHaveBeenCalledTimes(1);
    m.host.move(550, 250);
    v.expect(m.host.cursor).toHaveBeenLastCalledWith('grab');
    m.host.move(1500, 900);
    v.expect(m.host.cursor).toHaveBeenLastCalledWith(undefined);
    m.dispose();
  });

  v.test('state names and focus on hover are options', async () => {
    let tile!: lng.ElementNode;
    const m = await mount(
      () => (
        <view
          ref={tile}
          x={10}
          y={10}
          width={100}
          height={100}
          onEnter={() => {}}
        />
      ),
      { hoverState: '$over', pressedState: '$down', hoverFocus: true },
    );
    m.host.move(50, 50);
    await settle();
    v.expect(tile.states.has('$over')).toBe(true);
    v.expect(lng.activeElement()).toBe(tile);
    m.host.down(50, 50);
    v.expect(tile.states.has('$down')).toBe(true);
    m.host.sink!.cancelAll();
    v.expect(tile.states.has('$down')).toBe(false);
    v.expect(tile.states.has('$over')).toBe(false);
    m.dispose();
  });
});

v.describe('which node is under the pointer', () => {
  v.test(
    'z-order: zIndex first, then later siblings, and children over parents',
    async () => {
      let low!: lng.ElementNode;
      let high!: lng.ElementNode;
      let early!: lng.ElementNode;
      let late!: lng.ElementNode;
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;
      const m = await mount(() => (
        <>
          {/* The lower zIndex comes later in the list and still loses. */}
          <view
            ref={high}
            x={0}
            y={0}
            width={100}
            height={100}
            zIndex={5}
            onEnter={() => {}}
          />
          <view
            ref={low}
            x={0}
            y={0}
            width={100}
            height={100}
            zIndex={1}
            onEnter={() => {}}
          />
          <view x={200} y={0} width={300} height={100}>
            <view ref={early} width={100} height={100} onEnter={() => {}} />
            <view ref={late} width={100} height={100} onEnter={() => {}} />
          </view>
          <view
            ref={parent}
            x={600}
            y={0}
            width={200}
            height={200}
            onEnter={() => {}}
          >
            <view
              ref={child}
              x={50}
              y={50}
              width={50}
              height={50}
              onEnter={() => {}}
            />
          </view>
        </>
      ));
      const hovered = (x: number, y: number) => {
        m.host.move(x, y);
        return [low, high, early, late, parent, child].find((node) =>
          node.states.has('$hover'),
        );
      };
      v.expect(hovered(50, 50)).toBe(high);
      v.expect(hovered(250, 50)).toBe(late);
      v.expect(hovered(675, 75)).toBe(child);
      v.expect(hovered(610, 10)).toBe(parent);
      m.dispose();
    },
  );

  v.test(
    'nodes that take no pointer let it through to what is behind',
    async () => {
      let button!: lng.ElementNode;
      const m = await mount(() => (
        <>
          <view
            ref={button}
            x={100}
            y={100}
            width={200}
            height={100}
            onEnter={() => {}}
          />
          {/* A full-screen decoration painted over the button. */}
          <view width={1920} height={1080} color={0x00000022}>
            <text>overlay</text>
          </view>
        </>
      ));
      m.host.move(150, 150);
      v.expect(button.states.has('$hover')).toBe(true);
      m.dispose();
    },
  );

  v.test('clipping: a node is hit only where its ancestors are', async () => {
    let inner!: lng.ElementNode;
    let behind!: lng.ElementNode;
    const m = await mount(() => (
      <>
        <view
          ref={behind}
          x={0}
          y={300}
          width={600}
          height={100}
          onEnter={() => {}}
        />
        <view x={100} y={100} width={200} height={100} clipping zIndex={2}>
          {/* Taller than its clipping parent: the lower half is cut off. */}
          <view ref={inner} width={200} height={400} onEnter={() => {}} />
        </view>
      </>
    ));
    m.host.move(150, 150);
    v.expect(inner.states.has('$hover')).toBe(true);
    // Inside inner's own box, outside the parent that clips it.
    m.host.move(150, 350);
    v.expect(inner.states.has('$hover')).toBe(false);
    v.expect(behind.states.has('$hover')).toBe(true);
    m.dispose();
  });

  v.test('alpha 0 and skipFocus take a node and its subtree out', async () => {
    let button!: lng.ElementNode;
    const hidden = v.vi.fn();
    const m = await mount(() => (
      <>
        <view
          ref={button}
          x={50}
          y={50}
          width={200}
          height={200}
          onEnter={() => {}}
        />
        <view x={50} y={50} width={200} height={200} zIndex={10} skipFocus>
          <view width={200} height={200} onMouseClick={hidden} />
        </view>
        <view x={50} y={50} width={200} height={200} zIndex={20} alpha={0}>
          <view width={200} height={200} onMouseClick={hidden} />
        </view>
      </>
    ));
    m.host.move(100, 100);
    v.expect(button.states.has('$hover')).toBe(true);
    m.host.click(100, 100);
    await settle();
    v.expect(hidden).not.toHaveBeenCalled();
    v.expect(lng.activeElement()).toBe(button);
    m.dispose();
  });

  v.test('a disabled node stops the pointer and does nothing', async () => {
    let disabled!: lng.ElementNode;
    let behind!: lng.ElementNode;
    const onDisabled = v.vi.fn();
    const onBehind = v.vi.fn();
    const m = await mount(() => (
      <>
        <view
          ref={behind}
          x={0}
          y={0}
          width={400}
          height={400}
          onEnter={onBehind}
        />
        <view
          ref={disabled}
          x={100}
          y={100}
          width={100}
          height={100}
          ariaDisabled
          cursorStyle="not-allowed"
          onEnter={onDisabled}
          onMouseClick={onDisabled}
        />
      </>
    ));
    m.host.move(150, 150);
    v.expect(disabled.states.has('$hover')).toBe(false);
    v.expect(behind.states.has('$hover')).toBe(false);
    v.expect(m.host.cursor).toHaveBeenLastCalledWith('not-allowed');
    v.expect(m.host.down(150, 150)).toBe(false);
    m.host.up(150, 150);
    await settle();
    v.expect(onDisabled).not.toHaveBeenCalled();
    v.expect(onBehind).not.toHaveBeenCalled();

    // A node that is disabled while pressed does not click on release.
    m.host.down(10, 10);
    behind.ariaDisabled = true;
    m.host.move(11, 11);
    v.expect(behind.states.has('$pressed')).toBe(false);
    m.host.up(11, 11);
    await settle();
    v.expect(onBehind).not.toHaveBeenCalled();
    m.dispose();
  });

  v.test('while a focus trap is active only the trap is searched', async () => {
    let outside!: lng.ElementNode;
    let dialog!: lng.ElementNode;
    let inside!: lng.ElementNode;
    const m = await mount(() => (
      <>
        <view
          ref={outside}
          x={0}
          y={0}
          width={100}
          height={100}
          onEnter={() => {}}
        />
        <view ref={dialog} x={500} y={0} width={400} height={400}>
          <view ref={inside} width={100} height={100} onEnter={() => {}} />
        </view>
      </>
    ));
    const release = pushFocusTrap(dialog);
    try {
      m.host.move(50, 50);
      v.expect(outside.states.has('$hover')).toBe(false);
      v.expect(m.host.down(50, 50)).toBe(false);
      m.host.move(550, 50);
      v.expect(inside.states.has('$hover')).toBe(true);
    } finally {
      release();
    }
    m.host.move(50, 50);
    v.expect(outside.states.has('$hover')).toBe(true);
    m.dispose();
  });
});

v.describe('hold, drag and scroll', () => {
  v.test(
    'a hold fires once and is not a click; a removed node cannot click',
    async () => {
      let row!: lng.ElementNode;
      const hold = v.vi.fn();
      const enter = v.vi.fn();
      const m = await mount(() => (
        <view
          ref={row}
          width={100}
          height={100}
          onPointerHold={hold}
          onEnter={enter}
        />
      ));
      v.vi.useFakeTimers();
      try {
        m.host.down(20, 20);
        v.vi.advanceTimersByTime(600);
        m.host.up(20, 20);
        v.expect(hold).toHaveBeenCalledTimes(1);
        v.expect(hold.mock.calls[0]![0]).toBe(row);

        // Cancelled by the platform: the hold deadline goes with the press.
        m.host.down(20, 20);
        m.host.sink!.cancelAll();
        v.vi.advanceTimersByTime(600);
        m.host.up(20, 20);
        v.expect(hold).toHaveBeenCalledTimes(1);

        // Recycled while pressed: releasing over where it was does nothing.
        m.host.down(20, 20, 2);
        row.parent!.removeChild(row);
        m.host.up(20, 20, 2);
        v.vi.advanceTimersByTime(600);
      } finally {
        v.vi.useRealTimers();
      }
      await settle();
      v.expect(enter).not.toHaveBeenCalled();
      m.dispose();
    },
  );

  v.test(
    'a drag reaches the draggable around what was pressed, and is not a click',
    async () => {
      const scroll = scrollAxis();
      scroll.layout(2000, 400);
      const phases: string[] = [];
      const follow = dragToScroll(scroll);
      const enter = v.vi.fn();
      let item!: lng.ElementNode;
      const m = await mount(() => (
        <view
          x={0}
          y={0}
          width={400}
          height={400}
          onPointerDrag={(phase, point, origin) => {
            phases.push(phase);
            follow(phase, point, origin);
          }}
        >
          <view ref={item} y={100} width={400} height={100} onEnter={enter} />
        </view>
      ));
      m.host.down(50, 150);
      v.expect(item.states.has('$pressed')).toBe(true);
      // Inside the slop: still a press.
      m.host.move(52, 148);
      v.expect(phases).toEqual([]);
      m.host.move(50, 110);
      v.expect(item.states.has('$pressed')).toBe(false);
      m.host.move(50, 90);
      m.host.up(50, 90);
      await settle();
      v.expect(phases).toEqual(['start', 'move', 'move', 'end']);
      v.expect(scroll.offset()).toBe(20);
      v.expect(enter).not.toHaveBeenCalled();

      // The platform takes the pointer mid-drag.
      phases.length = 0;
      m.host.down(50, 150);
      m.host.move(50, 100);
      m.host.sink!.cancel(1);
      v.expect(phases).toEqual(['start', 'move', 'cancel']);
      m.dispose();
    },
  );

  v.test(
    'with nothing to drag, a press that moves is still a click',
    async () => {
      const enter = v.vi.fn();
      const m = await mount(() => (
        <view width={400} height={400} onEnter={enter} />
      ));
      m.host.down(50, 50);
      m.host.move(150, 150);
      m.host.up(150, 150);
      await settle();
      v.expect(enter).toHaveBeenCalledTimes(1);
      m.dispose();
    },
  );

  v.test(
    'a wheel scrolls the innermost scrollable and passes on at its end',
    async () => {
      const outer = scrollAxis();
      outer.layout(3000, 600);
      const inner = scrollAxis();
      inner.layout(500, 400);
      const outerWheel = wheelToScroll(outer);
      const m = await mount(() => (
        <view width={800} height={600} onPointerScroll={outerWheel}>
          <view
            x={100}
            y={100}
            width={400}
            height={400}
            // Scrolls while it can, then lets the list around it take over.
            onPointerScroll={(event) => {
              const before = inner.offset();
              inner.by(event.deltaY);
              return inner.offset() !== before;
            }}
          >
            <view width={400} height={100} onEnter={() => {}} />
          </view>
        </view>
      ));
      v.expect(m.host.wheel(150, 150, 0, 60)).toBe(true);
      v.expect(inner.offset()).toBe(60);
      v.expect(outer.offset()).toBe(0);
      v.expect(m.host.wheel(150, 150, 0, 60)).toBe(true);
      v.expect(inner.offset()).toBe(100);
      // The inner list is at its end: the outer one scrolls.
      v.expect(m.host.wheel(150, 150, 0, 60)).toBe(true);
      v.expect(inner.offset()).toBe(100);
      v.expect(outer.offset()).toBe(60);
      // Outside the inner list only the outer one is asked.
      v.expect(m.host.wheel(700, 50, 0, 40)).toBe(true);
      v.expect(outer.offset()).toBe(100);
      m.dispose();
    },
  );

  v.test(
    'a wheel nothing scrolls with steps focus like the arrow keys',
    async () => {
      const keys: string[] = [];
      const m = await mount(() => (
        <view
          autofocus
          width={400}
          height={400}
          onUp={() => {
            keys.push('up');
            return true;
          }}
          onDown={() => {
            keys.push('down');
            return true;
          }}
        />
      ));
      const now = v.vi.spyOn(performance, 'now');
      try {
        now.mockReturnValue(10_000);
        v.expect(m.host.wheel(50, 50, 0, 120)).toBe(true);
        // More wheel in the same quarter second is one step.
        now.mockReturnValue(10_100);
        m.host.wheel(50, 50, 0, 120);
        now.mockReturnValue(10_400);
        m.host.wheel(50, 50, 0, -120);
      } finally {
        now.mockRestore();
      }
      v.expect(keys).toEqual(['down', 'up']);
      m.dispose();
    },
  );
});

v.describe('pointer enter, leave and context menus', () => {
  v.test(
    'enter and leave follow the target and the cursor follows cursorStyle',
    async () => {
      const enter = v.vi.fn();
      const leave = v.vi.fn();
      const m = await mount(() => (
        <view
          x={100}
          y={100}
          width={200}
          height={100}
          cursorStyle="text"
          onPointerEnter={enter}
          onPointerLeave={leave}
        />
      ));
      m.host.move(150, 150);
      v.expect(enter).toHaveBeenCalledTimes(1);
      v.expect(leave).not.toHaveBeenCalled();
      v.expect(m.host.cursor).toHaveBeenLastCalledWith('text');
      // A move within the same target is not a second enter.
      m.host.move(160, 160);
      v.expect(enter).toHaveBeenCalledTimes(1);
      m.host.move(600, 600);
      v.expect(leave).toHaveBeenCalledTimes(1);
      v.expect(m.host.cursor).toHaveBeenLastCalledWith(undefined);
      // Leaving the surface also leaves the target.
      m.host.move(150, 150);
      m.host.sink!.leave();
      v.expect(leave).toHaveBeenCalledTimes(2);
      m.dispose();
    },
  );

  v.test(
    'a secondary click reaches the nearest handler and is not a click',
    async () => {
      const click = v.vi.fn();
      const inner = v.vi.fn();
      const outer = v.vi.fn();
      const m = await mount(() => (
        <view x={0} y={0} width={500} height={400} onPointerContext={outer}>
          <view
            x={100}
            y={100}
            width={200}
            height={100}
            onEnter={click}
            onPointerContext={inner}
          />
        </view>
      ));
      v.expect(m.host.sink!.context!({ x: 150, y: 150 })).toBe(true);
      v.expect(inner).toHaveBeenCalledTimes(1);
      v.expect(inner.mock.calls[0]![0]).toEqual({ x: 150, y: 150 });
      v.expect(outer).not.toHaveBeenCalled();
      v.expect(click).not.toHaveBeenCalled();
      // Outside the inner control the outer handler takes it.
      v.expect(m.host.sink!.context!({ x: 450, y: 350 })).toBe(true);
      v.expect(outer).toHaveBeenCalledTimes(1);
      // Empty space handles nothing.
      v.expect(m.host.sink!.context!({ x: 700, y: 700 })).toBe(false);
      m.dispose();
    },
  );

  v.test('a disabled control stops the context search', async () => {
    const outer = v.vi.fn();
    const m = await mount(() => (
      <view x={0} y={0} width={500} height={400} onPointerContext={outer}>
        <view
          x={100}
          y={100}
          width={200}
          height={100}
          ariaDisabled
          onPointerContext={() => {}}
        />
      </view>
    ));
    v.expect(m.host.sink!.context!({ x: 150, y: 150 })).toBe(false);
    v.expect(outer).not.toHaveBeenCalled();
    m.dispose();
  });

  v.test('Escape cancels an active drag', async () => {
    const phases: string[] = [];
    const m = await mount(() => (
      <view
        x={0}
        y={0}
        width={400}
        height={400}
        onPointerDrag={(phase) => phases.push(phase)}
      />
    ));
    m.host.down(50, 50);
    m.host.move(50, 120);
    // The move that crossed the slop starts the drag and reports the move.
    v.expect(phases).toEqual(['start', 'move']);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    );
    v.expect(phases).toEqual(['start', 'move', 'cancel']);
    m.host.up(50, 120);
    // Cancelled is not also an end.
    v.expect(phases).toEqual(['start', 'move', 'cancel']);
    m.dispose();
  });
});

v.describe('cost', () => {
  v.test(
    'moving the pointer sets no timer, schedules no frame and adds no listener',
    async () => {
      const m = await mount(() => (
        <>
          <view x={0} y={0} width={200} height={200} onEnter={() => {}} />
          <view x={300} y={0} width={200} height={200} onEnter={() => {}} />
        </>
      ));
      const spies = [
        v.vi.spyOn(globalThis, 'setTimeout'),
        v.vi.spyOn(globalThis, 'setInterval'),
        v.vi.spyOn(globalThis, 'requestAnimationFrame'),
        v.vi.spyOn(globalThis, 'queueMicrotask'),
        v.vi.spyOn(window, 'addEventListener'),
        v.vi.spyOn(document, 'addEventListener'),
      ];
      try {
        for (let i = 0; i < 200; i++) m.host.move((i * 7) % 500, 100);
        // A press on a node without a hold handler needs no deadline either.
        m.host.down(50, 50);
        m.host.move(60, 60);
        m.host.sink!.cancel(1);
        for (const spy of spies) v.expect(spy).not.toHaveBeenCalled();
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      m.dispose();
    },
  );

  v.test(
    'the scene keeps no reference to the point a host passes',
    async () => {
      let tile!: lng.ElementNode;
      const click = v.vi.fn();
      const m = await mount(() => (
        <view ref={tile} width={200} height={200} onMouseClick={click} />
      ));
      // A host may reuse one point object for every event.
      const point = { x: 50, y: 50 };
      m.host.sink!.down(1, point);
      point.x = 60;
      m.host.sink!.move(1, point);
      point.x = 70;
      m.host.sink!.up(1, point);
      point.x = 999;
      v.expect(click.mock.calls[0]![0]).toEqual({ x: 70, y: 50 });
      m.dispose();
    },
  );
});

v.describe('createInputScope: a pointer source a host pushes into', () => {
  v.test(
    'does nothing until connected, then forwards; Tab walks the focus stops',
    async () => {
      let first!: lng.ElementNode;
      let second!: lng.ElementNode;
      const m = await mount(() => (
        <>
          <view ref={first} width={100} height={100} onEnter={() => {}} />
          <view
            ref={second}
            x={200}
            width={100}
            height={100}
            onEnter={() => {}}
          />
          <view
            x={400}
            width={100}
            height={100}
            ariaDisabled
            onEnter={() => {}}
          />
        </>
      ));
      const scope = createInputScope();
      v.expect(scope.down(1, { x: 50, y: 50 })).toBe(false);
      scope.move(1, { x: 50, y: 50 });
      v.expect(first.states.has('$hover')).toBe(false);
      v.expect(scope.key('Tab', true)).toBe(false);

      const disconnect = scope.connect(m.pointer);
      scope.move(1, { x: 50, y: 50 });
      v.expect(first.states.has('$hover')).toBe(true);
      v.expect(scope.down(1, { x: 50, y: 50 })).toBe(true);
      scope.cancelAll();

      v.expect(scope.key('Tab', true)).toBe(true);
      await settle();
      v.expect(lng.activeElement()).toBe(first);
      scope.key('Tab', true);
      await settle();
      v.expect(lng.activeElement()).toBe(second);
      // Around at the end, skipping the disabled one; Shift+Tab goes back.
      scope.key('Tab', true);
      await settle();
      v.expect(lng.activeElement()).toBe(first);
      scope.key('Tab', true, false, true);
      await settle();
      v.expect(lng.activeElement()).toBe(second);
      v.expect(scope.key('Enter', true)).toBe(false);

      disconnect();
      v.expect(scope.down(1, { x: 50, y: 50 })).toBe(false);
      m.dispose();
    },
  );
});
