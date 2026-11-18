import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';

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

  return (
    <Modal
      visible={props.visible}
      onRequestClose={() => props.onRequestClose?.()}
      label={props.label}
      transparent
      useSafeArea={false}
      initialFocus={props.initialFocus}
    >
      <view
        x={x()}
        y={safe().top}
        width={width()}
        height={viewport().height - safe().top - safe().bottom}
        color={theme().colors.surface}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        <text
          x={24}
          y={24}
          width={width() - 96}
          contain="width"
          fontSize={theme().typography.title}
          color={theme().colors.text}
        >
          {props.title ?? props.label}
        </text>
        <view
          x={width() - 64}
          y={20}
          width={44}
          height={44}
          color={theme().colors.surfaceRaised}
          onEnter={() => props.onRequestClose?.()}
          onMouseClick={() => props.onRequestClose?.()}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={10}
            width={44}
            contain="width"
            textAlign="center"
            fontSize={theme().typography.label}
            color={theme().colors.text}
          >
            ×
          </text>
        </view>
        <view
          x={24}
          y={88}
          width={width() - 48}
          height={viewport().height - safe().top - safe().bottom - 112}
        >
          {props.children}
        </view>
      </view>
    </Modal>
  );
}
