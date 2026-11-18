import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { activeElement } from '../core/activeElement.js';
import { pushFocusTrap } from '../core/focusManager.js';
import { viewport } from '../sdk/viewport.js';
import { Portal } from './portal.jsx';

export interface ModalProps {
  /** Controlled visibility. Pass an accessor to follow application state. */
  visible: boolean | (() => boolean);
  /** Called for the hardware Back key, Escape, or a barrier tap. */
  onRequestClose?(): void;
  /** Draw the application behind the modal instead of an opaque backdrop. */
  transparent?: boolean;
  /** Backdrop colour when not transparent. 0xRRGGBBAA. */
  barrierColor?: number;
  /** Inset the panel by the host safe area. Defaults to true. */
  useSafeArea?: boolean;
  /** Accessible name for the dialog. */
  label: string;
  /** Element to focus when the modal opens; defaults to the dialog itself. */
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  /** Tapping the backdrop requests close. Defaults to true. */
  dismissOnBackdrop?: boolean;
  ref?: (node: ElementNode) => void;
  children?: JSX.Element;
}

/**
 * A modal surface with the established behaviour shared by React Native's
 * `Modal`, Flutter's `showDialog` and the HTML `<dialog>` element:
 *
 * - renders above the scene through a portal;
 * - restores the previously focused element on close;
 * - calls `onRequestClose` for Back/Escape and (optionally) a barrier tap;
 * - respects the host safe area unless `useSafeArea` is false.
 *
 * The scene's focus manager keeps focus inside the panel because the opening
 * focus is the panel or an explicit `initialFocus` child.
 */
export function Modal(props: ModalProps): JSX.Element {
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  let dialog: ElementNode | undefined;
  let previous: ElementNode | undefined;
  let releaseTrap: (() => void) | undefined;
  let open = false;

  createEffect(() => {
    if (visible()) {
      if (open) return;
      open = true;
      previous = activeElement();
      queueMicrotask(() => {
        if (dialog && !releaseTrap) releaseTrap = pushFocusTrap(dialog);
        const focus = props.initialFocus;
        const target =
          typeof focus === 'function' ? focus() : focus ?? dialog;
        target?.setFocus();
      });
    } else if (open) {
      open = false;
      releaseTrap?.();
      releaseTrap = undefined;
      previous?.setFocus();
      previous = undefined;
    }
  });

  onCleanup(() => {
    releaseTrap?.();
    releaseTrap = undefined;
    if (open) previous?.setFocus();
  });

  const close = () => props.onRequestClose?.();
  const key = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' ||
      event.key === 'Backspace' ||
      event.key === 'GoBack'
    ) {
      close();
      return true;
    }
    return false;
  };

  return (
    <Show when={visible()}>
      <Portal>
        <view
          ref={(node) => {
            dialog = node as ElementNode;
            props.ref?.(node as ElementNode);
          }}
          width={viewport().width}
          height={viewport().height}
          color={props.transparent ? (props.barrierColor ?? 0x00000000) : (props.barrierColor ?? 0x000000cc)}
          onKeyPress={key}
          onMouseClick={
            props.dismissOnBackdrop === false
              ? undefined
              : () => {
                  // A barrier tap only closes when the tap is not inside the
                  // panel; the panel's own handlers stop before this one.
                  close();
                }
          }
        >
          <view
            x={props.useSafeArea === false ? 0 : viewport().insets.safeArea.left}
            y={props.useSafeArea === false ? 0 : viewport().insets.safeArea.top}
            width={
              viewport().width -
              (props.useSafeArea === false
                ? 0
                : viewport().insets.safeArea.left +
                  viewport().insets.safeArea.right)
            }
            height={
              viewport().height -
              (props.useSafeArea === false
                ? 0
                : viewport().insets.safeArea.top +
                  viewport().insets.safeArea.bottom)
            }
          >
            {props.children}
          </view>
        </view>
      </Portal>
    </Show>
  );
}
