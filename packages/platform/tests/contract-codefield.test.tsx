// CodeField: a row of drawn slots over ONE host editor. The editor reports
// whole values only, so every case below drives the field exactly the way a
// host does — `onChange` with the text the editor now holds: one character
// per key, and a paste as either an append at the caret or a whole-field
// replacement over a select-all. That is also the honest simulation of
// autofill, which sets the whole text the same way a select-all paste does.
import * as v from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Column } from '@solid-multiplatform/platform/primitives';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import type { Editor, EditorHost, EditorOptions } from '../src/sdk/editor.js';
import { AppScope } from '../src/app/context.js';
import { CodeField } from '../src/primitives/CodeField.jsx';
import { KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

/**
 * The characters the slots draw, in slot order. The conditional label leaves
 * an empty placeholder text beside the row, so this reads the row itself:
 * the child whose children are the `count` slot boxes.
 */
const slotTexts = (root: unknown, count: number): string[] => {
  const outer = root as { children?: readonly unknown[] };
  const row = (outer.children ?? []).find(
    (child) =>
      Array.isArray((child as { children?: readonly unknown[] }).children) &&
      ((child as { children?: readonly unknown[] }).children ?? []).length ===
        count,
  );
  return texts(row);
};

/** A host's editor, the way `app-textfield` fakes it: it holds the text. */
function editorHost() {
  const created: EditorOptions[] = [];
  const editors: Editor[] = [];
  const calls: string[] = [];
  const rects: Array<{ x: number; y: number; width: number; height: number }> =
    [];
  const host: EditorHost = {
    createEditor(options) {
      created.push(options);
      let text = options.value ?? '';
      const editor: Editor = {
        focus: () => calls.push('focus'),
        blur: () => calls.push('blur'),
        value: () => text,
        setValue(next) {
          text = next;
        },
        setBounds: (rect) => rects.push({ ...rect }),
        dispose: () => calls.push('dispose'),
      };
      editors.push(editor);
      return editor;
    },
  };
  return { host, created, editors, calls, rects };
}

type Harness = ReturnType<typeof editorHost>;

// The host's value has already moved to `next` when it reports the change.
const report = (h: Harness, next: string) => {
  h.editors[0]!.setValue(next);
  h.created[0]!.onChange(next);
};
const type = (h: Harness, char: string) =>
  report(h, h.editors[0]!.value() + char);
const backspace = (h: Harness) => report(h, h.editors[0]!.value().slice(0, -1));
// A paste lands where the caret is (at the end of what the host holds) or
// over a selection that took everything (reported as the whole new text).
const pasteAtCaret = (h: Harness, text: string) =>
  report(h, h.editors[0]!.value() + text);
const pasteOverAll = (h: Harness, text: string) => report(h, text);

let stop: (() => void) | undefined;
let keys: KeyTarget;

async function mount(app: () => lng.JSX.Element, host: EditorHost) {
  keys = new KeyTarget();
  const before = lng.rootNode.children.slice();
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys);
    return createComponent(AppScope.Provider, {
      value: { plugins: {}, text: host },
      get children() {
        return app();
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
  return lng.rootNode.children.find((child) => !before.includes(child))!;
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

v.test('one editor fills the slots in order as characters arrive', async () => {
  const h = editorHost();
  const codes: string[] = [];
  let completed = 0;
  const root = await mount(
    () => (
      <CodeField
        slots={4}
        autofocus
        onChange={(code) => codes.push(code)}
        onComplete={() => completed++}
      />
    ),
    h.host,
  );
  // The whole field owns one host editor, however many slots it draws.
  v.expect(h.created).toHaveLength(1);
  v.expect(h.created[0]!.purpose).toBe('one-time-code');
  v.expect(h.created[0]!.value).toBe('');
  v.expect(h.created[0]!.label).toBe('Code');
  v.expect(h.calls).toContain('focus');
  for (const char of '123') type(h, char);
  v.expect(codes).toEqual(['1', '12', '123']);
  v.expect(slotTexts(root, 4)).toEqual(['1', '2', '3', '']);
  v.expect(completed).toBe(0);
});

v.test(
  'backspace clears the last filled slot; clearing all reports empty',
  async () => {
    const h = editorHost();
    const codes: string[] = [];
    const root = await mount(
      () => (
        <CodeField slots={4} autofocus onChange={(code) => codes.push(code)} />
      ),
      h.host,
    );
    for (const char of '123') type(h, char);
    backspace(h);
    v.expect(codes.at(-1)).toBe('12');
    v.expect(slotTexts(root, 4)).toEqual(['1', '2', '', '']);
    backspace(h);
    backspace(h);
    v.expect(codes.at(-1)).toBe('');
    // Backspace on an empty field reports the same text; nothing fires.
    backspace(h);
    v.expect(codes.at(-1)).toBe('');
    // Select-all and delete reports the emptied field the same way.
    type(h, '9');
    pasteOverAll(h, '');
    v.expect(codes.at(-1)).toBe('');
    v.expect(slotTexts(root, 4)).toEqual(['', '', '', '']);
  },
);

v.test('a paste fills every slot from the first one', async () => {
  const h = editorHost();
  const codes: string[] = [];
  let completed = 0;
  const root = await mount(
    () => (
      <CodeField
        autofocus
        onChange={(code) => codes.push(code)}
        onComplete={() => completed++}
      />
    ),
    h.host,
  );
  pasteAtCaret(h, '123456');
  v.expect(codes).toEqual(['123456']);
  v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
  // The last slot filling by paste completes the code too.
  v.expect(completed).toBe(1);
});

v.test(
  'a paste keeps only the first slots-worth of code characters',
  async () => {
    const h = editorHost();
    const codes: string[] = [];
    const root = await mount(
      () => <CodeField autofocus onChange={(code) => codes.push(code)} />,
      h.host,
    );
    // Separators that senders wrap codes in, and characters past the last
    // slot, are not code; the editor is asked to hold exactly what the slots
    // show.
    pasteAtCaret(h, ' 123-456 789');
    v.expect(codes).toEqual(['123456']);
    v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
    v.expect(h.editors[0]!.value()).toBe('123456');
  },
);

v.test('a paste into a partially filled field replaces the code', async () => {
  const h = editorHost();
  const codes: string[] = [];
  const root = await mount(
    () => (
      <CodeField slots={6} autofocus onChange={(code) => codes.push(code)} />
    ),
    h.host,
  );
  for (const char of '1234') type(h, char);
  // The host delivered the paste at the caret, after what was already
  // there. The delivered text is now the six characters "123412", which is
  // value-identical to autofill arriving with that code: the field reads it
  // as the code rather than keeping only the "12" tail. (The two are
  // indistinguishable through the editor port, and the code wins.)
  pasteAtCaret(h, '12');
  v.expect(codes.at(-1)).toBe('123412');
  v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '1', '2']);
  // The same paste over a select-all is reported as the whole new text.
  pasteOverAll(h, '9988');
  v.expect(codes.at(-1)).toBe('9988');
  v.expect(slotTexts(root, 6)).toEqual(['9', '9', '8', '8', '', '']);
  // A full six-character paste over the partial code fills every slot.
  pasteOverAll(h, '123456');
  v.expect(codes.at(-1)).toBe('123456');
  v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
});

v.test(
  'onComplete fires when the last slot fills, once per completed code',
  async () => {
    const h = editorHost();
    const codes: string[] = [];
    const completed: string[] = [];
    await mount(
      () => (
        <CodeField
          slots={4}
          autofocus
          onChange={(code) => codes.push(code)}
          onComplete={(code) => completed.push(code)}
        />
      ),
      h.host,
    );
    for (const char of '123') type(h, char);
    v.expect(completed).toEqual([]);
    type(h, '4');
    v.expect(completed).toEqual(['1234']);
    // A character past the last slot changes nothing.
    type(h, '9');
    v.expect(codes.at(-1)).toBe('1234');
    v.expect(completed).toEqual(['1234']);
    // Completing again first requires stopping being complete.
    backspace(h);
    v.expect(codes.at(-1)).toBe('123');
    type(h, '9');
    v.expect(completed).toEqual(['1234', '1239']);
    // One more code reported whole over the full field is not a completion:
    // the field never stopped being complete.
    pasteOverAll(h, '5678');
    v.expect(codes.at(-1)).toBe('5678');
    v.expect(completed).toEqual(['1234', '1239']);
  },
);

v.test('Return submits a complete code and refuses a partial one', async () => {
  const h = editorHost();
  const submitted: string[] = [];
  await mount(
    () => (
      <CodeField
        slots={4}
        autofocus
        onSubmit={(code) => submitted.push(code)}
      />
    ),
    h.host,
  );
  for (const char of '12') type(h, char);
  h.created[0]!.onSubmit(h.editors[0]!.value());
  v.expect(submitted).toEqual([]);
  for (const char of '34') type(h, char);
  h.created[0]!.onSubmit(h.editors[0]!.value());
  v.expect(submitted).toEqual(['1234']);
  // The scene's Enter opens the same editor again; it makes no second one.
  await press('Enter');
  v.expect(h.created).toHaveLength(1);
  v.expect(h.calls.filter((call) => call === 'focus')).toHaveLength(2);
});

v.test('the field is one focus stop; arrows never land in a slot', async () => {
  const h = editorHost();
  await mount(() => <CodeField autofocus />, h.host);
  const active = () => lng.activeElement() as lng.ElementNode | undefined;
  v.expect(active()?.ariaLabel).toBe('Code');
  await press('ArrowRight');
  await press('ArrowLeft');
  v.expect(active()?.ariaLabel).toBe('Code');
});

v.test('the editor leaves when scene focus moves away', async () => {
  const h = editorHost();
  let other!: lng.ElementNode;
  await mount(
    () => (
      <view width={400} height={200}>
        <CodeField autofocus />
        <view
          ref={(node) => (other = node as lng.ElementNode)}
          width={100}
          height={44}
          onEnter={() => true}
        />
      </view>
    ),
    h.host,
  );
  await settle();
  v.expect(h.calls).not.toContain('blur');
  other.setFocus();
  await settle();
  v.expect(h.calls).toContain('blur');
});

v.test('the field draws without an editor host and stays inert', async () => {
  const root = await mount(
    () => <CodeField autofocus value="123456" />,
    undefined as unknown as EditorHost,
  );
  await press('Enter');
  v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
});

v.test("passing '' as the value clears the slots and the editor", async () => {
  const h = editorHost();
  const [value, setValue] = createSignal('1234');
  const root = await mount(
    () => <CodeField slots={4} autofocus value={value()} />,
    h.host,
  );
  v.expect(slotTexts(root, 4)).toEqual(['1', '2', '3', '4']);
  v.expect(h.editors[0]!.value()).toBe('1234');
  setValue('');
  await settle();
  v.expect(slotTexts(root, 4)).toEqual(['', '', '', '']);
  v.expect(h.editors[0]!.value()).toBe('');
});

v.test('a secure field draws an asterisk per entered character', async () => {
  const h = editorHost();
  const root = await mount(
    () => <CodeField slots={4} secure autofocus value="12" />,
    h.host,
  );
  v.expect(slotTexts(root, 4)).toEqual(['*', '*', '', '']);
});

v.test(
  'the editor is placed over the slots and follows the scrolled form',
  async () => {
    const h = editorHost();
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
            <CodeField autofocus />
          </Column>
        </view>
      ),
      h.host,
    );
    await settle();
    // The editor box is the row's geometry: six default 48-pt slots (a 44-pt
    // minimum at the theme's text size) plus five 8-pt gaps, the same
    // screenRect path a host overlay follows. The field sits 430 pt down: the
    // 400-pt spacer plus the column's 30-pt gap.
    v.expect(h.rects[0]).toMatchObject({
      x: 0,
      y: 430,
      width: 328,
      height: 48,
    });
    // The field starts under the fold of a 300-high viewport; revealing it
    // moves the column up instead of leaving the field under the fold, and
    // the editor box follows the moved row — the path KeyboardAvoidingView
    // composes with.
    v.expect(column.y).toBeLessThanOrEqual(-100);
    v.expect(h.rects.length).toBeGreaterThan(1);
    const last = h.rects.at(-1)!;
    v.expect(last.y).toBeLessThan(h.rects[0]!.y);
    v.expect(last.y).toBeGreaterThanOrEqual(0);
  },
);

