import { splitProps, type JSX } from 'solid-js';
import type { TextProps as NodeTextProps } from '@solid-multiplatform/platform';
import { useTheme, type Theme } from '../sdk/theme.jsx';
import { SelectableText } from './SelectableText.jsx';

export interface TextProps extends NodeTextProps {
  /** A step of the theme's type scale (`body` when omitted), or a font size. */
  size?: keyof Theme['typography'] | number;
  /** Draws in the theme's secondary text colour. */
  muted?: boolean;
  /**
   * Let the text be selected with a pointer and copied (see
   * {@link SelectableText}). Off by default: TV scenes pay nothing for it.
   */
  selectable?: boolean;
  /** Called with the selected text, or null when cleared (`selectable`). */
  onSelectionChange?: (text: string | null) => void;
  /** The highlight colour (`selectable`); the theme's `selection` when omitted. */
  selectionColor?: number;
}

/** Text in the theme's type scale and colour. */
export function Text(props: TextProps): JSX.Element {
  if (props.selectable === true) {
    // The wrapper carries the same type-scale and colour props.
    return <SelectableText {...props} />;
  }
  const theme = () => useTheme();
  const [local, rest] = splitProps(props, ['size', 'muted', 'children']);
  return (
    <text
      skipFocus
      fontSize={
        typeof local.size === 'number'
          ? local.size
          : theme().typography[local.size ?? 'body']
      }
      color={local.muted ? theme().colors.textMuted : theme().colors.text}
      {...rest}
    >
      {local.children}
    </text>
  );
}
