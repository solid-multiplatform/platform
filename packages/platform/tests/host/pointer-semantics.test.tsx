// startApp wires the host's pointer and semantics sink to the scene: the app
// registers nothing, and a host without them pays nothing.
import { expect, test, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import {
  activeElement,
  Config,
  rootNode,
  type ElementNode,
} from '@solid-multiplatform/platform';
import {
  startApp,
  type HostContext,
  type HostDefinition,
} from '@solid-multiplatform/platform/host';
import { domHost } from '@solid-multiplatform/platform/host/dom';
import { semanticsHook } from '../../src/core/accessibility.js';
import {
  hasScenePointer,
  type PointerSink,
  type PointerSource,
} from '../../src/sdk/input.js';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof MutationObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;
Config.domRendererEnabled = true;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const newRoot = () => document.body.appendChild(document.createElement('div'));
const renderer = { appWidth: 1280, appHeight: 720 };

/** The DOM host with its pointer replaced by whatever the test supplies. */
function hostWith(
  root: HTMLElement,
  pointer: PointerSource | undefined,
): HostDefinition<HTMLElement> {
  const base = domHost({ root, pointer: false, semantics: false });
  return {
    target: base.target,
    launch: (run) =>
      base.launch((context: HostContext<HTMLElement>) =>
        run({ ...context, pointer }),
      ),
  };
}

test('a host pointer source reaches the scene with nothing registered', async () => {
  let sink: PointerSink | undefined;
  const cursor = vi.fn();
  const connect = vi.fn((next: PointerSink) => {
    sink = next;
    return () => {
      sink = undefined;
    };
  });
  const onEnter = vi.fn();
  let tile!: ElementNode;
  const stop = startApp(
    hostWith(newRoot(), { connect, setCursor: cursor }),
    () => (
      <view width={1280} height={720}>
        <view
          ref={tile}
          x={100}
          y={100}
          width={200}
          height={100}
          onEnter={onEnter}
        />
      </view>
    ),
    { renderer },
  ) as () => void;
  await tick();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(hasScenePointer(rootNode)).toBe(true);

  sink!.move(1, { x: 150, y: 150 });
  expect(tile.states.has('$hover')).toBe(true);
  expect(cursor).toHaveBeenLastCalledWith('pointer');
  sink!.down(1, { x: 150, y: 150 });
  expect(tile.states.has('$pressed')).toBe(true);
  sink!.up(1, { x: 150, y: 150 });
  await tick();
  expect(activeElement()).toBe(tile);
  expect(onEnter).toHaveBeenCalledTimes(1);

  stop();
  expect(sink).toBeUndefined();
  expect(hasScenePointer(rootNode)).toBe(false);
  // The next app on this root starts from an empty scene.
  expect(rootNode.children).toHaveLength(0);
});

test('a remote-only host installs nothing for pointer or semantics', async () => {
  const pointerEvents = /^(pointer|mouse|touch|wheel|click)/;
  const listen = vi.spyOn(EventTarget.prototype, 'addEventListener');
  const stop = startApp(
    domHost({ root: newRoot(), target: 'tizen', pointer: false }),
    () => (
      <view width={1280} height={720}>
        <view autofocus width={200} height={100} onEnter={() => {}}>
          <text>Play</text>
        </view>
      </view>
    ),
    { renderer },
  ) as () => void;
  await tick();
  expect(
    listen.mock.calls
      .map((call) => call[0])
      .filter((type) => pointerEvents.test(type)),
  ).toEqual([]);
  listen.mockRestore();
  expect(hasScenePointer(rootNode)).toBe(false);
  // No sink on a browser TV unless asked for: the scene keeps no semantics.
  expect(semanticsHook).toBeUndefined();
  expect(document.querySelector('[role="button"]')).toBeNull();
  stop();
});

test('the web host mirrors the scene into ARIA and follows it', async () => {
  const root = newRoot();
  const [title, setTitle] = createSignal('Play');
  const [extra, setExtra] = createSignal(true);
  const onEnter = vi.fn();
  let play!: ElementNode;
  let more!: ElementNode;
  const stop = startApp(
    domHost({ root }),
    () => (
      <view width={1280} height={720}>
        <view ref={play} autofocus width={200} height={100} onEnter={onEnter}>
          <text>{title()}</text>
        </view>
        <Show when={extra()}>
          <view
            ref={more}
            y={200}
            width={200}
            height={100}
            role="checkbox"
            ariaLabel="Subtitles"
            ariaChecked={false}
            onEnter={() => {}}
          />
        </Show>
      </view>
    ),
    { renderer },
  ) as () => void;
  await tick();

  const button = root.querySelector<HTMLElement>('button[aria-label="Play"]')!;
  expect(button).not.toBeNull();
  expect(button.getAttribute('role')).toBe('button');
  expect(button.tabIndex).toBe(0);
  const checkbox = root.querySelector('[role="checkbox"]')!;
  expect(checkbox.getAttribute('aria-label')).toBe('Subtitles');
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  // The browser's focus is where the scene's is.
  expect(document.activeElement).toBe(button);

  setTitle('Pause');
  more.ariaChecked = true;
  more.setFocus();
  await tick();
  expect(button.getAttribute('aria-label')).toBe('Pause');
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(checkbox);

  // A screen reader's click, and its focus, act on the scene.
  button.focus();
  await tick();
  expect(activeElement()).toBe(play);
  button.click();
  await tick();
  expect(onEnter).toHaveBeenCalledTimes(1);

  setExtra(false);
  await tick();
  expect(root.querySelector('[role="checkbox"]')).toBeNull();

  stop();
  expect(root.querySelector('[role="button"]')).toBeNull();
  expect(semanticsHook).toBeUndefined();
});
