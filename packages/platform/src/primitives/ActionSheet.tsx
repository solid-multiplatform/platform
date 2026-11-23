import { For, Show, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { supports } from '../sdk/capabilities.js';
import { useUiScale } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Column } from './Column.jsx';
import { OVERLAY_FADE_IN, overlayEnter, overlayExit } from './FadeInOut.jsx';
import { Modal } from './Modal.jsx';

// UIAlertController's .actionSheet presentation as it reads on a centred
// card: fade with a slight scale-up about the card's own centre — the default
// pivot (0.5, 0.5) — and the same in reverse out.
const ENTER = { alpha: OVERLAY_FADE_IN, scale: 0.96 };
const EXIT = { alpha: 0, scale: 0.96 };
const MOTION = { duration: 250, easing: 'ease-in-out' };

export interface ActionSheetAction {
  label: string;
  style?: 'default' | 'destructive';
  disabled?: boolean;
  onPress?(): void;
}

export interface ActionSheetProps {
  visible: boolean | (() => boolean);
  title?: string;
  message?: string;
  actions: readonly ActionSheetAction[];
  /** The separate cancel button's title. Defaults to Cancel. */
  cancelLabel?: string;
  onRequestClose?(): void;
}

/**
 * Apple's action sheet: a dimmed parent, a card of related choices (up to the
 * screen's height), and a separate Cancel button below it. A destructive
 * choice is red; Cancel sits apart so it is never confused with a choice.
 * Tapping outside or Back cancels, as the platform does.
 */
