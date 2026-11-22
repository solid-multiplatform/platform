/**
 * Alert, Menu, Select, DatePicker and RadioGroup with a remote: arrows move,
 * Enter activates, Back closes, focus opens on the sensible element, stays
 * inside the overlay and returns to the opener.
 */
import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  Alert,
  Column,
  DatePicker,
  Drawer,
  Menu,
  Popover,
  RadioGroup,
  Select,
  Sheet,
} from '@solid-multiplatform/platform/primitives';
import { viewport } from '../src/sdk/viewport.js';
import { flush, mount, type KeyTarget } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

const texts = (node: unknown): string[] => {
  const current = node as { text?: string; children?: readonly unknown[] };
  if (typeof current.text === 'string') return [current.text];
  return (current.children ?? []).flatMap((child) => texts(child));
};

const find = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
): lng.ElementNode | undefined => {
  if (!lng.isINode(node)) return undefined;
  if (lng.isElementNode(node) && predicate(node)) return node;
  for (const child of node.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return undefined;
};

/** The text drawn in the focused element. */
const focused = () =>
  texts(lng.activeElement())
    .filter((text) => text.length > 0)
    .join(' ');

async function press(target: KeyTarget, ...keys: string[]) {
  for (const key of keys) {
    target.down(key);
    target.up(key);
    await flush();
  }
}

const opener = (ref: (node: lng.ElementNode) => void, open: () => void) => (
  <view ref={ref} width={200} height={48} autofocus onEnter={open}>
    <text>Open</text>
  </view>
);

v.describe('Alert with keys', () => {
  async function alert() {
    const [open, setOpen] = createSignal(false);
    const calls: string[] = [];
    let trigger!: lng.ElementNode;
    const mounted = await mount(() => (
      <view width={1280} height={720}>
        {opener(
          (node) => (trigger = node),
          () => setOpen(true),
        )}
        <Alert
          visible={open}
          title="Delete?"
          message="This cannot be undone"
          onConfirm={() => calls.push('confirm')}
          onCancel={() => calls.push('cancel')}
          onRequestClose={() => setOpen(false)}
        />
      </view>
    ));
    v.expect(lng.activeElement()).toBe(trigger);
    await press(mounted.target, 'Enter');
    return { ...mounted, open, calls, trigger };
  }

  v.it('opens on the confirm action, arrows move, Enter confirms', async () => {
    const { target, dispose, open, calls, trigger } = await alert();
    v.expect(open()).toBe(true);
    v.expect(focused()).toBe('OK');
    await press(target, 'ArrowLeft');
    v.expect(focused()).toBe('Cancel');
    // The ends of the row and the other axis keep focus in the dialog.
    await press(target, 'ArrowLeft', 'ArrowUp', 'ArrowDown');
    v.expect(focused()).toBe('Cancel');
    await press(target, 'ArrowRight');
    v.expect(focused()).toBe('OK');
    await press(target, 'Enter');
    v.expect(calls).toEqual(['confirm']);
    v.expect(open()).toBe(false);
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });

  v.it('Enter on Cancel cancels, and Back cancels', async () => {
    const { target, dispose, open, calls, trigger } = await alert();
    await press(target, 'ArrowLeft', 'Enter');
    v.expect(calls).toEqual(['cancel']);
    v.expect(open()).toBe(false);
    v.expect(lng.activeElement()).toBe(trigger);

    await press(target, 'Enter');
    v.expect(open()).toBe(true);
    await press(target, 'Escape');
    v.expect(calls).toEqual(['cancel', 'cancel']);
    v.expect(open()).toBe(false);
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });
});

v.describe('Menu with keys', () => {
  v.it(
    'opens on the first enabled item, passes disabled ones, Enter selects',
    async () => {
      const [open, setOpen] = createSignal(false);
      const picked: string[] = [];
      let trigger!: lng.ElementNode;
      const { target, dispose } = await mount(() => (
        <view width={1280} height={720}>
          {opener(
            (node) => (trigger = node),
            () => setOpen(true),
          )}
          <Menu
            visible={open}
            anchor={{ x: 40, y: 40, width: 120, height: 40 }}
            items={[
              { label: 'Off', disabled: true },
              { label: 'Rename', onSelect: () => picked.push('Rename') },
              { label: 'Locked', disabled: true },
              { label: 'Share', onSelect: () => picked.push('Share') },
            ]}
            onRequestClose={() => setOpen(false)}
          />
        </view>
      ));
      await press(target, 'Enter');
      v.expect(focused()).toBe('Rename');
      await press(target, 'ArrowUp');
      v.expect(focused()).toBe('Rename');
      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('Share');
      await press(target, 'ArrowDown', 'ArrowRight');
      v.expect(focused()).toBe('Share');
      await press(target, 'Enter');
      v.expect(picked).toEqual(['Share']);
      v.expect(open()).toBe(false);
      v.expect(lng.activeElement()).toBe(trigger);

      // Back closes without a choice.
      await press(target, 'Enter');
      v.expect(focused()).toBe('Rename');
      await press(target, 'Escape');
      v.expect(picked).toEqual(['Share']);
      v.expect(open()).toBe(false);
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    },
  );
});

v.describe('Select', () => {
  const OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
    { value: 'ja', label: 'Japanese' },
  ];

  v.it(
    'opens on the chosen option under the trigger, wherever it is nested',
    async () => {
      const [language, setLanguage] = createSignal('fr');
      let column!: lng.ElementNode;
      const { target, dispose } = await mount(() => (
        <view width={1280} height={720}>
          <view x={300} y={120} width={600} height={400}>
            <Column
              ref={(node) => (column = node)}
              x={40}
              y={30}
              width={400}
              gap={10}
              scroll="none"
              autofocus
            >
              <view width={200} height={50} onEnter={() => true} />
              <Select
                label="Language"
                value={language}
                options={OPTIONS}
                onChange={setLanguage}
              />
            </Column>
          </view>
        </view>
      ));
      await press(target, 'ArrowDown');
      const trigger = lng.activeElement()!;
      v.expect(trigger).toBe(column.children[1]);
      v.expect(texts(trigger)).toEqual(['French']);

      await press(target, 'Enter');
      v.expect(focused()).toBe('French');
      // The trigger is at (300 + 40, 120 + 30 + 50 + 10) and 48 high: the
      // menu is 8 below it, not at the scene's top-left corner.
      const menu = find(renderer.rootNode, (node) => node.role === 'menu')!;
      v.expect([menu.x, menu.y]).toEqual([340, 210 + 48 + 8]);

      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('Japanese');
      await press(target, 'Enter');
      v.expect(language()).toBe('ja');
      v.expect(lng.activeElement()).toBe(trigger);
      v.expect(texts(trigger)).toEqual(['Japanese']);

      // Back keeps the value.
      await press(target, 'Enter');
      v.expect(focused()).toBe('Japanese');
      await press(target, 'ArrowUp', 'Escape');
      v.expect(language()).toBe('ja');
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    },
  );

  v.it('keeps the menu inside the viewport', async () => {
    const [language, setLanguage] = createSignal('en');
    const height = viewport().height;
    const { target, dispose } = await mount(() => (
      <Column x={20} y={height - 60} width={400} scroll="none" autofocus>
        <Select
          label="Language"
          value={language}
          options={OPTIONS}
          onChange={setLanguage}
        />
      </Column>
    ));
    await press(target, 'Enter');
    v.expect(focused()).toBe('English');
    // No room below the trigger: the menu is above it, on screen.
    const menu = find(renderer.rootNode, (node) => node.role === 'menu')!;
    v.expect(menu.y).toBeGreaterThanOrEqual(0);
    v.expect(menu.y + menu.height).toBeLessThanOrEqual(height - 60);
    await press(target, 'Escape');
    dispose();
  });
});

