// The PS4 pointer-only binding: a click on empty space goes to the focused
// node, a click on a focusable node activates it, and pointer movement
// focuses what it is over. The scene is a real ElementNode tree through the
// one scene pointer; the binding is the browser module the host uses.
import { expect, test, vi } from 'vitest';
import {
  activeElement,
  Config,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { createScenePointer } from '../../src/sdk/input.js';
import { bindPS4 } from '../../hosts/web-tv/input.mjs';
import { KeyTarget } from '../contract-focus-helpers.js';
import { renderer } from '../setup.js';

Config.domRendererEnabled = true;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Mounted {
  root: HTMLElement;
  first: ElementNode;
  second: ElementNode;
  firstEnter: ReturnType<typeof vi.fn>;
  secondEnter: ReturnType<typeof vi.fn>;
  press(x: number, y: number): void;
  move(x: number, y: number): void;
  dispose(): void;
}

async function mount(): Promise<Mounted> {
  const root = document.body.appendChild(document.createElement('div'));
  const firstEnter = vi.fn();
  const secondEnter = vi.fn();
  let first!: ElementNode;
  let second!: ElementNode;
  let pointer!: ReturnType<typeof createScenePointer>;
  let binding!: ReturnType<typeof bindPS4>;
  const dispose = renderer.render(() => {
    useFocusManager(undefined, new KeyTarget());
    const app = (
      <view width={1920} height={1080}>
        <view
          ref={first}
          autofocus
          x={100}
          y={100}
          width={200}
          height={100}
          onEnter={firstEnter}
        />
        <view
          ref={second}
          x={500}
          y={100}
          width={200}
          height={100}
          onFocus={() => {}}
          onEnter={secondEnter}
        />
      </view>
    ) as unknown as ElementNode;
    pointer = createScenePointer(app);
    binding = bindPS4(root, (event) => ({
      x: event.clientX,
      y: event.clientY,
    }));
    binding.input.connect(pointer);
    return app;
  }) as unknown as () => void;
  await tick();
  const mouse = (type: string, x: number, y: number) =>
    new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
    });
  return {
    root,
    first,
    second,
    firstEnter,
    secondEnter,
    move(x, y) {
      window.dispatchEvent(mouse('mousemove', x, y));
    },
    press(x, y) {
      root.dispatchEvent(mouse('mousedown', x, y));
      window.dispatchEvent(mouse('mouseup', x, y));
    },
    dispose() {
      binding.dispose();
      pointer.dispose();
      dispose();
      root.remove();
    },
  };
}

test('pointer movement focuses the node under it, without pressing it', async () => {
  const m = await mount();
  try {
    m.move(150, 150);
    await tick();
    expect(activeElement()).toBe(m.first);
    m.move(550, 150);
    await tick();
    expect(activeElement()).toBe(m.second);
    // A move is focus, not Select.
    expect(m.firstEnter).not.toHaveBeenCalled();
    expect(m.secondEnter).not.toHaveBeenCalled();
  } finally {
    m.dispose();
  }
});

test('a click on empty space presses Enter on the focused node', async () => {
  const m = await mount();
  try {
    m.move(550, 150);
    await tick();
    expect(activeElement()).toBe(m.second);
    m.press(1500, 900);
    await tick();
    expect(m.secondEnter).toHaveBeenCalledTimes(1);
    expect(m.firstEnter).not.toHaveBeenCalled();
  } finally {
    m.dispose();
  }
});

test('a click on a node with no mouse handler focuses it and presses Enter', async () => {
  const m = await mount();
  try {
    m.press(150, 150);
    await tick();
    expect(activeElement()).toBe(m.first);
    expect(m.firstEnter).toHaveBeenCalledTimes(1);
  } finally {
    m.dispose();
  }
});

test('a click on a node stops the empty-space fallback', async () => {
  const m = await mount();
  try {
    m.press(550, 150);
    await tick();
    expect(m.secondEnter).toHaveBeenCalledTimes(1);
    expect(m.firstEnter).not.toHaveBeenCalled();
  } finally {
    m.dispose();
  }
});