export function ActionSheet(props: ActionSheetProps): JSX.Element {
  const theme = useTheme();
  const scale = useUiScale();
  const u = (value: number) => Math.round(value * scale);
  const tv = () => supports('remote');
  const safe = () => viewport().insets.safeArea;
  const availableWidth = () =>
    Math.max(0, viewport().width - safe().left - safe().right);
  const width = () =>
    Math.min(u(tv() ? 560 : 390), Math.max(0, availableWidth() - u(16)));
  const rowHeight = () => u(tv() ? 72 : 56);
  const separator = () => Math.max(1, u(1));
  const padding = () => u(tv() ? 24 : 16);
  const titleSize = () => u(tv() ? 30 : 17);
  const bodySize = () => u(tv() ? 24 : 13);
  const titleHeight = () => (props.title ? Math.round(titleSize() * 1.35) : 0);
  const messageLines = () => {
    const message = props.message ?? '';
    if (message === '') return 0;
    const perLine = Math.max(
      12,
      Math.floor((width() - padding() * 2) / (bodySize() * 0.54)),
    );
    return Math.min(3, Math.max(1, Math.ceil(message.length / perLine)));
  };
  const messageHeight = () =>
    messageLines() > 0 ? messageLines() * Math.round(bodySize() * 1.35) : 0;
  const headerHeight = () =>
    titleHeight() +
    messageHeight() +
    (titleHeight() + messageHeight() > 0 ? padding() * 2 + u(8) : 0);
  const actionsHeight = () =>
    props.actions.length * rowHeight() +
    Math.max(0, props.actions.length - 1) * separator();
  const cancelGap = () => u(8);
  const cancelHeight = () => rowHeight();
  const contentHeight = () =>
    headerHeight() + actionsHeight() + cancelGap() + cancelHeight();
  const availableHeight = () =>
    Math.max(u(120), viewport().height - safe().top - safe().bottom - u(16));
  const panelHeight = () => Math.min(contentHeight(), availableHeight());
  const panelX = () =>
    Math.round(safe().left + Math.max(8, (availableWidth() - width()) / 2));
  // A phone anchors to the bottom edge; a desktop/TV window centres the
  // card, because there is no thumb to reach the bottom of a large screen.
  const bottomAnchored = () =>
    supports('touch') && !supports('mouse') && !supports('remote');
  const panelY = () =>
    Math.round(
      bottomAnchored()
        ? Math.max(
            safe().top + u(8),
            viewport().height - safe().bottom - panelHeight() - u(8),
          )
        : safe().top +
            Math.max(
              u(8),
              (viewport().height - safe().top - safe().bottom - panelHeight()) /
                2,
            ),
    );
  const close = () => props.onRequestClose?.();
  const choose = (action: ActionSheetAction) => {
    if (action.disabled) return;
    action.onPress?.();
    close();
  };
  let actions: ElementNode | undefined;
  const backgrounds = (index: number) => {
    const top = headerHeight() === 0 && index === 0;
    const bottom = index === props.actions.length - 1;
    return {
      color: theme.colors.surfaceRaised,
      borderRadius:
        top && bottom
          ? theme.radius.medium
          : top
            ? [theme.radius.medium, theme.radius.medium, 0, 0]
            : bottom
              ? [0, 0, theme.radius.medium, theme.radius.medium]
              : 0,
    };
  };

  return (
    <Modal
      visible={props.visible}
      onRequestClose={close}
      label={props.title ?? 'Actions'}
      transparent
      barrierColor={0x00000080}
      useSafeArea={false}
      // The card runs its own entrance and exit about its centre.
      centeredMotion={false}
      panelExit={() =>
        actions === undefined
          ? Promise.resolve()
          : overlayExit(actions, EXIT, MOTION)
      }
      initialFocus={() => actions}
    >
      <Column
        ref={(node) => {
          actions = node;
        }}
        onCreate={(el) => overlayEnter(el, ENTER, MOTION)}
        x={panelX()}
        y={panelY()}
        width={width()}
        height={panelHeight()}
        gap={0}
        selected={0}
        scroll="edge"
        clipping
        role="none"
        onMouseClick={() => true}
      >
        <Show when={headerHeight() > 0}>
          <view
            skipFocus
            width={width()}
            height={headerHeight()}
            color={theme.colors.surfaceRaised}
            borderRadius={[theme.radius.medium, theme.radius.medium, 0, 0]}
          >
            <Show when={titleHeight() > 0}>
              <text
                skipFocus
                x={padding()}
                y={padding()}
                width={width() - padding() * 2}
                contain="width"
                maxLines={2}
                textAlign="center"
                fontSize={titleSize()}
                fontWeight={700}
                color={theme.colors.text}
              >
                {props.title}
              </text>
            </Show>
            <Show when={messageHeight() > 0}>
              <text
                skipFocus
                x={padding()}
                y={padding() + titleHeight() + (titleHeight() > 0 ? u(6) : 0)}
                width={width() - padding() * 2}
                height={messageHeight()}
                contain="both"
                maxLines={messageLines()}
                textAlign="center"
                fontSize={bodySize()}
                color={theme.colors.textMuted}
              >
                {props.message}
              </text>
            </Show>
          </view>
        </Show>
        <For each={props.actions}>
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
                height={rowHeight()}
                {...backgrounds(index())}
                role="button"
                ariaLabel={action.label}
                ariaDisabled={action.disabled}
                skipFocus={action.disabled}
                onEnter={() => choose(action)}
                onMouseClick={() => choose(action)}
                cursorStyle={action.disabled ? 'not-allowed' : 'pointer'}
                style={{ $focus: { color: theme.colors.selection } }}
              >
                <text
                  skipFocus
                  x={padding()}
                  y={(rowHeight() - bodySize() * 1.3) / 2}
                  width={width() - padding() * 2}
                  contain="width"
                  textAlign="center"
                  fontSize={bodySize()}
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
        <view skipFocus width={width()} height={cancelGap()} />
        <view
          width={width()}
          height={cancelHeight()}
          color={theme.colors.surfaceRaised}
          borderRadius={theme.radius.medium}
          role="button"
          ariaLabel={props.cancelLabel ?? 'Cancel'}
          onEnter={close}
          onMouseClick={close}
          cursorStyle="pointer"
          style={{ $focus: { color: theme.colors.selection } }}
        >
          <text
            skipFocus
            x={padding()}
            y={(cancelHeight() - bodySize() * 1.3) / 2}
            width={width() - padding() * 2}
            contain="width"
            textAlign="center"
            fontSize={bodySize()}
            fontWeight={700}
            color={theme.colors.primary}
          >
            {props.cancelLabel ?? 'Cancel'}
          </text>
        </view>
      </Column>
    </Modal>
  );
}