v.describe('DatePicker with keys', () => {
  async function picker() {
    const [open, setOpen] = createSignal(false);
    const chosen: Date[] = [];
    let trigger!: lng.ElementNode;
    const mounted = await mount(() => (
      <view width={1280} height={720}>
        {opener(
          (node) => (trigger = node),
          () => setOpen(true),
        )}
        <DatePicker
          visible={open}
          value={new Date(2026, 0, 15)}
          onChange={(date) => chosen.push(date)}
          onRequestClose={() => setOpen(false)}
        />
      </view>
    ));
    await press(mounted.target, 'Enter');
    return { ...mounted, open, chosen, trigger };
  }
  const month = () =>
    texts(renderer.rootNode).find((text) => /\b20\d\d$/.test(text));

  v.it(
    'opens on the chosen day; arrows move by day and week; Enter selects',
    async () => {
      const { target, dispose, open, chosen, trigger } = await picker();
      v.expect(focused()).toBe('15');
      await press(target, 'ArrowRight');
      v.expect(focused()).toBe('16');
      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('23');
      await press(target, 'ArrowLeft', 'ArrowUp', 'ArrowUp');
      v.expect(focused()).toBe('8');
      await press(target, 'Enter');
      v.expect(lng.activeElement()!.ariaSelected).toBe(true);

      // Past the last week: the actions, Done first.
      await press(target, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown');
      v.expect(focused()).toBe('Done');
      await press(target, 'ArrowLeft');
      v.expect(focused()).toBe('Cancel');
      await press(target, 'ArrowRight', 'ArrowDown');
      v.expect(focused()).toBe('Done');
      await press(target, 'Enter');
      v.expect(chosen).toHaveLength(1);
      v.expect([
        chosen[0]!.getFullYear(),
        chosen[0]!.getMonth(),
        chosen[0]!.getDate(),
      ]).toEqual([2026, 0, 8]);
      v.expect(open()).toBe(false);
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    },
  );

  v.it(
    'the header changes month with Left, Right and Enter; days cross months',
    async () => {
      const { target, dispose, open, chosen, trigger } = await picker();
      v.expect(month()).toBe('January 2026');
      // 15 → 8 → 1, then above the first week is the header.
      await press(target, 'ArrowUp', 'ArrowUp', 'ArrowUp');
      v.expect(lng.activeElement()!.ariaLabel).toBe('Previous month');
      await press(target, 'Enter');
      v.expect(month()).toBe('December 2025');
      await press(target, 'ArrowLeft');
      v.expect(month()).toBe('November 2025');
      await press(target, 'ArrowRight');
      v.expect(lng.activeElement()!.ariaLabel).toBe('Next month');
      v.expect(month()).toBe('November 2025');
      await press(target, 'ArrowRight', 'ArrowRight');
      v.expect(month()).toBe('January 2026');

      // Back to the days: the chosen one; Left from the 1st is the 31st.
      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('15');
      await press(target, 'ArrowUp', 'ArrowUp');
      v.expect(focused()).toBe('1');
      await press(target, 'ArrowLeft');
      v.expect(month()).toBe('December 2025');
      v.expect(focused()).toBe('31');
      v.expect(lng.activeElement()!.destroyed).toBeFalsy();
      await press(target, 'ArrowRight');
      v.expect(month()).toBe('January 2026');
      v.expect(focused()).toBe('1');
      v.expect(lng.activeElement()!.destroyed).toBeFalsy();

      await press(target, 'Escape');
      v.expect(chosen).toEqual([]);
      v.expect(open()).toBe(false);
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    },
  );
});

v.describe('Drawer, Sheet and Popover without initialFocus', () => {
  const anchor = { x: 40, y: 40, width: 120, height: 40 };
  const content = () => (
    <Column gap={10} scroll="none">
      <view width={200} height={50} onEnter={() => true}>
        <text>First</text>
      </view>
      <view width={200} height={50} onEnter={() => true}>
        <text>Second</text>
      </view>
    </Column>
  );

  for (const [name, Surface] of [
    ['Drawer', Drawer],
    ['Sheet', Sheet],
    ['Popover', Popover],
  ] as const) {
    v.it(`${name}: focus opens in the content and arrows move`, async () => {
      const [open, setOpen] = createSignal(false);
      let trigger!: lng.ElementNode;
      const { target, dispose } = await mount(() => (
        <view width={1280} height={720}>
          {opener(
            (node) => (trigger = node),
            () => setOpen(true),
          )}
          <Surface
            visible={open}
            label={name}
            anchor={anchor}
            onRequestClose={() => setOpen(false)}
          >
            {content()}
          </Surface>
        </view>
      ));
      await press(target, 'Enter');
      v.expect(focused()).toBe('First');
      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('Second');
      await press(target, 'ArrowDown', 'ArrowUp');
      v.expect(focused()).toBe('First');
      await press(target, 'Escape');
      v.expect(open()).toBe(false);
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    });
  }

  v.it(
    'an initialFocus that names nothing still moves focus inside',
    async () => {
      const [open, setOpen] = createSignal(false);
      let trigger!: lng.ElementNode;
      const { target, dispose } = await mount(() => (
        <view width={1280} height={720}>
          {opener(
            (node) => (trigger = node),
            () => setOpen(true),
          )}
          <Drawer
            visible={open}
            label="Drawer"
            initialFocus={() => undefined}
            onRequestClose={() => setOpen(false)}
          >
            {content()}
          </Drawer>
        </view>
      ));
      await press(target, 'Enter');
      v.expect(focused()).toBe('First');
      await press(target, 'Escape');
      v.expect(lng.activeElement()).toBe(trigger);
      dispose();
    },
  );

  v.it('an empty Popover keeps focus, so that Back closes it', async () => {
    const [open, setOpen] = createSignal(false);
    let trigger!: lng.ElementNode;
    const { target, dispose } = await mount(() => (
      <view width={1280} height={720}>
        {opener(
          (node) => (trigger = node),
          () => setOpen(true),
        )}
        <Popover
          visible={open}
          label="Empty"
          anchor={anchor}
          onRequestClose={() => setOpen(false)}
        />
      </view>
    ));
    await press(target, 'Enter');
    v.expect(lng.activeElement()).not.toBe(trigger);
    await press(target, 'Escape');
    v.expect(open()).toBe(false);
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });
});

v.describe('RadioGroup', () => {
  v.it(
    'is a row of a Column: arrows pass through it, Enter selects one',
    async () => {
      const [quality, setQuality] = createSignal('HD');
      let column!: lng.ElementNode;
      const { target, dispose } = await mount(() => (
        <Column
          ref={(node) => (column = node)}
          width={400}
          gap={10}
          scroll="none"
          autofocus
        >
          <view width={200} height={50} onEnter={() => true}>
            <text>Above</text>
          </view>
          <RadioGroup
            value={quality}
            options={[
              { value: 'SD', label: 'SD' },
              { value: 'HD', label: 'HD' },
              { value: '4K', label: '4K' },
            ]}
            onChange={setQuality}
          />
          <view width={200} height={50} onEnter={() => true}>
            <text>Below</text>
          </view>
        </Column>
      ));
      const group = column.children[1] as lng.ElementNode;
      const checked = () =>
        group.children
          .filter((radio) => (radio as lng.ElementNode).ariaChecked === true)
          .map((radio) => (radio as lng.ElementNode).ariaLabel);

      // Sized by its three 48-high rows and two 4-wide gaps, and laid out.
      v.expect(group.height).toBe(152);
      v.expect(group.y).toBe(60);
      v.expect((column.children[2] as lng.ElementNode).y).toBe(60 + 152 + 10);

      v.expect(focused()).toBe('Above');
      await press(target, 'ArrowDown');
      v.expect(lng.activeElement()!.ariaLabel).toBe('HD');
      await press(target, 'ArrowDown');
      v.expect(lng.activeElement()!.ariaLabel).toBe('4K');
      await press(target, 'Enter');
      v.expect(quality()).toBe('4K');
      v.expect(checked()).toEqual(['4K']);
      await press(target, 'ArrowDown');
      v.expect(focused()).toBe('Below');
      await press(target, 'ArrowUp');
      v.expect(lng.activeElement()!.ariaLabel).toBe('4K');
      await press(target, 'ArrowUp', 'ArrowUp');
      v.expect(lng.activeElement()!.ariaLabel).toBe('SD');
      await press(target, 'Enter');
      v.expect(quality()).toBe('SD');
      v.expect(checked()).toEqual(['SD']);
      await press(target, 'ArrowUp');
      v.expect(focused()).toBe('Above');
      dispose();
    },
  );
});
