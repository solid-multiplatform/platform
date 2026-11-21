import type { JSX } from 'solid-js';
import type { NodeStyles } from '../core/intrinsicTypes.js';
import { viewport } from '../sdk/viewport.js';

export type KeyboardAvoidingBehavior = 'padding' | 'height' | 'position';

export interface KeyboardAvoidingViewProps {
  /**
   * How to make room for the keyboard, matching React Native:
   * - `padding` reserves the space at the bottom (default);
   * - `height` shrinks the container;
   * - `position` moves the container up without resizing it.
   */
  behavior?: KeyboardAvoidingBehavior;
  enabled?: boolean;
  /** Extra space between the container and the keyboard. */
  keyboardVerticalOffset?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: NodeStyles;
  ref?: (node: import('../core/elementNode.js').ElementNode) => void;
  children?: JSX.Element;
}

/**
 * Makes its children avoid the software keyboard. The inset is the same value
 * the host reports through `viewport().insets.ime`, so it works on Android
 * (`WindowInsets.Type.ime()`), iOS (`UIKeyboardWillChangeFrame`) and web
 * (`visualViewport`) without per-platform code in the screen.
 */
export function KeyboardAvoidingView(
  props: KeyboardAvoidingViewProps,
): JSX.Element {
  const behavior = () => props.behavior ?? 'padding';
  const inset = () =>
    props.enabled === false
      ? 0
      : Math.max(
          0,
          viewport().insets.ime.bottom - (props.keyboardVerticalOffset ?? 0),
        );
  const width = () => props.width ?? viewport().width;
  const height = () =>
    Math.max(0, (props.height ?? viewport().height) - inset());
  return (
    <view
      ref={props.ref}
      x={props.x ?? 0}
      y={behavior() === 'position' ? -inset() : (props.y ?? 0)}
      width={width()}
      height={
        behavior() === 'position'
          ? (props.height ?? viewport().height)
          : height()
      }
      style={props.style}
    >
      {props.children}
    </view>
  );
}

export type SafeAreaEdge = 'top' | 'right' | 'bottom' | 'left';

export interface SafeAreaProps {
  /** Edges to inset. Defaults to all four. */
  edges?: SafeAreaEdge[];
  /** `padding` shrinks the box; `margin` offsets it inside its parent. */
  mode?: 'padding' | 'margin';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: NodeStyles;
  ref?: (node: import('../core/elementNode.js').ElementNode) => void;
  children?: JSX.Element;
}

/**
 * Insets its children by the host's safe area. This is the one API an app
 * needs for status bars, notches, camera housings, the Dynamic Island and TV
 * overscan; it follows Apple's `safeAreaInsets` guidance and Android's
 * system-bar/display-cutout insets rather than device-specific checks.
 */
export function SafeArea(props: SafeAreaProps): JSX.Element {
  const edges = () => props.edges ?? ['top', 'right', 'bottom', 'left'];
  const area = () => viewport().insets.safeArea;
  const side = (edge: SafeAreaEdge) =>
    edges().includes(edge) ? area()[edge] : 0;
  const margin = () => props.mode === 'margin';
  return (
    <view
      ref={props.ref}
      x={(props.x ?? 0) + (margin() ? side('left') : 0)}
      y={(props.y ?? 0) + (margin() ? side('top') : 0)}
      width={Math.max(
        0,
        (props.width ?? viewport().width) - side('left') - side('right'),
      )}
      height={Math.max(
        0,
        (props.height ?? viewport().height) - side('top') - side('bottom'),
      )}
      style={props.style}
    >
      {props.children}
    </view>
  );
}
