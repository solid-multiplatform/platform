// TextField and SearchField on `/app`: the host's editor comes from the app
// context, so an app needs no Controls wrapper and no bounds.
import * as v from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { SearchField, TextField } from '@solid-multiplatform/platform/app';
import { Column, Select } from '@solid-multiplatform/platform/primitives';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import {
  createScenePointer,
  type PointerSink,
  type PointerSource,
} from '../src/sdk/input.js';
import type { Editor, EditorHost, EditorOptions } from '../src/sdk/editor.js';
import { AppScope } from '../src/app/context.js';
import { HostScope } from '../src/app/context.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

/** The first node in `node`'s tree that `matches`, deepest first. */
function findNode(
  node: unknown,
  matches: (node: lng.ElementNode) => boolean,
): lng.ElementNode | undefined {
  const current = node as { children?: readonly unknown[] };
  for (const child of current.children ?? []) {
    const found = findNode(child, matches);
    if (found !== undefined) return found;
  }
  return (node as lng.ElementNode | { children?: readonly unknown[] }) !==
    null &&
    Array.isArray(current.children) &&
    matches(node as lng.ElementNode)
    ? (node as lng.ElementNode)
    : undefined;
}

function fakeEditorHost() {
  const calls: EditorOptions[] = [];
  const focus = v.vi.fn();
  const blur = v.vi.fn();
  const dispose = v.vi.fn();
  const setBounds = v.vi.fn();
  const host: EditorHost = {
    createEditor(options) {
      calls.push(options);
      let value = options.value ?? '';
      return {
        focus,
        blur,
        value: () => value,
        setValue(next) {
          value = next;
        },
        setBounds,
        dispose,
      } satisfies Editor;
    },
  };
  return { host, calls, focus, blur, dispose, setBounds };
}

let stop: (() => void) | undefined;
let keys: KeyTarget;

async function mount(
  app: (host: EditorHost) => lng.JSX.Element,
  editors: EditorHost,
) {
  keys = new KeyTarget();
  const entry = appEntry(() => app(editors), {}, {});
  const before = lng.rootNode.children.slice();
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys);
    return createComponent(HostScope.Provider, {
      value: { target: 'web', text: editors },
      get children() {
        return entry.root();
      },
    });
  });
  stop = () => {
    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.includes(child)) continue;
      lng.rootNode.removeChild(child);
      (child as lng.ElementNode).destroy();
    }
  };
  await settle();
}

/** A host pointer: it only knows where the finger is. */
class FakePointer implements PointerSource {
  sink: PointerSink | undefined;
  connect(sink: PointerSink) {
    this.sink = sink;
    return () => {
      this.sink = undefined;
    };
  }
  setCursor(_style: string | undefined) {}
  tap(x: number, y: number) {
    this.sink!.down(1, { x, y });
    this.sink!.up(1, { x, y });
  }
}

/** Mounts the app at a known place and connects a pointer to it. */
async function mountTappable(
  app: (host: EditorHost) => lng.JSX.Element,
  editors: EditorHost,
) {
  keys = new KeyTarget();
  const pointer = new FakePointer();
  const before = lng.rootNode.children.slice();
  let stage!: lng.ElementNode;
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys);
    return createComponent(AppScope.Provider, {
      value: { plugins: {}, text: editors },
      get children() {
        return (
          <view ref={(node) => (stage = node)} width={400} height={300}>
            {app(editors)}
          </view>
        );
      },
    });
  });
  const scope = createScenePointer(stage, {});
  pointer.connect(scope);
  stop = () => {
    scope.dispose();
    dispose();
    for (const child of lng.rootNode.children.slice()) {
      if (before.includes(child)) continue;
      lng.rootNode.removeChild(child);
      // A menu portals its dialog in as the root's own child, and a
      // fragment can leave a bare text node there: only elements destroy.
      if (lng.isElementNode(child)) child.destroy();
    }
  };
  await settle();
  return { stage, pointer };
}

async function press(key: string) {
  keys.down(key);
  keys.up(key);
  await settle();
}

v.afterEach(() => {
  stop?.();
  stop = undefined;
});

v.test('a TextField opens the host editor and reports changes', async () => {
  const { host, calls, focus, dispose, setBounds } = fakeEditorHost();
  const [value, setValue] = createSignal('initial');
  await mount(
    () => (
      <TextField
        label="Name"
        placeholder="Type here"
        autofocus
        value={value()}
        onChange={setValue}
      />
    ),
    host,
  );
  // Focus starts editing: the autofocused field opens its editor at mount.
  v.expect(calls).toHaveLength(1);
  v.expect(calls[0]).toMatchObject({
    label: 'Name',
    value: 'initial',
    placeholder: 'Type here',
    purpose: 'text',
  });
  // The label sits above the box, so the editor starts below the caption and
  // the control keeps a 44-pt target: the box itself stays 48 pt, and the
  // editor is given just the text band the scene draws inside it.
  const field = findNode(
    lng.rootNode,
    (node) => node.ariaLabel === 'Name' && node.role === 'textbox',
  );
  const boxNode = field?.children.find(
    (child) => (child as lng.ElementNode).height === 48,
  ) as lng.ElementNode;
  v.expect(boxNode.height).toBeGreaterThanOrEqual(44);
  const editor = setBounds.mock.calls[0]![0] as {
    x: number;
    y: number;
    height: number;
  };
  v.expect(editor.y).toBeGreaterThanOrEqual(15);
  v.expect(editor.height).toBe(32);
  v.expect(texts(lng.rootNode)).toContain('Name');
  v.expect(focus).toHaveBeenCalledTimes(1);
  // Enter focuses the same editor again; it does not create another.
  await press('Enter');
  v.expect(calls).toHaveLength(1);
  v.expect(focus).toHaveBeenCalledTimes(2);

  calls[0]!.onChange('Ada');
  v.expect(value()).toBe('Ada');
  v.expect(dispose).not.toHaveBeenCalled();
});

