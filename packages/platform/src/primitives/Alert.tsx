import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';

export interface AlertProps {
  visible: boolean | (() => boolean);
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?(): void;
  onCancel?(): void;
  onRequestClose?(): void;
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  children?: JSX.Element;
}

/**
 * Confirmation dialog in the shape of React Native's `Alert` and Flutter's
 * `AlertDialog`: a title, a message, and at most a cancel and confirm action.
 * It uses the shared `Modal` focus trap, safe area and Back/Escape handling.
 */
export function Alert(props: AlertProps): JSX.Element {
  const width = () => Math.min(640, viewport().width - 64);
  const confirm = () => {
    props.onConfirm?.();
    props.onRequestClose?.();
  };
  const cancel = () => {
    props.onCancel?.();
    props.onRequestClose?.();
  };
  return (
    <Modal
      visible={props.visible}
      onRequestClose={cancel}
      label={props.title}
      role="alertdialog"
      initialFocus={props.initialFocus}
    >
      <view
        x={(viewport().width - width()) / 2}
        y={Math.max(
          viewport().insets.safeArea.top + 48,
          viewport().height / 2 - 180,
        )}
        width={width()}
        height={360}
        color={0x1d2937ff}
        onMouseClick={() => true}
      >
        <text x={28} y={28} fontSize={32} color={0xf2f6faff}>
          {props.title}
        </text>
        {props.message ? (
          <text x={28} y={86} width={width() - 56} fontSize={22} color={0xa6b4c4ff}>
            {props.message}
          </text>
        ) : null}
        {props.children}
        <view
          x={width() - 300}
          y={280}
          width={130}
          height={52}
          color={0x2f3d4eff}
          onEnter={cancel}
          onMouseClick={cancel}
        >
          <text x={16} y={14} fontSize={20} color={0xf2f6faff}>
            {props.cancelLabel ?? 'Cancel'}
          </text>
        </view>
        <view
          x={width() - 158}
          y={280}
          width={130}
          height={52}
          color={0x2563ebff}
          onEnter={confirm}
          onMouseClick={confirm}
        >
          <text x={16} y={14} fontSize={20} color={0xffffffff}>
            {props.confirmLabel ?? 'OK'}
          </text>
        </view>
      </view>
    </Modal>
  );
}
