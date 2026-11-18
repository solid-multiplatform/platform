import { Show, type JSX } from 'solid-js';
import type { Rect } from '../sdk/input.js';
import { viewport } from '../sdk/viewport.js';
import { Portal } from './portal.jsx';

export interface TooltipProps {
  visible: boolean | (() => boolean);
  label: string;
  /** Bounds of the control the tooltip describes. */
  anchor: Rect | (() => Rect);
  placement?: 'top' | 'bottom';
  width?: number;
  children?: JSX.Element;
}

/**
 * Non-modal hint. It never takes focus and never blocks the scene; a tooltip
 * is shown from the control's own focus/hover handlers. This matches Flutter
 * `Tooltip` and the HTML title/aria-describedby pattern.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  const rect = () => {
    const a = typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    const width = props.width ?? Math.min(320, viewport().width - 32);
    const height = 38;
    const v = viewport();
    const safe = v.insets.safeArea;
    let y = (props.placement ?? 'top') === 'top' ? a.y - height - 8 : a.y + a.height + 8;
    if (y < safe.top) y = a.y + a.height + 8;
    if (y + height > v.height - safe.bottom) y = Math.max(safe.top, a.y - height - 8);
    const x = Math.max(safe.left, Math.min(a.x, v.width - safe.right - width));
    return { x, y, width, height };
  };
  return (
    <Show when={visible()}>
      <Portal>
        <view {...rect()} color={0x0b1118f2}>
          <text x={12} y={10} fontSize={18} color={0xf2f6faff}>
            {props.label}
          </text>
          {props.children}
        </view>
      </Portal>
    </Show>
  );
}
