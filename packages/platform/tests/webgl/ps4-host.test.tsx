// The PS4 host in a real browser engine: a pointer-only scene where movement
// focuses, a click selects, a click on empty space presses Enter on the
// focused node, and nothing is scheduled once the scene is settled.
import { expect, test } from 'vitest';
import { activeElement } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';
import { ps4Host } from '@solid-multiplatform/platform/browser-tv/input';
import { scheduled, settle } from './conformance-harness';

const tick = () =>
  new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

interface Walk {
  /** Sends a pointer move to a scene point. */
  move(x: number, y: number): void;
  /** Presses and releases the left button at a scene point. */
  click(x: number, y: number): void;
}

function mount() {
  document.body.innerHTML =
    '<div id="app" style="width:1920px;height:1080px"></div>';
  const surface = document.getElementById('app')!;
  const entered: string[] = [];
  const card = (id: string, x: number, y: number, onEnter: () => void) => (
    <view id={id} x={x} y={y} width={400} height={280} onEnter={onEnter} />
  );
  const stop = startApp(
    ps4Host(webHost, { root: surface, namespace: 'ps4-test' }),
    () => (
      <view width={1920} height={1080}>
        {card('one', 100, 100, () => entered.push('one'))}
        {card('two', 700, 100, () => entered.push('two'))}
        {card('three', 1300, 100, () => entered.push('three'))}
      </view>
    ),
    {},
  ) as () => void;
  return { surface, entered, stop };
}

/** A scene point as a client point on the fitted canvas. */
function pointer(surface: HTMLElement) {
  const canvas = surface.querySelector('canvas')!;
  const box = canvas.getBoundingClientRect();
  const client = (x: number, y: number) => ({
    clientX: box.left + (x * box.width) / 1920,
    clientY: box.top + (y * box.height) / 1080,
  });
  const mouse = (type: string, x: number, y: number) =>
    new MouseEvent(type, { ...client(x, y), button: 0, bubbles: true });
  return {
    move(x: number, y: number) {
      window.dispatchEvent(mouse('mousemove', x, y));
    },
    click(x: number, y: number) {
      surface.dispatchEvent(mouse('mousedown', x, y));
      window.dispatchEvent(mouse('mouseup', x, y));
    },
  } satisfies Walk;
}

test('the PS4 host focuses on move and selects on click', async () => {
  const { surface, entered, stop } = mount();
  try {
    await settle();
    const walk = pointer(surface);

    walk.move(300, 240);
    await tick();
    expect(activeElement()?.id).toBe('one');
    walk.move(900, 240);
    await tick();
    expect(activeElement()?.id).toBe('two');
    walk.move(1500, 240);
    await tick();
    expect(activeElement()?.id).toBe('three');
    // Movement is focus only.
    expect(entered).toEqual([]);

    // A click on the node under the pointer selects it.
    walk.click(300, 240);
    await tick();
    expect(activeElement()?.id).toBe('one');
    expect(entered).toEqual(['one']);

    // A click on empty space presses Enter on the focused node.
    walk.move(1500, 240);
    await tick();
    walk.click(1700, 950);
    await tick();
    expect(activeElement()?.id).toBe('three');
    expect(entered).toEqual(['one', 'three']);

    // Two seconds with the pointer still schedules nothing (the wait itself
    // is the one timer). A short grace first lets a browser's last resize or
    // first-render frame land, which is not scene work.
    await settle();
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const before = scheduled();
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    expect(scheduled()).toBe(before + 1);
  } finally {
    stop();
  }
});
