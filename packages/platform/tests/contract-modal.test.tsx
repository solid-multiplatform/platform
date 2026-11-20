import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  Alert,
  Drawer,
  Menu,
  Modal,
  Popover,
  Sheet,
  Toast,
  Tooltip,
} from '@solid-multiplatform/platform/primitives';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { createScenePointer } from '../src/sdk/input.js';
import { renderer, waitForUpdate } from './setup.js';
import { mount } from './contract-focus-helpers.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const findAll = (
  node: unknown,
  predicate: (node: lng.ElementNode) => boolean,
  found: lng.ElementNode[] = [],
): lng.ElementNode[] => {
  if (!lng.isINode(node)) return found;
  if (lng.isElementNode(node) && predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
};

v.describe('Modal', () => {
  v.it('moves focus into the panel and restores it on close', async () => {
    const [open, setOpen] = createSignal(false);
    let trigger!: lng.ElementNode;
    let panel!: lng.ElementNode;

    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <>
          <view
            ref={(node) => (trigger = node as lng.ElementNode)}
            width={100}
            height={40}
            autofocus
          />
          <Modal visible={open} label="Confirm" initialFocus={() => panel}>
            <view
              ref={(node) => (panel = node as lng.ElementNode)}
              width={320}
              height={200}
            />
          </Modal>
        </>
      );
    });

    await waitForUpdate();
    trigger.setFocus();
    await flush();
    v.expect(lng.activeElement()).toBe(trigger);

    setOpen(true);
    await waitForUpdate();
    await flush();
    v.expect(lng.activeElement()).toBe(panel);

    // The trap rejects focus on elements outside the dialog.
    trigger.setFocus();
    await flush();
    v.expect(lng.activeElement()).toBe(panel);

    setOpen(false);
    await waitForUpdate();
    await flush();
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });
});

v.describe('Toast', () => {
  v.it('runs onDismiss after its duration', async () => {
    const [open, setOpen] = createSignal(true);
    let dismissed = 0;
    const dispose = renderer.render(() => (
      <Toast
        visible={open}
        message="Saved"
        duration={20}
        onDismiss={() => {
          dismissed++;
          setOpen(false);
        }}
      />
    ));
    v.expect(open()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    v.expect(dismissed).toBe(1);
    v.expect(open()).toBe(false);
    dispose();
  });
});

v.describe('overlay primitives', () => {
  v.it(
    'mounts Alert, Popover, Menu and Tooltip without a focus trap leak',
    async () => {
      const anchor = { x: 40, y: 40, width: 120, height: 40 };
      const dispose = renderer.render(() => (
        <>
          <Alert visible title="Delete?" message="This cannot be undone" />
          <Popover visible anchor={anchor} label="Filters">
            <view width={100} height={40} />
          </Popover>
          <Menu
            visible
            anchor={anchor}
            items={[{ label: 'One' }, { label: 'Two', disabled: true }]}
          />
          <Tooltip visible anchor={anchor} label="Hint" />
        </>
      ));
      await waitForUpdate();
      dispose();
    },
  );
});

v.describe('Drawer', () => {
  v.it(
    'reaches the close button from the content and Enter closes it',
    async () => {
      const [open, setOpen] = createSignal(true);
      const { target, dispose } = await mount(() => (
        <Drawer
          visible={open}
          label="Navigation"
          onRequestClose={() => setOpen(false)}
        >
          <view width={200} height={40} onEnter={() => {}} />
        </Drawer>
      ));
      await flush();
      await flush();
      // Without an initialFocus the drawer opens in the app's content.
      const first = lng.activeElement();
      v.expect(first).toBeDefined();
      v.expect(first?.ariaLabel).not.toBe('Close');

      // Down past the content reaches the close button; Enter activates it.
      target.down('ArrowDown');
      target.up('ArrowDown');
      await flush();
      v.expect(lng.activeElement()?.ariaLabel).toBe('Close');

      target.down('Enter');
      target.up('Enter');
      await flush();
      v.expect(open()).toBe(false);
      dispose();
    },
  );

  v.it(
    'reaches the close button from the content and Enter closes it after moving up',
    async () => {
      const [open, setOpen] = createSignal(true);
      const { target, dispose } = await mount(() => (
        <Drawer
          visible={open}
          label="Navigation"
          onRequestClose={() => setOpen(false)}
        >
          <view width={200} height={40} onEnter={() => {}} />
        </Drawer>
      ));
      await flush();
      await flush();
      target.down('ArrowDown');
      target.up('ArrowDown');
      await flush();
      v.expect(lng.activeElement()?.ariaLabel).toBe('Close');
      target.down('ArrowUp');
      target.up('ArrowUp');
      await flush();
      v.expect(lng.activeElement()?.ariaLabel).not.toBe('Close');
      dispose();
    },
  );

  v.it('traps focus in the panel and restores the trigger', async () => {
    const [open, setOpen] = createSignal(false);
    let trigger!: lng.ElementNode;
    let panel!: lng.ElementNode;

    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <>
          <view ref={trigger} width={100} height={40} autofocus />
          <Drawer
            visible={open}
            label="Navigation"
            initialFocus={() => panel}
            onRequestClose={() => setOpen(false)}
          >
            <view ref={panel} width={200} height={40} />
          </Drawer>
        </>
      );
    });

    await waitForUpdate();
    trigger.setFocus();
    await flush();
    v.expect(lng.activeElement()).toBe(trigger);

    setOpen(true);
    await waitForUpdate();
    await flush();
    v.expect(lng.activeElement()).toBe(panel);

    // Focus outside the drawer is rejected while it is open.
    trigger.setFocus();
    await flush();
    v.expect(lng.activeElement()).toBe(panel);

    setOpen(false);
    await waitForUpdate();
    await flush();
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });
});

