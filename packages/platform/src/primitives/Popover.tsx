import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { isElementNode } from '../core/utils.js';
import type { Rect } from '../sdk/input.js';
import type { SemanticsRole } from '../sdk/semantics.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { OVERLAY_FADE_IN, overlayEnter, overlayExit } from './FadeInOut.jsx';
import { Modal } from './Modal.jsx';

// UIPopoverPresentationController: the panel fades in with a slight scale-up
// that grows out of the anchor, and closes the same way. The pivot is the
// edge that faces the anchor, so that edge stays put while the panel scales.
const ENTER = { alpha: OVERLAY_FADE_IN, scale: 0.96 };
const EXIT = { alpha: 0, scale: 0.96 };
const MOTION = { duration: 200, easing: 'ease-out' };

// Focus on the panel goes to the first of its children that takes it; with
// none the panel keeps it.
const focusContent: ForwardFocusHandler = function () {
  const children = this.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isElementNode(child) && !child.skipFocus) {
      child.setFocus();
      return true;
    }
  }
  return false;
};

export type PopoverPlacement = 'bottom' | 'top' | 'left' | 'right';

export interface PopoverProps {
  visible: boolean | (() => boolean);
  /** Bounds of the control the popover is anchored to, in scene units. */
  anchor: Rect | (() => Rect);
  placement?: PopoverPlacement;
  label: string;
  /** What the panel is to assistive technology: `menu` for a menu. */
  role?: SemanticsRole;
  width?: number;
  height?: number;
  /** Element to focus when the popover opens; defaults to the dialog. */
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  onRequestClose?(): void;
  children?: JSX.Element;
}

/**
 * Anchored overlay following the Flutter `MenuAnchor` / Radix Popover pattern:
 * positioned next to its trigger, flipped when it would leave the safe area,
 * dismissible by tapping the barrier or pressing Back/Escape.
 */
export function Popover(props: PopoverProps): JSX.Element {
  const theme = () => useTheme();
  const anchor = () =>
    typeof props.anchor === 'function' ? props.anchor() : props.anchor;
  const gap = 8;
  const width = () =>
    Math.max(
      120,
      Math.min(
        props.width ?? 280,
        viewport().width -
          viewport().insets.safeArea.left -
          viewport().insets.safeArea.right -
          16,
      ),
    );
  // A popover is transient: it shrinks to the room it has instead of
  // reaching past the bottom of a short window.
  const height = () =>
    Math.max(
      80,
      Math.min(
        props.height ?? 240,
        viewport().height -
          viewport().insets.safeArea.top -
          Math.max(
            viewport().insets.safeArea.bottom,
            viewport().insets.ime.bottom,
          ) -
          16,
      ),
    );
  const rect = () => {
    const a = anchor();
    const v = viewport();
    const safe = v.insets.safeArea;
    const placement = props.placement ?? 'bottom';
    let x = a.x;
    let y = a.y + a.height + gap;
    if (placement === 'top') y = a.y - height() - gap;
    else if (placement === 'left') {
      x = a.x - width() - gap;
      y = a.y;
    } else if (placement === 'right') {
      x = a.x + a.width + gap;
      y = a.y;
    }
    // Flip when the preferred side leaves the safe area.
    const bottom = Math.max(safe.bottom, v.insets.ime.bottom);
    if (y + height() > v.height - bottom) {
      y = a.y - height() - gap;
    }
    if (y < safe.top) y = safe.top;
    x = Math.max(safe.left, Math.min(x, v.width - safe.right - width()));
    return { x, y, width: width(), height: height() };
  };
  // The scale's pivot: the edge of the panel that faces the anchor, so the
  // entrance grows out of the anchor rather than out of the panel's centre.
  // `top`/`bottom` follow the flip `rect` applied; the sideways placements
  // keep the anchor's side on the x axis and centre on y.
  const pivot = () => {
    const placement = props.placement ?? 'bottom';
    if (placement === 'left') return { pivotX: 1, pivotY: 0.5 };
    if (placement === 'right') return { pivotX: 0, pivotY: 0.5 };
    const a = anchor();
    const below = rect().y >= a.y + a.height;
    return { pivotX: 0.5, pivotY: below ? 0 : 1 };
  };
  let panel: ElementNode | undefined;
  return (
    <Modal
      visible={props.visible}
      onRequestClose={props.onRequestClose}
      label={props.label}
      transparent
      useSafeArea={false}
      // The panel scales itself in and out about the anchor side.
      centeredMotion={false}
      panelExit={() =>
        panel === undefined
          ? Promise.resolve()
          : overlayExit(panel, EXIT, MOTION)
      }
      initialFocus={props.initialFocus}
    >
      <view
        ref={(node) => {
          panel = node as ElementNode;
        }}
        onCreate={(el) => overlayEnter(el, ENTER, MOTION)}
        {...rect()}
        {...pivot()}
        color={theme().colors.surfaceRaised}
        borderRadius={theme().radius.medium}
        role={props.role ?? 'none'}
        ariaLabel={props.role ? props.label : undefined}
        forwardFocus={focusContent}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        {props.children}
      </view>
    </Modal>
  );
}
