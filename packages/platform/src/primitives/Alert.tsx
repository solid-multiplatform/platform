import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import { Modal } from './Modal.jsx';
import { Row } from './Row.jsx';

// The focused action is the lighter one.
const CANCEL_STYLE: NodeStyles = {
  color: 0x2f3d4eff,
  $focus: { color: 0x5b7088ff },
};
const CONFIRM_STYLE: NodeStyles = {
  color: 0x1d4fbfff,
  $focus: { color: 0x4f8dffff },
};

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
  const theme = () => useTheme();
  const width = () => Math.min(640, viewport().width - 64);
  let actions: ElementNode | undefined;
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
      initialFocus={props.initialFocus ?? (() => actions)}
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
        borderRadius={theme().radius.medium}
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
        {/* The two actions are a Row: Left and Right move between them and
            Enter activates. Focus opens on the confirm action. */}
        <Row
          ref={(node) => {
            actions = node;
          }}
          x={width() - 300}
          y={280}
          width={272}
          height={52}
          gap={12}
          selected={1}
          scroll="none"
        >
          <view
            width={130}
            height={52}
            style={CANCEL_STYLE}
            role="button"
            ariaLabel={props.cancelLabel ?? 'Cancel'}
            onEnter={cancel}
            onMouseClick={cancel}
          >
            <text x={16} y={14} fontSize={20} color={0xf2f6faff}>
              {props.cancelLabel ?? 'Cancel'}
            </text>
          </view>
          <view
            width={130}
            height={52}
            style={CONFIRM_STYLE}
            role="button"
            ariaLabel={props.confirmLabel ?? 'OK'}
            onEnter={confirm}
            onMouseClick={confirm}
          >
            <text x={16} y={14} fontSize={20} color={0xffffffff}>
              {props.confirmLabel ?? 'OK'}
            </text>
          </view>
        </Row>
      </view>
    </Modal>
  );
}
