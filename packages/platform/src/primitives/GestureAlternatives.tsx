import { For, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import type { GestureAlternative } from '../sdk/gestures.js';
import { useTheme } from '../sdk/theme.jsx';

export interface GestureAlternativesProps {
  actions: readonly GestureAlternative[];
  x?: number;
  y?: number;
  /** Row direction. Defaults to vertical. */
  direction?: 'row' | 'column';
  /** Button width. Defaults to 180 in a column. */
  width?: number;
  /** Button height. Defaults to 44. */
  height?: number;
  gap?: number;
  ref?: (node: ElementNode) => void;
}

/**
 * Visible buttons for every gesture action. Pair with `createGestureAlternatives`
 * so pinch, rotate, swipe and drag actions all have a focusable, labelled
 * equivalent — the WCAG 2.5.1 pointer-gesture alternative.
 */
export function GestureAlternatives(
  props: GestureAlternativesProps,
): JSX.Element {
  const theme = () => useTheme();
  const row = () => props.direction === 'row';
  const width = () => props.width ?? (row() ? 120 : 180);
  const height = () => props.height ?? 44;
  const gap = () => props.gap ?? 8;
  const disabled = (action: GestureAlternative) =>
    typeof action.disabled === 'function'
      ? action.disabled()
      : !!action.disabled;

  return (
    <view
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={row() ? undefined : width()}
    >
      <For each={props.actions}>
        {(action, index) => {
          const run = () => {
            if (!disabled(action)) action.run();
          };
          return (
            <view
              x={row() ? index() * (width() + gap()) : 0}
              y={row() ? 0 : index() * (height() + gap())}
              width={width()}
              height={height()}
              color={
                disabled(action)
                  ? theme().colors.border
                  : theme().colors.surfaceRaised
              }
              borderRadius={theme().radius.small}
              ariaDisabled={disabled(action)}
              onEnter={run}
              onMouseClick={run}
              cursorStyle={disabled(action) ? 'not-allowed' : 'pointer'}
            >
              <text
                x={12}
                y={(height() - theme().typography.label) / 2}
                width={width() - 24}
                contain="width"
                fontSize={theme().typography.label}
                color={
                  disabled(action)
                    ? theme().colors.textMuted
                    : theme().colors.text
                }
              >
                {action.label}
              </text>
            </view>
          );
        }}
      </For>
    </view>
  );
}
