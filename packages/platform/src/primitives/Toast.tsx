import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Portal } from './portal.jsx';

export interface ToastProps {
  visible: boolean | (() => boolean);
  message: string;
  /** Milliseconds before `onDismiss` runs. 0 keeps it until the app hides it. */
  duration?: number;
  onDismiss?(): void;
  actionLabel?: string;
  onAction?(): void;
  /** `bottom` (default) or `top`. */
  position?: 'bottom' | 'top';
  children?: JSX.Element;
}

/**
 * Transient status message. Follows the React Native `ToastAndroid` and
 * Flutter `SnackBar` pattern: one message, optional action, automatic dismiss.
 * It is anchored inside the safe area and above the keyboard.
 */
export function Toast(props: ToastProps): JSX.Element {
  const theme = useTheme();
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const duration = props.duration ?? 3000;
    if (visible() && duration > 0) {
      timer = setTimeout(() => props.onDismiss?.(), duration);
    }
  });
  onCleanup(() => timer && clearTimeout(timer));

  const textSize = () => theme.typography.body;
  const labelSize = () => theme.typography.label;
  const bodyLine = () => Math.round(textSize() * 1.35);
  const actionHeight = () => 44;
  const padding = () => 16;
  const messageLines = () => 2;
  const height = () =>
    padding() * 2 +
    bodyLine() * messageLines() +
    (props.actionLabel === undefined ? 0 : 8 + actionHeight());
  const rect = () => {
    const v = viewport();
    const safe = v.insets.safeArea;
    const width = Math.max(
      160,
      Math.min(560, v.width - safe.left - safe.right - 32),
    );
    const bottom = v.height - safe.bottom - v.insets.ime.bottom - height() - 24;
    return {
      x:
        safe.left +
        Math.max(16, (v.width - safe.left - safe.right - width) / 2),
      y:
        (props.position ?? 'bottom') === 'top'
          ? safe.top + 24
          : Math.max(safe.top + 24, bottom),
      width,
      height: height(),
    };
  };

  return (
    <Show when={visible()}>
      <Portal>
        <view
          {...rect()}
          color={theme.colors.surfaceRaised}
          borderRadius={theme.radius.medium}
          role="status"
          ariaLive="polite"
          ariaLabel={props.message}
        >
          <text
            skipFocus
            x={padding()}
            y={padding()}
            width={rect().width - padding() * 2}
            contain="width"
            maxLines={messageLines()}
            fontSize={textSize()}
            color={theme.colors.text}
          >
            {props.message}
          </text>
          {props.actionLabel ? (
            // Only the action is tappable: a tap on the message should not
            // run something the person did not aim at.
            <view
              x={padding()}
              y={padding() + bodyLine() * messageLines() + 8}
              width={rect().width - padding() * 2}
              height={actionHeight()}
              borderRadius={theme.radius.small}
              role="button"
              ariaLabel={props.actionLabel}
              onEnter={() => props.onAction?.()}
              onMouseClick={() => props.onAction?.()}
              cursorStyle="pointer"
              style={{ $focus: { color: theme.colors.selection } }}
            >
              <text
                skipFocus
                x={0}
                y={(actionHeight() - labelSize() * 1.2) / 2}
                fontSize={labelSize()}
                fontWeight={700}
                color={theme.colors.primary}
              >
                {props.actionLabel}
              </text>
            </view>
          ) : null}
          {props.children}
        </view>
      </Portal>
    </Show>
  );
}
