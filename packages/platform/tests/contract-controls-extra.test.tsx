// The controls Apple's HIG expects but the first pass did not ship: a switch,
// a slider, an activity indicator and an action sheet. These pin the
// interaction each one promises, not just that it renders.
import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  ActionSheet,
  Alert,
  ContextMenu,
  DatePicker,
  Menu,
  PageControl,
  ActivityIndicator,
  Sheet,
  Slider,
  Switch,
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/primitives';
import { renderer, waitForUpdate } from './setup.js';

const keys = new EventTarget();
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

async function press(key: string) {
  keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
  await flush();
}

function findAll(
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
}

let dispose: (() => void) | undefined;
async function mount(app: () => lng.JSX.Element) {
  dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    return app();
  }) as unknown as () => void;
  await waitForUpdate();
  await flush();
}
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
});

v.describe('Switch', () => {
  v.test('toggles with Enter and reports its state', async () => {
    const [on, setOn] = createSignal(false);
    await mount(() => (
      <Switch label="Crossfade" checked={on()} onChange={setOn} autofocus />
    ));
    const node = findAll(renderer.rootNode, (n) => n.role === 'switch').at(-1)!;
    v.expect(node.ariaChecked).toBe(false);
    await press('Enter');
    v.expect(on()).toBe(true);
    v.expect(node.ariaChecked).toBe(true);
    await press('Enter');
    v.expect(on()).toBe(false);
  });
});

v.describe('Slider', () => {
  v.test('steps with the arrow keys and Home/End', async () => {
    const [value, setValue] = createSignal(50);
    await mount(() => (
      <Slider
        label="Volume"
        value={value()}
        min={0}
        max={100}
        step={10}
        width={240}
        autofocus
        onChange={setValue}
      />
    ));
    const node = findAll(renderer.rootNode, (n) => n.role === 'slider').at(-1)!;
    await press('ArrowRight');
    v.expect(value()).toBe(60);
    await press('ArrowLeft');
    v.expect(value()).toBe(50);
    await press('Home');
    v.expect(value()).toBe(0);
    await press('End');
    v.expect(value()).toBe(100);
    v.expect(node.ariaValueNow).toBe(100);
  });

  v.test('a click on the track sets the nearest step', async () => {
    const [value, setValue] = createSignal(0);
    await mount(() => (
      <Slider
        label="Volume"
        value={value()}
        min={0}
        max={100}
        step={10}
        width={240}
        onChange={setValue}
      />
    ));
    const node = findAll(renderer.rootNode, (n) => n.role === 'slider').at(-1)!;
    // The label takes the leading side; click the middle of the track.
    node.onMouseClick?.({ x: 180, y: 0 }, node);
    await flush();
    const next = value();
    v.expect(next).toBeGreaterThanOrEqual(40);
    v.expect(next).toBeLessThanOrEqual(60);
  });
});

v.describe('ActivityIndicator', () => {
  v.test('draws a static ring when animations are off', async () => {
    const animations = lng.Config.animationsEnabled;
    lng.Config.animationsEnabled = false;
    try {
      await mount(() => <ActivityIndicator animating />);
      const node = findAll(
        renderer.rootNode,
        (n) => n.role === 'progressbar',
      )[0]!;
      v.expect(node).toBeDefined();
      v.expect(node.children.length).toBe(8);
    } finally {
      lng.Config.animationsEnabled = animations;
    }
  });
});

v.describe('ActionSheet', () => {
  v.test('runs a chosen action and closes', async () => {
    const [open, setOpen] = createSignal(true);
    const picked: string[] = [];
    await mount(() => (
      <ActionSheet
        visible={open()}
        title="Track actions"
        actions={[
          { label: 'Play next', onPress: () => picked.push('play') },
          {
            label: 'Delete',
            style: 'destructive',
            onPress: () => picked.push('delete'),
          },
        ]}
        onRequestClose={() => setOpen(false)}
      />
    ));
    const action = findAll(
      renderer.rootNode,
      (node) => node.role === 'button' && node.ariaLabel === 'Play next',
    ).at(-1)!;
    action.onMouseClick?.(new MouseEvent('click'), action);
    await flush();
    v.expect(picked).toEqual(['play']);
    v.expect(open()).toBe(false);
  });

  v.test('Cancel is a separate action and closes', async () => {
    const [open, setOpen] = createSignal(true);
    await mount(() => (
      <ActionSheet
        visible={open()}
        actions={[{ label: 'One' }]}
        onRequestClose={() => setOpen(false)}
      />
    ));
    const cancel = findAll(
      renderer.rootNode,
      (node) => node.role === 'button' && node.ariaLabel === 'Cancel',
    ).at(-1)!;
    cancel.onMouseClick?.(new MouseEvent('click'), cancel);
    await flush();
    v.expect(open()).toBe(false);
  });
});

v.test('Space activates the focused control, like Return', async () => {
  const pressed = v.vi.fn();
  await mount(() => (
    <view width={200} height={44} autofocus onEnter={pressed} />
  ));
  await press(' ');
  v.expect(pressed).toHaveBeenCalledTimes(1);
});

