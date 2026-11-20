import { splitProps, type JSX } from 'solid-js';
import type { NodeProps } from '@solid-multiplatform/platform';
import { useTheme } from '../sdk/theme.jsx';

export interface ButtonProps extends Omit<NodeProps, 'children'> {
  /** Remote or keyboard Enter, a pointer click and a tap all call it. */
  onPress?: () => void;
  /** Shown dimmed, skipped by focus and not activated. */
  disabled?: boolean;
  /** The label. */
  children?: string | number | (string | number)[];
}

/**
 * A button drawn in the scene: as wide as its label and the theme's padding,
 * with the theme's focus, hover and pressed colours (read when the button is
 * created). Assistive technology reads it as a button named by its label.
 */
export function Button(props: ButtonProps): JSX.Element {
  const theme = useTheme();
  const [local, rest] = splitProps(props, ['onPress', 'disabled', 'children']);
  return (
    <view
      display="flex"
      alignItems="center"
      // The width follows the label. The height is the label's line and the
      // theme's padding: a row does not add cross-axis padding to a height
      // it derives from its children.
      height={Math.round(theme.typography.body * 1.25) + 2 * theme.spacing(3)}
      padding={[0, theme.spacing(6)]}
      alpha={local.disabled ? 0.4 : 1}
      skipFocus={local.disabled}
      ariaDisabled={local.disabled}
      cursorStyle={local.disabled ? 'not-allowed' : 'pointer'}
      forwardStates
      style={{
        color: theme.colors.surfaceRaised,
        $hover: { color: theme.colors.border },
        $focus: { color: theme.colors.focus },
        $pressed: { color: theme.colors.primary },
      }}
      {...rest}
      onEnter={() => {
        if (!local.disabled) local.onPress?.();
      }}
    >
      <text
        fontSize={theme.typography.body}
        style={{
          color: theme.colors.text,
          $focus: { color: theme.colors.onPrimary },
          $pressed: { color: theme.colors.onPrimary },
        }}
      >
        {local.children as string}
      </text>
    </view>
  );
}
