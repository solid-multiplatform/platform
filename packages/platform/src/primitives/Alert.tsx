import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { useTheme } from '../sdk/theme.jsx';
import { supports } from '../sdk/capabilities.js';
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
  /**
   * The confirm action destroys something: Apple draws a destructive alert
   * action in the danger colour, and it still sits trailing.
   */
  destructive?: boolean;
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
  // Apple's alert is a compact card (270 pt on a phone), not a wide dialog:
  // the text decides the height, within the safe area.
  // A ten-foot alert is not a phone card: the same content, a larger box.
  const tv = () => supports('remote');
  const width = () =>
    tv()
      ? Math.min(760, viewport().width - 160)
      : Math.min(360, viewport().width - 48);
  const actionHeight = () => (tv() ? 72 : 52);
  const titleSize = () =>
    tv() ? 40 : Math.min(24, theme().typography.label + 6);
  const bodySize = () =>
    tv() ? 28 : Math.min(19, theme().typography.label + 1);
  const messageLines = () => {
    const message = props.message ?? '';
    if (message === '') return 0;
    const perLine = Math.max(
      12,
      Math.floor((width() - 48) / (bodySize() * 0.52)),
    );
    let lines = 0;
    for (const line of message.split('\n'))
      lines += Math.max(1, Math.ceil(line.length / perLine));
    return lines;
  };
  const height = () => {
    const text =
      28 + titleSize() + 10 + messageLines() * Math.round(bodySize() * 1.35);
    const actions = actionHeight() + 24;
    return Math.min(
      viewport().height -
        viewport().insets.safeArea.top -
        viewport().insets.safeArea.bottom -
        32,
      Math.max(tv() ? 240 : 150, text + actions + 44),
    );
  };
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
      dismissOnBackdrop={false}
      initialFocus={props.initialFocus ?? (() => actions)}
    >
      <view
        x={(viewport().width - width()) / 2}
        y={Math.max(
          viewport().insets.safeArea.top + 16,
          (viewport().height - height()) / 2,
        )}
        width={width()}
        height={height()}
        color={0x1d2937ff}
        borderRadius={theme().radius.medium}
        onMouseClick={() => true}
      >
        <text
          x={24}
          y={24}
          width={width() - 48}
          contain="width"
          fontSize={titleSize()}
          color={0xf2f6faff}
        >
          {props.title}
        </text>
        {props.message ? (
          <text
            x={24}
            y={24 + titleSize() + 14}
            width={width() - 48}
            height={messageLines() * Math.round(bodySize() * 1.35) + 4}
            contain="width"
            fontSize={bodySize()}
            color={0xa6b4c4ff}
          >
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
          x={24}
          y={height() - actionHeight() - 24}
          width={width() - 48}
          height={actionHeight()}
          gap={12}
          selected={1}
          scroll="none"
        >
          <view
            width={(width() - 60) / 2}
            height={actionHeight()}
            style={CANCEL_STYLE}
            role="button"
            ariaLabel={props.cancelLabel ?? 'Cancel'}
            onEnter={cancel}
            onMouseClick={cancel}
          >
            <text
              x={16}
              y={tv() ? 20 : 14}
              width={(width() - 60) / 2 - 32}
              contain="width"
              fontSize={tv() ? 26 : 18}
              color={0xf2f6faff}
            >
              {props.cancelLabel ?? 'Cancel'}
            </text>
          </view>
          <view
            width={(width() - 60) / 2}
            height={actionHeight()}
            style={CONFIRM_STYLE}
            role="button"
            ariaLabel={props.confirmLabel ?? 'OK'}
            onEnter={confirm}
            onMouseClick={confirm}
          >
            <text
              x={16}
              y={tv() ? 20 : 14}
              width={(width() - 60) / 2 - 32}
              contain="width"
              fontSize={tv() ? 26 : 18}
              color={props.destructive ? theme().colors.danger : 0xffffffff}
            >
              {props.confirmLabel ?? 'OK'}
            </text>
          </view>
        </Row>
      </view>
    </Modal>
  );
}
