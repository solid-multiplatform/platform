import type { JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';

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
  const height = () =>
    props.height ?? Math.min(640, viewport().height * 0.6);
  const bottom = () =>
    viewport().insets.safeArea.bottom +
    (props.avoidKeyboard === false ? 0 : viewport().insets.ime.bottom);
  return (
    <Modal
      visible={props.visible}
      onRequestClose={props.onRequestClose}
      label={props.label}
      transparent
      initialFocus={props.initialFocus}
    >
      <view
        x={0}
        y={viewport().height - height() - bottom()}
        width={viewport().width}
        height={height()}
        color={0x1d2937ff}
      >
        <text x={28} y={24} fontSize={30} color={0xf2f6faff}>
          {props.title ?? props.label}
        </text>
        <view x={24} y={82} width={viewport().width - 48} height={height() - 106}>
          {props.children}
        </view>
      </view>
    </Modal>
  );
}
