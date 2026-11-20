import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { isElementNode } from '../core/utils.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';

// Focus on the sheet goes to the first of the app's children that takes it
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

export interface SheetProps {
  visible: boolean | (() => boolean);
  onRequestClose?(): void;
  /** Accessible name, also used as the default title. */
  label: string;
  title?: string;
  /** Height in logical units; defaults to 60% of the window (max 640). */
  height?: number;
  /** Keep the panel above the software keyboard. Defaults to true. */
  avoidKeyboard?: boolean;
  initialFocus?: ElementNode | (() => ElementNode | undefined);
  children?: JSX.Element;
}

/**
 * Bottom sheet. This is the Flutter `showModalBottomSheet` shape built on the
 * same modal behaviour: dimmed barrier, safe-area padding, Back/Escape close
 * and focus restoration.
 */
export function Sheet(props: SheetProps): JSX.Element {
  const theme = () => useTheme();
  const height = () => props.height ?? Math.min(640, viewport().height * 0.6);
  const bottom = () =>
    viewport().insets.safeArea.bottom +
    (props.avoidKeyboard === false ? 0 : viewport().insets.ime.bottom);
  return (
    <Modal
      visible={props.visible}
      onRequestClose={props.onRequestClose}
      label={props.label}
      transparent
      // A sheet dims its parent and its own surface takes the tap: a tap
      // inside must not fall through to the barrier and dismiss it.
      barrierColor={0x00000080}
      useSafeArea={false}
      initialFocus={props.initialFocus}
    >
      <view
        x={0}
        y={viewport().height - height() - bottom()}
        width={viewport().width}
        height={height()}
        color={theme().colors.surfaceRaised}
        borderRadius={[theme().radius.medium, theme().radius.medium, 0, 0]}
        forwardFocus={1}
        onMouseClick={() => true}
      >
        <text
          skipFocus
          x={28}
          y={24}
          fontSize={30}
          color={theme().colors.text}
        >
          {props.title ?? props.label}
        </text>
        <view
          x={24}
          y={82}
          width={viewport().width - 48}
          height={height() - 106}
          forwardFocus={focusContent}
        >
          {props.children}
        </view>
      </view>
    </Modal>
  );
}
