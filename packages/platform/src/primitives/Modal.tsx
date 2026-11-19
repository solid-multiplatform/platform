import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { activeElement } from '../core/activeElement.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { pushFocusTrap } from '../core/focusManager.js';
import { isElementNode } from '../core/utils.js';
import { viewport } from '../sdk/viewport.js';
import { Portal } from './portal.jsx';

// Focus on the dialog goes to its content: the first child of the safe-area
// view that takes focus. With none the dialog keeps it, so that Back closes.
const focusPanel: ForwardFocusHandler = function () {
  const content = this.children[0];
  if (!isElementNode(content)) return false;
  const children = content.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElementNode(child) && !child.skipFocus) {
      child.setFocus();
      return true;
    }
  }
  return false;
};

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
  /** `alertdialog` for a message that interrupts. Defaults to `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /**
   * Element to focus when the modal opens. Defaults to the modal's first
   * child that takes focus (a `Row` or `Column` passes it on to its own),
   * and to the dialog itself when there is none.
   */
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
        // An `initialFocus` that names nothing (a ref not set) leaves focus
        // to the dialog, which hands it to its content: never outside.
        const target =
          (typeof focus === 'function' ? focus() : focus) ?? dialog;
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
          role={props.role ?? 'dialog'}
          forwardFocus={focusPanel}
          ariaLabel={props.label}
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
