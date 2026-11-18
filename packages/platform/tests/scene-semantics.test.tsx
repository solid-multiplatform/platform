// Semantics come from the tree: a node says what it is in JSX, most of it is
// derived, and a host's sink is kept in step with the scene.
import * as v from 'vitest';
import { createSignal, Show, type JSX } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { semanticsHook } from '../src/core/accessibility.js';
import { auditSemantics } from '../src/sdk/a11y.js';
import {
  attachSemantics,
  sceneSemantics,
  type Semantics,
  type SemanticsHandle,
  type SemanticsSink,
} from '../src/sdk/semantics.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Item {
  node: Semantics;
  parent: Item | undefined;
  disposed: boolean;
}

/** A host sink that records what it is told. */
function recordingSink() {
  const items: Item[] = [];
  const log: string[] = [];
  const handles = new Map<SemanticsHandle, Item>();
  const sink: SemanticsSink = {
    register(node, parent) {
      const item: Item = {
        node,
        parent: parent && handles.get(parent),
        disposed: false,
      };
      items.push(item);
      log.push(`register ${node.role} "${node.label}"`);
      const handle: SemanticsHandle = {
        update(next) {
          item.node = next;
          log.push(`update ${next.role} "${next.label}"`);
        },
        focus() {
          log.push(`focus "${item.node.label}"`);
        },
        dispose() {
          item.disposed = true;
          log.push(`dispose "${item.node.label}"`);
        },
      };
      handles.set(handle, item);
      return handle;
    },
  };
  const live = () => items.filter((item) => !item.disposed);
  const find = (label: string) =>
    live().find((item) => item.node.label === label);
  return { sink, items, log, live, find };
}

async function mount(view: () => JSX.Element) {
  let app!: lng.ElementNode;
  const recorded = recordingSink();
  let detach!: () => void;
  const dispose = renderer.render(() => {
    useFocusManager(undefined, new KeyTarget());
    const root = (
      <view ref={app} width={1920} height={1080}>
        {view()}
      </view>
    );
    detach = attachSemantics(app, recorded.sink);
    return root;
  }) as unknown as () => void;
  await settle();
  return {
    app,
    ...recorded,
    dispose() {
      detach();
      dispose();
    },
  };
}

