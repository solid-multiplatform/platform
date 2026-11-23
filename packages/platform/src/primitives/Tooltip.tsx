import {
  createSignal,
  onCleanup,
  Show,
  type Accessor,
  type JSX,
} from 'solid-js';
import type { Rect } from '../sdk/input.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { OVERLAY_FADE_IN, overlayEnter, overlayExit } from './FadeInOut.jsx';
import { Portal } from './portal.jsx';

// A hint appears at its anchor: a quick fade with a slight scale-up about the
// edge that faces the anchor, and the same in reverse before unmount.
const ENTER = { alpha: OVERLAY_FADE_IN, scale: 0.96 };
const EXIT = { alpha: 0, scale: 0.96 };
const MOTION = { duration: 180, easing: 'ease-out' };

/** Handlers a control spreads to show a tooltip the way Apple describes. */
export interface TooltipTrigger {
  onPointerEnter(): void;
  onPointerLeave(): void;
  onFocus(): void;
  onBlur(): void;
  onKeyPress(event: { key: string }): boolean;
}

/**
 * Hover/focus behaviour for a tooltip: shown after `delay` ms of hover,
 * immediately on keyboard focus, hidden when the pointer or focus leaves, and
 * dismissed with Escape. There is no auto-hide timer: while the tooltip is
 * visible the scene schedules nothing.
 *
 * ```tsx
 * const tip = createTooltip();
 * <view {...tip.trigger} />
 * <Tooltip visible={tip.visible} anchor={...} label="..." />
 * ```
 */
export function createTooltip(options: { delay?: number } = {}): {
  visible: Accessor<boolean>;
  trigger: TooltipTrigger;
} {
  const delay = options.delay ?? 500;
  const [visible, setVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const show = () => {
    if (visible() || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      setVisible(true);
    }, delay);
  };
  const showNow = () => {
    clear();
    setVisible(true);
  };
  const hide = () => {
    clear();
    setVisible(false);
  };
  onCleanup(clear);
  return {
    visible,
    trigger: {
      onPointerEnter: show,
      onPointerLeave: hide,
      onFocus: showNow,
      onBlur: hide,
      onKeyPress(event) {
        if (event.key !== 'Escape' || !visible()) return false;
        hide();
        return true;
      },
    },
  };
}

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
 *
 * `skipFocus` keeps the whole overlay out of focus traversal and out of the
 * pointer's hit test: a click over a tooltip reaches what is behind it, so
 * the hint cannot become the focused element or swallow a click.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const theme = useTheme();
  const fontSize = () => Math.max(14, Math.min(24, theme.typography.body));
  const height = () => Math.round(fontSize() * 2.2);
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  const rect = () => {
    const a =
      typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    const width = props.width ?? Math.min(320, viewport().width - 32);
    const v = viewport();
    const safe = v.insets.safeArea;
    let y =
      (props.placement ?? 'top') === 'top'
        ? a.y - height() - 8
        : a.y + a.height + 8;
    if (y < safe.top) y = a.y + a.height + 8;
    if (y + height() > v.height - safe.bottom)
      y = Math.max(safe.top, a.y - height() - 8);
    const x = Math.max(safe.left, Math.min(a.x, v.width - safe.right - width));
    return { x, y, width, height: height() };
  };
  // The scale's pivot: the edge that faces the anchor, so the hint grows out
  // of the control it describes (`rect`'s flip included).
  const pivot = () => {
    const a =
      typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    const below = rect().y >= a.y + a.height;
    return { pivotX: 0.5, pivotY: below ? 0 : 1 };
  };
  return (
    <Show when={visible()}>
      <Portal>
        <view
          {...rect()}
          {...pivot()}
          onCreate={(el) => overlayEnter(el, ENTER, MOTION)}
          onDestroy={(el) => overlayExit(el, EXIT, MOTION)}
          skipFocus
          color={0x0b1118f2}
          role="tooltip"
          ariaLabel={props.label}
        >
          <text
            x={12}
            y={(height() - fontSize() * 1.2) / 2}
            fontSize={fontSize()}
            color={theme.colors.text}
          >
            {props.label}
          </text>
          {props.children}
        </view>
      </Portal>
    </Show>
  );
}
