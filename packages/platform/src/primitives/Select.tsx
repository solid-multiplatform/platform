import { createSignal, type JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';
import { Menu } from './Menu.jsx';

const valueOf = <T,>(value: T | (() => T)): T =>
  typeof value === 'function' ? (value as () => T)() : value;

export interface SelectOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T> {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value: T | (() => T);
  options: readonly SelectOption<T>[];
  onChange?(value: T): void;
  /** Accessible name for the trigger and menu. */
  label?: string;
  placeholder?: string;
}

/**
 * Dropdown select built from `Menu`/`Popover`: the trigger shows the current
 * label, Enter/click opens the anchored list, and choosing an option closes it.
 * This is the Flutter `DropdownButton` / HTML `<select>` shape.
 */
export function Select<T>(props: SelectProps<T>): JSX.Element {
  const theme = () => useTheme();
  const [open, setOpen] = createSignal(false);
  const width = () => props.width ?? 280;
  const height = () => props.height ?? 48;
  const selected = () =>
    props.options.find((option) => Object.is(option.value, valueOf(props.value)));
  const anchor = () => ({
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: width(),
    height: height(),
  });

  return (
    <>
      <view
        x={props.x ?? 0}
        y={props.y ?? 0}
        width={width()}
        height={height()}
        color={theme().colors.surfaceRaised}
        borderRadius={theme().radius.small}
        onEnter={() => setOpen((value) => !value)}
        onMouseClick={() => setOpen((value) => !value)}
        cursorStyle="pointer"
      >
        <text
          x={14}
          y={(height() - theme().typography.label) / 2}
          width={width() - 48}
          contain="width"
          fontSize={theme().typography.label}
          color={
            selected() ? theme().colors.text : theme().colors.textMuted
          }
        >
          {selected()?.label ?? props.placeholder ?? 'Select'}
        </text>
        <text
          x={width() - 32}
          y={(height() - 18) / 2}
          width={24}
          contain="width"
          textAlign="center"
          fontSize={18}
          color={theme().colors.textMuted}
        >
          ▾
        </text>
      </view>
      <Menu
        visible={open}
        anchor={anchor()}
        label={props.label ?? 'Select'}
        items={props.options.map((option) => ({
          label: option.label,
          disabled: option.disabled,
          onSelect: () => {
            props.onChange?.(option.value);
            setOpen(false);
          },
        }))}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}
