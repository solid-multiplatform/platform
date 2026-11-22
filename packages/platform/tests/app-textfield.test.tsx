// TextField and SearchField on `/app`: the host's editor comes from the app
// context, so an app needs no Controls wrapper and no bounds.
import * as v from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { SearchField, TextField } from '@solid-multiplatform/platform/app';
import { Column } from '@solid-multiplatform/platform/primitives';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import type { Editor, EditorHost, EditorOptions } from '../src/sdk/editor.js';
import { HostScope } from '../src/app/context.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

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
  // keeps a 44-pt target. This is the shape that was a blank rectangle when
  // the label was hidden and the host had no placeholder.
  const box = setBounds.mock.calls[0]![0] as { y: number; height: number };
  v.expect(box.y).toBeGreaterThanOrEqual(15);
  v.expect(box.height).toBeGreaterThanOrEqual(44);
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
