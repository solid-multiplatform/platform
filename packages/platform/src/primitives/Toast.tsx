import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
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

  const rect = () => {
    const v = viewport();
    const width = Math.min(560, v.width - 48);
    const height = 72;
    const bottom =
      v.height - v.insets.safeArea.bottom - v.insets.ime.bottom - height - 24;
    return {
      x: Math.max(24, (v.width - width) / 2),
      y:
        (props.position ?? 'bottom') === 'top'
          ? v.insets.safeArea.top + 24
          : Math.max(v.insets.safeArea.top + 24, bottom),
      width,
      height,
    };
  };

  return (
    <Show when={visible()}>
      <Portal>
        <view
          {...rect()}
          color={0x1d2937f2}
          role="status"
          ariaLive="polite"
          ariaLabel={props.message}
          onEnter={() => props.onAction?.()}
          onMouseClick={() => props.onAction?.()}
        >
          <text x={20} y={20} width={rect().width - 40} fontSize={22} color={0xffffffff}>
            {props.message}
          </text>
          {props.actionLabel ? (
            <text
              x={20}
              y={44}
              fontSize={18}
              color={0x60a5faff}
              onEnter={() => props.onAction?.()}
            >
              {props.actionLabel}
            </text>
          ) : null}
          {props.children}
        </view>
      </Portal>
    </Show>
  );
}