v.describe('dialog surfaces', () => {
  v.it('all use the theme radius', async () => {
    const theme = lng.useTheme();
    const dispose = renderer.render(() => (
      <>
        <Alert visible title="Title" message="Message" />
        <Sheet visible label="Sheet">
          <view width={10} height={10} />
        </Sheet>
        <Popover
          visible
          anchor={{ x: 0, y: 0, width: 10, height: 10 }}
          label="Popover"
        >
          <view width={10} height={10} />
        </Popover>
        <Drawer visible label="Drawer">
          <view width={10} height={10} />
        </Drawer>
        {/* The modal's own surface: the panel an app puts in it honours the
            theme radius the way Alert's does, and Modal leaves it alone. */}
        <Modal visible label="Modal">
          <view
            width={480}
            height={260}
            color={0x142235ff}
            borderRadius={theme.radius.medium}
          />
        </Modal>
      </>
    ));
    await waitForUpdate();
    const find = (predicate: (node: lng.ElementNode) => boolean) =>
      findAll(renderer.rootNode, predicate)[0]!;

    const alert = find(
      (node) => node.color === 0x1d2937ff && node.width === 360,
    );
    const sheet = find(
      (node) => node.color === 0x1d2937ff && node.width === 1920,
    );
    const popover = find(
      (node) => node.color === 0x1d2937ff && node.width === 280,
    );
    const drawer = find((node) => node.width === 360 && node.height === 1080);

    const modal = find((node) => node.color === 0x142235ff);
    v.expect(modal.borderRadius).toBe(theme.radius.medium);
    v.expect(alert.borderRadius).toBe(theme.radius.medium);
    v.expect(popover.borderRadius).toBe(theme.radius.medium);
    v.expect(sheet.borderRadius).toEqual([
      theme.radius.medium,
      theme.radius.medium,
      0,
      0,
    ]);
    v.expect(drawer.borderRadius).toEqual([
      0,
      theme.radius.medium,
      theme.radius.medium,
      0,
    ]);
    dispose();
  });
});

v.describe('Tooltip', () => {
  v.it(
    'is not a pointer or focus target, even around interactive children',
    async () => {
      const pressed: string[] = [];
      const dispose = renderer.render(() => (
        <view width={1920} height={1080}>
          <Tooltip
            visible
            placement="bottom"
            anchor={{ x: 100, y: 100, width: 300, height: 38 }}
            label="Hint"
          >
            <view
              width={300}
              height={38}
              onEnter={() => pressed.push('tooltip')}
            />
          </Tooltip>
        </view>
      ));
      await waitForUpdate();
      const pointer = createScenePointer(lng.rootNode);
      pointer.down(1, { x: 110, y: 160 });
      pointer.up(1, { x: 110, y: 160 });
      await waitForUpdate();
      v.expect(pressed).toEqual([]);
      pointer.dispose();
      dispose();
    },
  );
});