v.describe('Apple dialog details', () => {
  v.test(
    'a destructive alert focuses Cancel, not the destructive action',
    async () => {
      await mount(() => (
        <Alert
          visible
          title="Delete this playlist?"
          message="This cannot be undone."
          destructive
          confirmLabel="Delete"
        />
      ));
      await flush();
      const active = lng.activeElement();
      const label = (node: unknown): string => {
        const current = node as {
          text?: string;
          children?: readonly unknown[];
        };
        if (typeof current.text === 'string') return current.text;
        return (current.children ?? []).map(label).join('');
      };
      v.expect(label(active)).toBe('Cancel');
    },
  );

  v.test(
    'a menu separator is drawn, skipped, and a shortcut is shown',
    async () => {
      await mount(() => (
        <Menu
          visible
          anchor={{ x: 20, y: 20, width: 120, height: 44 }}
          items={[
            { label: 'Open', shortcut: '⌘O' },
            { separator: true },
            { label: 'Delete', destructive: true, shortcut: '⌫' },
          ]}
        />
      ));
      await flush();
      const separator = findAll(
        renderer.rootNode,
        (node) => node.role === 'separator',
      );
      v.expect(separator.length).toBeGreaterThan(0);
      const shortcut = findAll(renderer.rootNode, (node) =>
        node.children.some(
          (child) => (child as { text?: string }).text === '⌘O',
        ),
      );
      v.expect(shortcut.length).toBeGreaterThan(0);
      // Down skips the separator and lands on Delete.
      await press('ArrowDown');
      v.expect(lng.activeElement()?.ariaLabel).toBe('Delete');
    },
  );

  v.test('a context menu puts destructive commands last', async () => {
    await mount(() => (
      <ContextMenu
        visible
        point={{ x: 20, y: 20, width: 0, height: 0 }}
        items={[
          { label: 'Open' },
          { label: 'Delete', destructive: true },
          { label: 'Share' },
        ]}
      />
    ));
    await flush();
    const items = findAll(
      renderer.rootNode,
      (node) => node.role === 'menuitem',
    );
    v.expect(items.map((item) => item.ariaLabel)).toEqual([
      'Open',
      'Share',
      'Delete',
    ]);
  });
});

v.test('a sheet dismisses when its handle is pulled past a third', async () => {
  const closed = v.vi.fn();
  lng.setCapabilities('android');
  try {
    await mount(() => (
      <Sheet visible label="Share" title="Share" onRequestClose={closed}>
        <view width={200} height={44} />
      </Sheet>
    ));
    await flush();
    const handle = findAll(
      renderer.rootNode,
      (node) => node.id === 'sheet-drag',
    )[0]!;
    v.expect(handle).toBeDefined();
    handle.onPointerDrag?.(
      'start',
      { x: 100, y: 200 },
      { x: 100, y: 200 },
      handle,
    );
    handle.onPointerDrag?.(
      'move',
      { x: 100, y: 260 },
      { x: 100, y: 200 },
      handle,
    );
    handle.onPointerDrag?.(
      'move',
      { x: 100, y: 400 },
      { x: 100, y: 200 },
      handle,
    );
    handle.onPointerDrag?.(
      'end',
      { x: 100, y: 400 },
      { x: 100, y: 200 },
      handle,
    );
    v.expect(closed).toHaveBeenCalledTimes(1);
  } finally {
    lng.resetCapabilities();
  }
});

v.test(
  'a three-action alert stacks them and focuses the default action',
  async () => {
    const picked: string[] = [];
    await mount(() => (
      <Alert
        visible
        title="Save changes?"
        actions={[
          { label: 'Save', onPress: () => picked.push('save') },
          {
            label: 'Discard',
            style: 'destructive',
            onPress: () => picked.push('discard'),
          },
          { label: 'Cancel', style: 'cancel' },
        ]}
      />
    ));
    await flush();
    const buttons = findAll(
      renderer.rootNode,
      (node) => node.role === 'button',
    );
    v.expect(buttons.map((button) => button.ariaLabel)).toEqual([
      'Save',
      'Discard',
      'Cancel',
    ]);
    // The trailing item is Cancel, so the default is the first real choice.
    const label = (node: unknown): string => {
      const current = node as { text?: string; children?: readonly unknown[] };
      if (typeof current.text === 'string') return current.text;
      return (current.children ?? []).map(label).join('');
    };
    v.expect(label(lng.activeElement())).toBe('Save');
    await press('Enter');
    v.expect(picked).toEqual(['save']);
  },
);

v.test('a page control marks the current page and jumps on a dot', async () => {
  const [page, setPage] = createSignal(1);
  await mount(() => (
    <PageControl count={5} index={page()} onChange={setPage} />
  ));
  const dot = findAll(
    renderer.rootNode,
    (node) => node.ariaLabel === 'Page 3',
  )[0]!;
  v.expect(dot).toBeDefined();
  dot.onMouseClick?.(new MouseEvent('click'), dot);
  await flush();
  v.expect(page()).toBe(2);
});

v.test(
  'an outside tap commits a date picker and does not dismiss a sheet',
  async () => {
    const changes: Date[] = [];
    const closed = v.vi.fn();
    await mount(() => (
      <DatePicker
        visible
        value={new Date(2026, 0, 15)}
        onChange={(date) => changes.push(date)}
        onRequestClose={closed}
        title="Release date"
      />
    ));
    const dialog = findAll(
      renderer.rootNode,
      (node) => node.role === 'dialog',
    )[0]!;
    v.expect(typeof dialog.onMouseClick).toBe('function');
    dialog.onMouseClick?.(new MouseEvent('click'), dialog);
    await flush();
    // The compact picker confirms its current value on an outside tap.
    v.expect(changes).toHaveLength(1);
    v.expect(closed).toHaveBeenCalledTimes(1);
    dispose?.();
    dispose = undefined;
    await mount(() => (
      <Sheet visible label="Share" title="Share">
        <view width={200} height={44} />
      </Sheet>
    ));
    const sheetDialog = findAll(
      renderer.rootNode,
      (node) => node.role === 'dialog',
    ).at(-1)!;
    v.expect(sheetDialog.onMouseClick).toBeUndefined();
  },
);
