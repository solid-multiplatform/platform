import type { JSX } from 'solid-js';
import type { ElementNode, NodeStyles } from '../index.js';
import { createFocusTraversal } from '../sdk/focus.js';

export interface FocusGroupProps {
  /**
   * Fields in Tab order. Read on every keypress, so conditional fields work.
   * Native editors keep their own host Tab handling.
   */
  items:
    | readonly (ElementNode | undefined)[]
    | (() => readonly (ElementNode | undefined)[]);
  /** Wrap from the last field to the first. Defaults to true. */
  wrap?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: NodeStyles;
  ref?: (node: ElementNode) => void;
  children?: JSX.Element;
}

/**
 * Groups scene-drawn form fields for keyboard traversal. Tab moves to the next
 * field and Shift+Tab to the previous one, wrapping at the ends. Keys other
 * than Tab continue to bubble to arrows/Enter handlers, so TV D-pad navigation
 * still works inside the same group.
 */
export function FocusGroup(props: FocusGroupProps): JSX.Element {
  const source = () =>
    typeof props.items === 'function'
      ? (props.items as () => readonly (ElementNode | undefined)[])()
      : props.items;
  const traversal = createFocusTraversal(source, { wrap: props.wrap });

  return (
    <view
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      style={props.style}
      onKeyPress={(event) => traversal.handleTab(event)}
    >
      {props.children}
    </view>
  );
}
