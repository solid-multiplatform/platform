// TextField and SearchField on `/app`: the host's editor comes from the app
// context, so an app needs no Controls wrapper and no bounds.
import * as v from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { SearchField, TextField } from '@solid-multiplatform/platform/app';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import type {
  Editor,
  EditorHost,
  EditorOptions,
} from '../src/sdk/editor.js';
import { HostScope } from '../src/app/context.js';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

function fakeEditorHost() {
  const calls: EditorOptions[] = [];
  const focus = v.vi.fn();
  const dispose = v.vi.fn();
  const host: EditorHost = {
    createEditor(options) {
      calls.push(options);
      let value = options.value ?? '';
      return {
        focus,
        blur() {},
        value: () => value,
        setValue(next) {
          value = next;
        },
        setBounds: v.vi.fn(),
        dispose,
      } satisfies Editor;
    },
  };
  return { host, calls, focus, dispose };
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
  const { host, calls, focus, dispose } = fakeEditorHost();
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
  // Drawing the field creates no editor; focusing and Enter do.
  v.expect(calls).toHaveLength(0);
  await press('Enter');
  v.expect(calls).toHaveLength(1);
  v.expect(calls[0]).toMatchObject({
    label: 'Name',
    value: 'initial',
    purpose: 'text',
  });
  v.expect(focus).toHaveBeenCalledTimes(1);

  calls[0]!.onChange('Ada');
  v.expect(value()).toBe('Ada');
  v.expect(dispose).not.toHaveBeenCalled();
});

v.test('password, numeric and search fields ask for the right keyboard', async () => {
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
      purpose: 'one-time-code',
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
});

v.test('the field is inert on a host without an editor', async () => {
  await mount(
    () => <TextField label="Name" autofocus />,
    undefined as unknown as EditorHost,
  );
  // No throw while mounting or pressing keys; the field still draws.
  await press('Enter');
  v.expect(lng.rootNode.children.length).toBeGreaterThan(0);
});