v.test(
  'the placeholder sits where the editor is drawn, so focus does not move it',
  async () => {
    const { host, setBounds } = fakeEditorHost();
    await mount(
      () => (
        <TextField label="Name" placeholder="Type here" autofocus width={300} />
      ),
      host,
    );
    const field = findNode(
      lng.rootNode,
      (node) => node.ariaLabel === 'Name' && node.role === 'textbox',
    );
    const boxNode = field?.children.find(
      (child) => (child as lng.ElementNode).height === 48,
    ) as lng.ElementNode;
    const text = boxNode.children[0] as lng.ElementNode;
    // The hint is inset by the field's padding (spacing(3) = 12) and rests on
    // the band the editor is placed on: (48 - 32) / 2 = 8. Before the fix the
    // scene drew it flush at the box's corner while the host editor inset
    // it — the "suddenly gets padding" jump.
    v.expect(text.x).toBe(12);
    v.expect(text.y).toBe(8);
    const editor = setBounds.mock.calls[0]![0] as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    v.expect(editor).toMatchObject({
      x: 12,
      y: 38,
      width: 276,
      height: 32,
    });
  },
);

v.test(
  'password, numeric and search fields ask for the right keyboard',
  async () => {
    const cases: Array<{
      app: () => lng.JSX.Element;
      purpose: string;
    }> = [
      {
        app: () => <TextField label="Secret" password autofocus />,
        purpose: 'new-password',
      },
      {
        app: () => <TextField label="Code" numeric autofocus />,
        purpose: 'number',
      },
      { app: () => <SearchField label="Find" autofocus />, purpose: 'search' },
    ];
    for (const { app, purpose } of cases) {
      const { host, calls } = fakeEditorHost();
      await mount(app, host);
      await press('Enter');
      v.expect(calls[0]?.purpose).toBe(purpose);
      stop?.();
      stop = undefined;
    }
  },
);

v.test('the field is inert on a host without an editor', async () => {
  await mount(
    () => <TextField label="Name" autofocus />,
    undefined as unknown as EditorHost,
  );
  // No throw while mounting or pressing keys; the field still draws.
  await press('Enter');
  v.expect(lng.rootNode.children.length).toBeGreaterThan(0);
});

v.test('a focused field scrolls its form above the keyboard', async () => {
  const { host } = fakeEditorHost();
  let column!: lng.ElementNode;
  await mount(
    () => (
      <view width={400} height={300} clipping>
        <Column
          ref={(node) => (column = node as lng.ElementNode)}
          width={400}
          height={300}
          scroll="touch"
        >
          <view width={400} height={400} />
          <TextField label="Name" width={300} autofocus />
        </Column>
      </view>
    ),
    host,
  );
  await settle();
  // The field starts at y=400 in a 300-high viewport; revealing it moves the
  // column's content up instead of leaving the field under the fold.
  v.expect(column.y).toBeLessThan(0);
  v.expect(column.y).toBeLessThanOrEqual(-100);
});

v.test(
  'the editor follows the form while a drag scrolls it under the field',
  async () => {
    const { host, setBounds } = fakeEditorHost();
    let column!: lng.ElementNode;
    await mount(
      () => (
        <view width={400} height={300} clipping>
          <Column
            ref={(node) => (column = node as lng.ElementNode)}
            width={400}
            height={300}
            scroll="touch"
          >
            <view width={400} height={400} />
            <TextField label="Name" width={300} autofocus />
          </Column>
        </view>
      ),
      host,
    );
    await settle();
    const before = setBounds.mock.calls.at(-1)![0] as { y: number };
    const callsBefore = setBounds.mock.calls.length;
    // The touch engine moves its scroller with raw `y` writes: no layout, no
    // scene event. Frame ticks are what follow it — the renderer emits them
    // while frames draw and none while the scene is still.
    column.y -= 100;
    (
      renderer.renderer as unknown as {
        emit(event: string, data?: unknown): void;
      }
    ).emit('frameTick', { time: 0, delta: 16 });
    v.expect(setBounds.mock.calls.length).toBeGreaterThan(callsBefore);
    const after = setBounds.mock.calls.at(-1)![0] as { y: number };
    v.expect(after.y).toBeCloseTo(before.y - 100, 5);
    // An idle scene sends nothing further.
    (
      renderer.renderer as unknown as {
        emit(event: string, data?: unknown): void;
      }
    ).emit('frameTick', { time: 16, delta: 16 });
    v.expect(setBounds.mock.calls.at(-1)![0]).toMatchObject(after);
  },
);