v.test('autofill over a typed digit delivers the whole code', async () => {
  const h = editorHost();
  const codes: string[] = [];
  const root = await mount(
    () => (
      <CodeField slots={6} autofocus onChange={(code) => codes.push(code)} />
    ),
    h.host,
  );
  // The person starts typing; the SMS arrives and the system fills the
  // field in one delivery. The fragment reading kept only the tail
  // ("23456"); the whole code wins.
  type(h, '1');
  pasteOverAll(h, '123456');
  v.expect(codes.at(-1)).toBe('123456');
  v.expect(slotTexts(root, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
});

v.test(
  'a focused field forwards its focus state to the slot boxes',
  async () => {
    const h = editorHost();
    let outer: unknown;
    const root = await mount(
      () => (
        <CodeField
          slots={6}
          autofocus
          ref={(node) => {
            outer = node;
          }}
        />
      ),
      h.host,
    );
    const outerNode = outer as unknown as {
      states: { add(name: string): void; has(name: string): boolean };
      children: readonly {
        forwardStates?: boolean;
        states: { has(name: string): boolean };
      }[];
    };
    outerNode.states.add('$focus');
    // The row wrapper forwards to its children, so every slot box draws
    // the focus state — the field's only affordance on a TV.
    const row = outerNode.children.find((child) => child.forwardStates === true);
    v.expect(row).toBeDefined();
    v.expect(
      (row as { children: readonly { states: { has(n: string): boolean } }[] })
        .children.every((box) => box.states.has('$focus')),
    ).toBe(true);
    // The characters still read through the same slots.
    v.expect(slotTexts(root, 6).length).toBe(6);
  },
);

v.test(
  'the editor follows the form while a drag scrolls it under the slots',
  async () => {
    const h = editorHost();
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
            <CodeField slots={4} autofocus />
          </Column>
        </view>
      ),
      h.host,
    );
    await settle();
    const before = h.rects.at(-1)! as { y: number };
    const callsBefore = h.rects.length;
    // The touch engine moves its scroller with raw `y` writes: no layout, no
    // scene event. Frame ticks are what follow it — the renderer emits them
    // while frames draw and none while the scene is still.
    column.y -= 100;
    (renderer.renderer as unknown as {
      emit(event: string, data?: unknown): void;
    }).emit('frameTick', { time: 0, delta: 16 });
    v.expect(h.rects.length).toBeGreaterThan(callsBefore);
    const after = h.rects.at(-1)! as { y: number };
    v.expect(after.y).toBeCloseTo(before.y - 100, 5);
  },
);
