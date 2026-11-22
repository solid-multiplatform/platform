import { createSignal, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { screenRect } from '../sdk/layout.js';
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
  const [focused, setFocused] = createSignal(false);
  const width = () => props.width ?? 280;
  const height = () => props.height ?? 48;
  const selected = () =>
    props.options.find((option) =>
      Object.is(option.value, valueOf(props.value)),
    );
  let trigger: ElementNode | undefined;
  // Where the trigger is in the scene, whatever it is nested in: the bounds
  // a pointer is tested against, read when the menu opens. `Popover` keeps
  // the menu inside the viewport.
  const anchor = () =>
    open() && trigger !== undefined
      ? screenRect(trigger)
      : { x: props.x ?? 0, y: props.y ?? 0, width: width(), height: height() };
  const selectedIndex = () => {
    const value = valueOf(props.value);
    return Math.max(
      0,
      props.options.findIndex((option) => Object.is(option.value, value)),
    );
  };

  return (
    <>
      <view
        ref={(node) => {
          trigger = node as ElementNode;
        }}
        x={props.x ?? 0}
        y={props.y ?? 0}
        width={width()}
        height={height()}
        color={theme().colors.surfaceRaised}
        borderRadius={theme().radius.medium}
        border={{
          width: focused() ? 2 : 0,
          color: theme().colors.focus,
          align: 'inside',
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        ariaLabel={props.label}
        ariaValueText={props.label ? selected()?.label : undefined}
        ariaExpanded={open()}
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
          color={selected() ? theme().colors.text : theme().colors.textMuted}
        >
          {selected()?.label ?? props.placeholder ?? 'Select'}
        </text>
        {/* The arrow is two bars, not a glyph: no font has to carry it. */}
        <view
          skipFocus
          x={width() - 31}
          y={height() / 2 - 1}
          width={10}
          height={2}
          rotation={Math.PI / 4}
          color={theme().colors.textMuted}
        />
        <view
          skipFocus
          x={width() - 25}
          y={height() / 2 - 1}
          width={10}
          height={2}
          rotation={-Math.PI / 4}
          color={theme().colors.textMuted}
        />
      </view>
      <Menu
        visible={open}
        anchor={anchor}
        selected={selectedIndex()}
        label={props.label ?? 'Select'}
        items={props.options.map((option, index) => ({
          label: option.label,
          disabled: option.disabled,
          checked: index === selectedIndex(),
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
