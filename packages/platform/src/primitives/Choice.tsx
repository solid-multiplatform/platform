import { For, createSignal, type JSX } from 'solid-js';
import { useTheme } from '../sdk/theme.jsx';
import {
  handleNavigation,
  navigableForwardFocus,
} from './utils/handleNavigation.js';

const onUp = handleNavigation('up');
const onDown = handleNavigation('down');

const valueOf = <T,>(value: T | (() => T)): T =>
  typeof value === 'function' ? (value as () => T)() : value;

export interface CheckboxProps {
  x?: number;
  y?: number;
  /** Hit area width, including the label. Defaults to 240. */
  width?: number;
  /** Hit area height. Defaults to 48. */
  height?: number;
  label: string;
  checked: boolean | (() => boolean);
  onChange?(checked: boolean): void;
  disabled?: boolean;
}

/**
 * Scene-drawn checkbox. The whole row is one focus target, matching a native
 * checkbox label: Enter/Space (through `onEnter`) or a pointer click toggles it.
 */
export function Checkbox(props: CheckboxProps): JSX.Element {
  const theme = () => useTheme();
  const [focused, setFocused] = createSignal(false);
  const checked = () => valueOf(props.checked);
  const width = () => props.width ?? 240;
  const height = () => props.height ?? 48;
  const box = 26;
  const activate = () => {
    if (props.disabled) return;
    props.onChange?.(!checked());
  };

  return (
    <view
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      color={focused() ? theme().colors.focus : 0x00000000}
      borderRadius={theme().radius.small}
      role="checkbox"
      ariaLabel={props.label}
      ariaChecked={checked()}
      ariaDisabled={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onEnter={activate}
      onMouseClick={activate}
      cursorStyle={props.disabled ? 'not-allowed' : 'pointer'}
    >
      <view
        x={8}
        y={(height() - box) / 2}
        width={box}
        height={box}
        color={
          checked()
            ? theme().colors.primary
            : props.disabled
              ? theme().colors.border
              : theme().colors.surfaceRaised
        }
        borderRadius={theme().radius.small}
      >
        {/* Drawn, not a glyph: the MSDF faces an app registers often have no
            checkmark, and a missing glyph is an empty box. */}
        <view
          width={9}
          height={2}
          x={5}
          y={14}
          rotation={0.8}
          color={checked() ? theme().colors.onPrimary : 0x00000000}
        />
        <view
          width={5}
          height={2}
          x={12}
          y={17}
          rotation={-0.8}
          color={checked() ? theme().colors.onPrimary : 0x00000000}
        />
      </view>
      <text
        x={8 + box + 12}
        y={(height() - theme().typography.label) / 2}
        width={width() - box - 28}
        contain="width"
        fontSize={theme().typography.label}
        color={props.disabled ? theme().colors.textMuted : theme().colors.text}
      >
        {props.label}
      </text>
    </view>
  );
}

export interface RadioProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label: string;
  selected: boolean | (() => boolean);
  onSelect?(): void;
  disabled?: boolean;
}

/** Scene-drawn radio row, sized and activated like `Checkbox`. */
export function Radio(props: RadioProps): JSX.Element {
  const theme = () => useTheme();
  const [focused, setFocused] = createSignal(false);
  const selected = () => valueOf(props.selected);
  const width = () => props.width ?? 240;
  const height = () => props.height ?? 48;
  const size = 26;
  const activate = () => {
    if (!props.disabled) props.onSelect?.();
  };

  return (
    <view
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      color={focused() ? theme().colors.focus : 0x00000000}
      borderRadius={size / 2}
      role="radio"
      ariaLabel={props.label}
      ariaChecked={selected()}
      ariaDisabled={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onEnter={activate}
      onMouseClick={activate}
      cursorStyle={props.disabled ? 'not-allowed' : 'pointer'}
    >
      <view
        x={8}
        y={(height() - size) / 2}
        width={size}
        height={size}
        color={
          selected()
            ? theme().colors.primary
            : props.disabled
              ? theme().colors.border
              : theme().colors.surfaceRaised
        }
        borderRadius={size / 2}
      >
        {selected() ? (
          <view
            x={7}
            y={7}
            width={size - 14}
            height={size - 14}
            color={theme().colors.onPrimary}
            borderRadius={(size - 14) / 2}
          />
        ) : null}
      </view>
      <text
        x={8 + size + 12}
        y={(height() - theme().typography.label) / 2}
        width={width() - size - 28}
        contain="width"
        fontSize={theme().typography.label}
        color={props.disabled ? theme().colors.textMuted : theme().colors.text}
      >
        {props.label}
      </text>
    </view>
  );
}

export interface RadioGroupOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T> {
  x?: number;
  y?: number;
  width?: number;
  value: T | (() => T);
  options: readonly RadioGroupOption<T>[];
  onChange?(value: T): void;
  /** Row height. Defaults to 48. */
  rowHeight?: number;
  /** Extra space between rows. Defaults to 4. */
  gap?: number;
}

/**
 * Vertical radio group. The selected value is controlled by the app, so a
 * group can be persisted or validated like any other form field.
 */
export function RadioGroup<T>(props: RadioGroupProps<T>): JSX.Element {
  const rowHeight = () => props.rowHeight ?? 48;
  const gap = () => props.gap ?? 4;
  const count = () => props.options.length;
  return (
    // Sized by its rows, so that it is a row of a `Column` like any other,
    // and a focus container: focus enters on the chosen radio, Up and Down
    // move between the radios and leave the group at its ends.
    <view
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width ?? 320}
      height={Math.max(0, count() * (rowHeight() + gap()) - gap())}
      role="group"
      selected={Math.max(
        0,
        props.options.findIndex(
          (option) => option.value === valueOf(props.value),
        ),
      )}
      forwardFocus={navigableForwardFocus}
      onUp={onUp}
      onDown={onDown}
    >
      <For each={props.options}>
        {(option, index) => (
          <Radio
            x={0}
            y={index() * (rowHeight() + gap())}
            width={props.width ?? 320}
            height={rowHeight()}
            label={option.label}
            disabled={option.disabled}
            selected={() => valueOf(props.value) === option.value}
            onSelect={() => props.onChange?.(option.value)}
          />
        )}
      </For>
    </view>
  );
}
