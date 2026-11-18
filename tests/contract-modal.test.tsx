import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { Modal } from '@solid-multiplatform/platform/primitives';
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

    setOpen(false);
    await waitForUpdate();
    await flush();
    v.expect(lng.activeElement()).toBe(trigger);
    dispose();
  });
});
