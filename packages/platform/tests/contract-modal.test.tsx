import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import {
  Alert,
  Drawer,
  Menu,
  Modal,
  Popover,
  Toast,
  Tooltip,
} from '@solid-multiplatform/platform/primitives';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { renderer, waitForUpdate } from './setup.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