v.describe('semantics derived from JSX', () => {
  v.test('roles, names and states', async () => {
    const m = await mount(() => (
      <>
        {/* onEnter and text: a button named by the text. */}
        <view width={200} height={60} onEnter={() => {}}>
          <text>Play</text>
          <text ariaHidden>▶</text>
        </view>
        <view
          role="switch"
          ariaLabel="Wifi"
          ariaChecked={true}
          ariaDescription="Uses the home network"
          onEnter={() => {}}
        >
          <text>ignored when a label is given</text>
        </view>
        <text role="heading" ariaLevel={1}>
          Library
        </text>
        <view announce="Spoken name" onEnter={() => {}} />
        <view role="list">
          <view role="none" onEnter={() => true}>
            <view onEnter={() => {}}>
              <text>Inside a swallowing panel</text>
            </view>
          </view>
        </view>
        <view ariaHidden>
          <view onEnter={() => {}}>
            <text>Hidden by its parent</text>
          </view>
        </view>
        <view hidden onEnter={() => {}}>
          <text>Not shown</text>
        </view>
        <text>Plain text is not an item</text>
      </>
    ));

    v.expect(
      m.live().map((item) => `${item.node.role}:${item.node.label}`),
    ).toEqual([
      'button:Play',
      'switch:Wifi',
      'heading:Library',
      'button:Spoken name',
      'list:',
      'button:Inside a swallowing panel',
    ]);
    const wifi = m.find('Wifi')!.node;
    v.expect(wifi.checked).toBe(true);
    v.expect(wifi.description).toBe('Uses the home network');
    v.expect(typeof wifi.activate).toBe('function');
    v.expect(m.find('Library')!.node.level).toBe(1);
    v.expect(m.find('Library')!.node.activate).toBeUndefined();
    // Items nest as the scene does: the button is inside the list.
    v.expect(m.find('Inside a swallowing panel')!.parent!.node.role).toBe(
      'list',
    );
    // What a sink holds is what the scene says about itself right now.
    v.expect(sceneSemantics(m.app).map((node) => node.label)).toEqual(
      m.live().map((item) => item.node.label),
    );
    m.dispose();
  });

  v.test(
    'the sink follows text, state, focus and removal, and only those',
    async () => {
      const [title, setTitle] = createSignal('Episode 1');
      const [checked, setChecked] = createSignal(false);
      const [shown, setShown] = createSignal(true);
      const [x, setX] = createSignal(0);
      let play!: lng.ElementNode;
      const m = await mount(() => (
        <>
          <view ref={play} x={x()} width={200} height={60} onEnter={() => {}}>
            <text>{title()}</text>
          </view>
          <view role="checkbox" ariaLabel="Subtitles" ariaChecked={checked()} />
          <Show when={shown()}>
            <view onEnter={() => {}}>
              <text>Remove me</text>
            </view>
          </Show>
        </>
      ));
      v.expect(m.log).toEqual([
        'register button "Episode 1"',
        'register checkbox "Subtitles"',
        'register button "Remove me"',
      ]);
      m.log.length = 0;

      setTitle('Episode 2');
      setChecked(true);
      await settle();
      // One pass for both; an item's own props are applied before renames.
      v.expect(m.log).toEqual([
        'update checkbox "Subtitles"',
        'update button "Episode 2"',
      ]);
      v.expect(m.find('Subtitles')!.node.checked).toBe(true);
      m.log.length = 0;

      play.setFocus();
      await settle();
      v.expect(m.log).toEqual(['focus "Episode 2"']);
      m.log.length = 0;

      setShown(false);
      await settle();
      v.expect(m.log).toEqual(['dispose "Remove me"']);
      m.log.length = 0;
      setShown(true);
      await settle();
      v.expect(m.log).toEqual(['register button "Remove me"']);
      m.log.length = 0;

      // Geometry is read through `bounds` when a host wants it, not pushed.
      setX(40);
      await settle();
      v.expect(m.log).toEqual([]);
      v.expect(m.find('Episode 2')!.node.bounds!()).toEqual({
        x: 40,
        y: 0,
        width: 200,
        height: 60,
      });
      m.dispose();
    },
  );

  v.test(
    'an action from assistive technology focuses and presses Enter',
    async () => {
      const onEnter = v.vi.fn();
      let button!: lng.ElementNode;
      const m = await mount(() => (
        <view ref={button} width={200} height={60} onEnter={onEnter}>
          <text>Open</text>
        </view>
      ));
      m.find('Open')!.node.activate!();
      await settle();
      v.expect(lng.activeElement()).toBe(button);
      v.expect(onEnter).toHaveBeenCalledTimes(1);
      m.dispose();
    },
  );

  v.test('with no host attached a change reaches nobody', async () => {
    const [title, setTitle] = createSignal('One');
    const m = await mount(() => (
      <view onEnter={() => {}}>
        <text>{title()}</text>
      </view>
    ));
    v.expect(semanticsHook).toBeDefined();
    m.log.length = 0;
    const microtasks = v.vi.spyOn(globalThis, 'queueMicrotask');
    try {
      // Detached while the tree is still there.
      const [app, detachAndDispose] = [m.app, m.dispose];
      detachAndDispose();
      v.expect(semanticsHook).toBeUndefined();
      microtasks.mockClear();
      setTitle('Two');
      app.children.forEach((child) => {
        (child as lng.ElementNode).ariaLabel = 'Renamed';
      });
      v.expect(microtasks).not.toHaveBeenCalled();
    } finally {
      microtasks.mockRestore();
    }
    await settle();
    v.expect(m.log).toEqual(['dispose "One"']);
  });
});

v.describe('auditSemantics on the live tree', () => {
  v.test(
    'finds what the scene gets wrong and accepts what it gets right',
    async () => {
      let app!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={app} width={1920} height={1080}>
          <view role="list">
            <view width={200} height={60} onEnter={() => {}}>
              <text>Fine</text>
            </view>
          </view>
          <view width={200} height={60} onEnter={() => {}} />
          <view width={20} height={20} onEnter={() => {}}>
            <text>Tiny</text>
          </view>
          <view role="checkbox" ariaLabel="No state" width={200} height={60} />
        </view>
      )) as unknown as () => void;
      await settle();
      v.expect(
        auditSemantics(app).map((issue) => `${issue.role}:${issue.rule}`),
      ).toEqual([
        'button:label',
        'button:touch-target',
        'checkbox:state',
        'checkbox:action',
      ]);
      dispose();
    },
  );
});
