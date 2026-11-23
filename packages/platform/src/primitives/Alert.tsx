import { For, Show, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import { supports } from '../sdk/capabilities.js';
import { useUiScale } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Column } from './Column.jsx';
import { OVERLAY_FADE_IN, overlayEnter, overlayExit } from './FadeInOut.jsx';
import { Modal } from './Modal.jsx';
import { Row } from './Row.jsx';

// UIAlertController's .alert presentation: the card fades in with a slight
// scale-up about its own centre — the default pivot (0.5, 0.5) — and closes
// the same way. It lands exactly on the static layout.
const ENTER = { alpha: OVERLAY_FADE_IN, scale: 0.96 };
const EXIT = { alpha: 0, scale: 0.96 };
const MOTION = { duration: 250, easing: 'ease-in-out' };

export interface AlertAction {
  label: string;
  /** `cancel` is the leading safe exit; destructive is drawn in red. */
  style?: 'default' | 'cancel' | 'destructive';
  disabled?: boolean;
  onPress?(): void;
}

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
  /**
   * Which action Return (or a focused-action Enter) should take by default.
   * A destructive confirmation defaults to Cancel, so the dangerous action
   * is never one accidental Return away.
   */
  defaultAction?: 'confirm' | 'cancel';
  /**
   * Replace the two convenience actions with an explicit one-to-three action
   * list. Three actions stack vertically, as UIKit does.
   */
  actions?: AlertAction[];
  onConfirm?(): void;
  onCancel?(): void;
  onRequestClose?(): void;
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  children?: JSX.Element;
}

/**
 * Confirmation dialog in Apple's alert shape: a compact card (270 pt on a
 * phone), a centred title and message, and at most two actions as text in a
 * row separated by hairlines. Cancel is leading, the default action is
 * trailing, and a destructive action takes the danger colour. The card is
 * content-sized and clamped to the safe area; it never uses a fixed height
 * that puts its actions below a short screen.
 *
 * It uses the shared `Modal` focus trap, safe area and Back/Escape handling.
 */