v.test('leaves its host editor when scene focus moves away', async () => {
  const { host, blur } = fakeEditorHost();
  let other!: lng.ElementNode;
  await mount(
    () => (
      <view width={400} height={300}>
        <TextField label="Name" autofocus />
        <view
          ref={(node) => (other = node as lng.ElementNode)}
          width={100}
          height={44}
          onEnter={() => true}
        />
      </view>
    ),
    host,
  );
  await settle();
  v.expect(blur).not.toHaveBeenCalled();
  other.setFocus();
  await settle();
  // The native editor lives above the scene; if it is left focused, its
  // hint floats over the dialog that took focus next.
  v.expect(blur).toHaveBeenCalled();
});

v.test(
  'a tap opens the editor and puts focus on the field, not its drawing',
  async () => {
    const { host, calls } = fakeEditorHost();
    const { pointer } = await mountTappable(
      () => (
        <>
          <TextField label="Name" width={300} />
          <view y={120} width={200} height={44} onEnter={() => true} />
        </>
      ),
      host,
    );
    // The tap lands in the field's box (the label line and gap put it at
    // y=30); the box hands the tap to the field instead of taking focus
    // itself, so the focused node is the control the keyboard belongs to.
    pointer.tap(20, 50);
    await settle();
    v.expect(calls).toHaveLength(1);
    const active = lng.activeElement() as lng.ElementNode | undefined;
    v.expect(active?.role).toBe('textbox');
    v.expect(active?.ariaLabel).toBe('Name');
  },
);

v.test(
  'tapping another control ends editing, so the keyboard goes with it',
  async () => {
    const { host, focus, blur } = fakeEditorHost();
    const { pointer } = await mountTappable(
      () => (
        <>
          <TextField label="Name" width={300} />
          <view y={120} width={200} height={44} onEnter={() => true} />
        </>
      ),
      host,
    );
    // Tapping the caption strip opens the editor directly. The field takes
    // scene focus as part of opening: the next control the person taps is a
    // focus move away from it, its editor blurs, and the host dismisses the
    // keyboard — the phone's "tap elsewhere and it stays up" bug.
    pointer.tap(20, 10);
    await settle();
    v.expect(focus).toHaveBeenCalled();
    v.expect(blur).not.toHaveBeenCalled();

    pointer.tap(100, 140);
    await settle();
    v.expect(blur).toHaveBeenCalledTimes(1);
    // The scene's own value is back where the editor's overlay was.
    const field = findNode(
      lng.rootNode,
      (node) => node.ariaLabel === 'Name' && node.role === 'textbox',
    );
    const boxNode = field?.children.find(
      (child) => (child as lng.ElementNode).height === 48,
    ) as lng.ElementNode;
    v.expect((boxNode.children[0] as lng.ElementNode).alpha).toBe(1);
  },
);

v.test(
  'choosing from a Select leaves the field closed, not its editor reopened',
  async () => {
    const { host, focus, blur } = fakeEditorHost();
    const { pointer } = await mountTappable(
      () => (
        <>
          <TextField label="Name" width={300} />
          <Select
            y={120}
            width={200}
            label="Sort"
            value="a"
            options={[
              { value: 'a', label: 'One' },
              { value: 'b', label: 'Two' },
            ]}
          />
        </>
      ),
      host,
    );
    // The person types, then reaches for the dropdown instead. (One tap
    // focuses the editor twice: once for the tap, once for the applied
    // focus event.)
    pointer.tap(20, 50);
    await settle();
    const focusCalls = focus.mock.calls.length;
    v.expect(focusCalls).toBeGreaterThanOrEqual(1);
    // The trigger's tap takes scene focus before the menu opens: the
    // field's editor resigns right there, and the menu's trap remembers
    // the trigger — not the field — as where it goes back to.
    pointer.tap(100, 140);
    await settle();
    v.expect(blur).toHaveBeenCalledTimes(1);
    // Picking an option closes the menu: focus returns to the trigger, so
    // the field's editor stays closed instead of the keyboard coming back
    // over a choice the person just made.
    const item = findNode(
      lng.rootNode,
      (node) => node.role === 'menuitem' && node.ariaLabel === 'Two',
    );
    v.expect(item).toBeDefined();
    pointer.tap(
      Math.round((item?.absX ?? 0) + (item?.width ?? 0) / 2),
      Math.round((item?.absY ?? 0) + (item?.height ?? 0) / 2),
    );
    await settle();
    v.expect(focus.mock.calls.length).toBe(focusCalls);
    const restored = lng.activeElement() as lng.ElementNode | undefined;
    v.expect(restored?.ariaLabel).toBe('Sort');
  },
);
