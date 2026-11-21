import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { isElementNode } from '../core/utils.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { CloseIcon } from './icons.jsx';
import { Modal } from './Modal.jsx';
import { activeElement } from '../core/activeElement.js';

// Focus on the drawer goes to the first of the app's children that takes it
// (the panel's second child holds them); with none that view keeps it.
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

export interface DrawerProps {
  visible: boolean | (() => boolean);
  onRequestClose?(): void;
  /** Accessible name, also the default heading. */
  label: string;
  title?: string;
  /** Which edge the panel slides from. Defaults to `start`. */
  side?: 'start' | 'end';
  /** Panel width in logical units. Defaults to 360, capped to the window. */
  width?: number;
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  children?: JSX.Element;
}

/**
 * Edge drawer built on the shared `Modal`: dimmed barrier, Back/Escape close,
 * focus trap and safe-area padding. `start` follows the writing direction in
 * the host; this primitive uses physical edges so it works with RTL layouts.
 */
export function Drawer(props: DrawerProps): JSX.Element {
  const theme = () => useTheme();
  const width = () => Math.min(props.width ?? 360, viewport().width);
  const x = () => (props.side === 'end' ? viewport().width - width() : 0);
  const safe = () => viewport().insets.safeArea;
  let content: ElementNode | undefined;
  let close: ElementNode | undefined;

  // The panel's rows are the app's content and, last, the close button: a
  // Down the content does not take reaches Close, and Up from Close goes
  // back into the content at its top.
  const panelDown = function (): boolean {
    if (activeElement() === close) return false;
    close?.setFocus();
    return true;
  };
  const panelUp = function (): boolean {
    if (activeElement() !== close) return false;
    const first = content?.children[0];
    if (isElementNode(first)) first.selected = 0;
    content?.setFocus();
    return true;
  };

  return (
    <Modal
      visible={props.visible}
      onRequestClose={() => props.onRequestClose?.()}
      label={props.label}
      transparent
      useSafeArea={false}
      initialFocus={props.initialFocus}
    >
      {/* The panel runs the full height, behind the system bars, so a drawer
          looks like part of the window; its own rows stay inside the safe
          area. */}
      <view
        x={x()}
        y={0}
        width={width()}
        height={viewport().height}
        color={theme().colors.surfaceRaised}
        // Rounded on the side that faces the content, like the other dialogs.
        borderRadius={
          props.side === 'end'
            ? [theme().radius.medium, 0, 0, theme().radius.medium]
            : [0, theme().radius.medium, theme().radius.medium, 0]
        }
        role="none"
        // The panel is a navigable container: its rows are the app's content
        // and, last, the close button, so arrows from the content reach it.
        forwardFocus={1}
        onUp={panelUp}
        onDown={panelDown}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        <text
          skipFocus
          x={24}
          y={safe().top + 24}
          width={width() - 96}
          contain="width"
          fontSize={theme().typography.title}
          color={theme().colors.text}
        >
          {props.title ?? props.label}
        </text>
        <view
          ref={(node) => {
            content = node as ElementNode;
          }}
          x={24}
          y={safe().top + 88}
          width={width() - 48}
          height={viewport().height - safe().top - safe().bottom - 112}
          forwardFocus={focusContent}
        >
          {props.children}
        </view>
        <view
          ref={(node) => {
            close = node as ElementNode;
          }}
          x={width() - 64}
          y={safe().top + 20}
          width={44}
          height={44}
          display="flex"
          alignItems="center"
          justifyContent="center"
          style={{
            color: theme().colors.surface,
            $focus: { color: theme().colors.focus },
            $hover: { color: theme().colors.border },
          }}
          // An icon button is a circle, like every other one in the app.
          borderRadius={22}
          role="button"
          ariaLabel="Close"
          onEnter={() => props.onRequestClose?.()}
          onMouseClick={() => props.onRequestClose?.()}
          cursorStyle="pointer"
        >
          <CloseIcon size={18} color={theme().colors.text} thickness={2} />
        </view>
      </view>
    </Modal>
  );
}