export function Alert(props: AlertProps): JSX.Element {
  const theme = useTheme();
  const scale = useUiScale();
  const u = (value: number) => Math.round(value * scale);
  const tv = () => supports('remote');

  // Apple's alert is 270 pt on a phone. A ten-foot alert is the same card
  // with larger type, not a wide dialog.
  const width = () => {
    const room = Math.max(
      0,
      viewport().width -
        viewport().insets.safeArea.left -
        viewport().insets.safeArea.right -
        u(32),
    );
    return Math.min(
      room,
      Math.max(u(220), Math.min(tv() ? u(560) : u(270), room)),
    );
  };
  const padding = () => u(tv() ? 28 : 20);
  const titleSize = () => u(tv() ? 32 : 17);
  const bodySize = () => u(tv() ? 24 : 13);
  const titleLine = () => Math.round(titleSize() * 1.3);
  const bodyLine = () => Math.round(bodySize() * 1.35);
  const actionHeight = () => u(tv() ? 64 : 44);
  const separator = () => Math.max(1, u(1));
  const contentGap = () => u(tv() ? 10 : 4);
  const textWidth = () => width() - padding() * 2;

  const wrappedLines = (text: string, size: number, available: number) => {
    if (text === '') return 0;
    // No text measurement is available in a dialog that opens before fonts
    // load; the estimate is the same one the framework uses elsewhere. It is
    // deliberately generous (a wide glyph per character) so a line is not
    // under-counted and cut off.
    const perLine = Math.max(8, Math.floor(available / (size * 0.54)));
    let lines = 0;
    for (const paragraph of text.split('\n'))
      lines += Math.max(1, Math.ceil(paragraph.length / perLine));
    return lines;
  };

  const titleLines = () =>
    Math.max(
      1,
      Math.min(3, wrappedLines(props.title, titleSize(), textWidth())),
    );
  const messageLines = () => {
    const message = props.message ?? '';
    return Math.min(
      tv() ? 12 : 8,
      wrappedLines(message, bodySize(), textWidth()),
    );
  };
  const availableHeight = () =>
    Math.max(
      0,
      viewport().height -
        viewport().insets.safeArea.top -
        Math.max(
          viewport().insets.safeArea.bottom,
          viewport().insets.ime.bottom,
        ) -
        u(32),
    );
  const confirm = () => props.onConfirm?.();
  const cancel = () => props.onCancel?.();
  const requestCancel = () => {
    cancel();
    props.onRequestClose?.();
  };
  const actionItems = (): AlertAction[] =>
    props.actions !== undefined
      ? [...props.actions]
      : [
          {
            label: props.cancelLabel ?? 'Cancel',
            style: 'cancel',
            onPress: cancel,
          },
          {
            label: props.confirmLabel ?? 'OK',
            style: props.destructive === true ? 'destructive' : 'default',
            onPress: confirm,
          },
        ];
  const stacked = () => actionItems().length > 2;
  const actionAreaHeight = () => {
    const count = actionItems().length;
    if (count === 0) return 0;
    const rows = stacked()
      ? count * actionHeight() + (count - 1) * separator()
      : actionHeight();
    return separator() + rows;
  };
  const contentHeight = () =>
    padding() * 2 +
    titleLines() * titleLine() +
    (messageLines() > 0 ? contentGap() + messageLines() * bodyLine() : 0) +
    (props.children === undefined ? 0 : u(72));
  const height = () =>
    Math.max(
      0,
      Math.min(availableHeight(), contentHeight() + actionAreaHeight()),
    );
  const actionsY = () => Math.max(0, height() - actionAreaHeight());
  const titleY = () => padding();
  const messageY = () => titleY() + titleLines() * titleLine() + contentGap();

  /**
   * Which action Return acts on. A destructive confirmation focuses Cancel;
   * otherwise the trailing (default) action. A caller-supplied list can name
   * `defaultAction` still, and gets the same rule for destructive entries.
   */
  const defaultIndex = () => {
    const items = actionItems();
    const cancelIndex = items.findIndex((item) => item.style === 'cancel');
    if (props.defaultAction === 'cancel' && cancelIndex >= 0)
      return cancelIndex;
    if (props.defaultAction === 'confirm') {
      const trailing = items.length - 1;
      const preferred = items[trailing];
      if (preferred !== undefined && preferred.style !== 'cancel')
        return trailing;
      return Math.max(0, cancelIndex);
    }
    if (props.destructive === true && cancelIndex >= 0) return cancelIndex;
    const trailing = items.length - 1;
    if (items[trailing]?.style !== 'cancel') return Math.max(0, trailing);
    const firstOther = items.findIndex((item) => item.style !== 'cancel');
    return firstOther >= 0 ? firstOther : Math.max(0, trailing);
  };
  // Focus indexes a rendered row: separators sit between actions.
  const selectedAction = () => Math.max(0, defaultIndex() * 2);

  const buttonStyle = (index: number): NodeStyles => {
    const items = actionItems();
    const last = index === items.length - 1;
    const bottomLeft = last || (!stacked() && index === 0);
    const bottomRight = last;
    return {
      color: 0x00000000,
      borderRadius: [
        0,
        0,
        bottomRight ? theme.radius.medium : 0,
        bottomLeft ? theme.radius.medium : 0,
      ],
      $focus: { color: theme.colors.selection },
    };
  };
  let actions: ElementNode | undefined;
  let panel: ElementNode | undefined;
  const runAction = (action: AlertAction) => {
    if (action.disabled === true) return;
    action.onPress?.();
    props.onRequestClose?.();
  };
  return (
    <Modal
      visible={props.visible}
      onRequestClose={requestCancel}
      label={props.title}
      role="alertdialog"
      dismissOnBackdrop={false}
      useSafeArea={false}
      // The panel runs its own entrance and exit about its centre.
      centeredMotion={false}
      panelExit={() =>
        panel === undefined
          ? Promise.resolve()
          : overlayExit(panel, EXIT, MOTION)
      }
      initialFocus={
        props.initialFocus ??
        (() => (actionItems().length === 0 ? undefined : actions))
      }
    >
      <view
        id="alert-panel"
        ref={(node) => {
          panel = node as ElementNode;
        }}
        onCreate={(el) => overlayEnter(el, ENTER, MOTION)}
        x={Math.round(
          viewport().insets.safeArea.left +
            Math.max(
              u(16),
              (viewport().width -
                viewport().insets.safeArea.left -
                viewport().insets.safeArea.right -
                width()) /
                2,
            ),
        )}
        y={Math.round(
          viewport().insets.safeArea.top +
            Math.max(u(16), (availableHeight() + u(32) - height()) / 2),
        )}
        width={width()}
        height={height()}
        color={theme.colors.surfaceRaised}
        borderRadius={theme.radius.medium}
        border={{ width: 1, color: theme.colors.border, align: 'inside' }}
        onMouseClick={() => true}
      >
        <text
          skipFocus
          x={padding()}
          y={titleY()}
          width={textWidth()}
          contain="width"
          maxLines={3}
          textAlign="center"
          fontSize={titleSize()}
          fontWeight={700}
          color={theme.colors.text}
        >
          {props.title}
        </text>
        {messageLines() > 0 ? (
          <text
            skipFocus
            x={padding()}
            y={messageY()}
            width={textWidth()}
            height={messageLines() * bodyLine() + 4}
            contain="both"
            maxLines={messageLines()}
            textAlign="center"
            fontSize={bodySize()}
            color={theme.colors.textMuted}
          >
            {props.message}
          </text>
        ) : null}
        {props.children !== undefined ? (
          <view
            x={padding()}
            y={messageY() + messageLines() * bodyLine() + contentGap()}
            width={textWidth()}
            height={u(64)}
          >
            {props.children}
          </view>
        ) : null}

        {/* The hairline between content and actions, and between the action
            rows, is what makes the card read as an alert rather than chips.
            Two actions sit side by side; three stack, as UIKit does. */}
        <Show when={actionItems().length > 0}>
          <view
            skipFocus
            x={0}
            y={actionsY()}
            width={width()}
            height={separator()}
            color={theme.colors.border}
          />
          <Show
            when={stacked()}
            fallback={
              <Row
                ref={(node) => {
                  actions = node;
                }}
                x={0}
                y={actionsY() + separator()}
                width={width()}
                height={actionHeight()}
                gap={0}
                selected={selectedAction()}
                scroll="none"
              >
                <For each={actionItems()}>
                  {(action, index) => {
                    const count = actionItems().length;
                    const actionWidth = () =>
                      (width() - separator() * (count - 1)) / count;
                    return (
                      <>
                        <Show when={index() > 0}>
                          <view
                            skipFocus
                            x={
                              index() * actionWidth() +
                              separator() * (index() - 1)
                            }
                            y={0}
                            width={separator()}
                            height={actionHeight()}
                            color={theme.colors.border}
                          />
                        </Show>
                        <view
                          width={actionWidth()}
                          height={actionHeight()}
                          style={buttonStyle(index())}
                          role="button"
                          ariaLabel={action.label}
                          ariaDisabled={action.disabled}
                          skipFocus={action.disabled}
                          onEnter={() => runAction(action)}
                          onMouseClick={() => runAction(action)}
                          cursorStyle={
                            action.disabled ? 'not-allowed' : 'pointer'
                          }
                        >
                          <text
                            skipFocus
                            x={0}
                            y={(actionHeight() - bodySize() * 1.2) / 2}
                            width={actionWidth()}
                            contain="width"
                            textAlign="center"
                            fontSize={
                              tv() ? u(26) : Math.max(u(17), bodySize())
                            }
                            fontWeight={
                              action.style === 'cancel' ? undefined : 700
                            }
                            color={
                              action.disabled
                                ? theme.colors.textMuted
                                : action.style === 'destructive'
                                  ? theme.colors.danger
                                  : theme.colors.primary
                            }
                          >
                            {action.label}
                          </text>
                        </view>
                      </>
                    );
                  }}
                </For>
              </Row>
            }
          >
            <Column
              ref={(node) => {
                actions = node;
              }}
              x={0}
              y={actionsY() + separator()}
              width={width()}
              height={actionAreaHeight() - separator()}
              gap={0}
              selected={selectedAction()}
              scroll="none"
            >
              <For each={actionItems()}>
                {(action, index) => (
                  <>
                    <Show when={index() > 0}>
                      <view
                        skipFocus
                        width={width()}
                        height={separator()}
                        color={theme.colors.border}
                      />
                    </Show>
                    <view
                      width={width()}
                      height={actionHeight()}
                      style={buttonStyle(index())}
                      role="button"
                      ariaLabel={action.label}
                      ariaDisabled={action.disabled}
                      skipFocus={action.disabled}
                      onEnter={() => runAction(action)}
                      onMouseClick={() => runAction(action)}
                      cursorStyle={action.disabled ? 'not-allowed' : 'pointer'}
                    >
                      <text
                        skipFocus
                        x={0}
                        y={(actionHeight() - bodySize() * 1.2) / 2}
                        width={width()}
                        contain="width"
                        textAlign="center"
                        fontSize={tv() ? u(26) : Math.max(u(17), bodySize())}
                        fontWeight={action.style === 'cancel' ? undefined : 700}
                        color={
                          action.disabled
                            ? theme.colors.textMuted
                            : action.style === 'destructive'
                              ? theme.colors.danger
                              : theme.colors.primary
                        }
                      >
                        {action.label}
                      </text>
                    </view>
                  </>
                )}
              </For>
            </Column>
          </Show>
        </Show>
      </view>
    </Modal>
  );
}
