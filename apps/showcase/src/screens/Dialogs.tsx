/** Modal surfaces: Modal, Alert, Drawer and DatePicker. Back closes each. */
import { createSignal, onCleanup } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import {
  Alert,
  Column,
  DatePicker,
  Drawer,
  Modal,
} from '@solid-multiplatform/platform/primitives';
import { viewport } from '@solid-multiplatform/platform/viewport';
import { probeHooks } from '../probe/hooks';
import { Button, MUTED, PANEL, Screen, TEXT } from '../ui';

type Surface = 'modal' | 'alert' | 'drawer' | 'date' | undefined;

export function DialogsScreen() {
  const [open, setOpen] = createSignal<Surface>();
  const [last, setLast] = createSignal('nothing yet');
  const close = () => setOpen(undefined);
  const finish = (what: string) => {
    setLast(what);
    close();
  };
  let confirm: ElementNode | undefined;
  let drawerFirst: ElementNode | undefined;

  probeHooks.modalOpen = () => open() === 'modal';
  onCleanup(() => {
    probeHooks.modal = undefined;
    probeHooks.modalOpener = undefined;
    probeHooks.modalOpen = undefined;
  });

  return (
    <Screen
      title="Modal, Alert, Drawer, DatePicker"
      overlays={
        <>
          <Modal
            visible={() => open() === 'modal'}
            label="Example modal"
            onRequestClose={() => finish('modal: closed')}
            initialFocus={() => confirm}
            ref={(node) => {
              probeHooks.modal = node;
            }}
          >
            <view
              x={(viewport().width - 480) / 2}
              y={(viewport().height - 260) / 2}
              width={480}
              height={260}
              color={PANEL}
              borderRadius={12}
              onMouseClick={() => true}
            >
              <text x={24} y={20} fontSize={28} color={TEXT}>
                Example modal
              </text>
              <text x={24} y={64} fontSize={18} color={MUTED}>
                Focus stays in here. Back closes it.
              </text>
              <Column x={24} y={112} gap={12} scroll="none">
                <Button
                  ref={(node) => {
                    confirm = node;
                  }}
                  label="Confirm"
                  onEnter={() => finish('modal: confirmed')}
                />
                <Button label="Close" onEnter={() => finish('modal: closed')} />
              </Column>
            </view>
          </Modal>
          <Alert
            visible={() => open() === 'alert'}
            title="Example alert"
            message="An alert has a title, a message and at most two actions."
            confirmLabel="OK"
            cancelLabel="Cancel"
            onConfirm={() => setLast('alert: confirmed')}
            onCancel={() => setLast('alert: cancelled')}
            onRequestClose={close}
          />
          <Drawer
            visible={() => open() === 'drawer'}
            label="Example drawer"
            onRequestClose={() => finish('drawer: closed')}
            initialFocus={() => drawerFirst}
          >
            <Column x={24} y={96} gap={12} scroll="none">
              <Button
                ref={(node) => {
                  drawerFirst = node;
                }}
                label="First action"
                onEnter={() => finish('drawer: first action')}
              />
              <Button
                label="Second action"
                onEnter={() => finish('drawer: second action')}
              />
            </Column>
          </Drawer>
          <DatePicker
            visible={() => open() === 'date'}
            title="Pick a date"
            onChange={(date) =>
              setLast(
                `date: ${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
              )
            }
            onRequestClose={close}
          />
        </>
      }
    >
      <Button
        ref={(node) => {
          probeHooks.modalOpener = node;
        }}
        label="Open modal"
        onEnter={() => setOpen('modal')}
      />
      <Button label="Open alert" onEnter={() => setOpen('alert')} />
      <Button label="Open drawer" onEnter={() => setOpen('drawer')} />
      <Button label="Pick a date" onEnter={() => setOpen('date')} />
      <text
        skipFocus
        role="status"
        ariaLabel={`Last result: ${last()}`}
        fontSize={22}
        color={MUTED}
      >
        {`Last result: ${last()}`}
      </text>
      <text skipFocus fontSize={16} color={MUTED}>
        Every surface takes the arrows and Enter, keeps focus inside while it is
        open, closes on Back and hands focus back to its button.
      </text>
    </Screen>
  );
}
