import { For, createSignal, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { supports } from '../sdk/capabilities.js';
import { selectionFeedback } from '../sdk/device.js';
import { useTheme } from '../sdk/theme.jsx';
import {
  handleNavigation,
  navigableForwardFocus,
} from './utils/handleNavigation.js';
import { chainRefs } from './utils/chainFunctions.js';

const onLeft = handleNavigation('left');
const onRight = handleNavigation('right');

const valueOf = <T,>(value: T | (() => T)): T =>
  typeof value === 'function' ? (value as () => T)() : value;

export interface SegmentOption<T> {
  value: T;
  /** A noun label, one content type per control (HIG). */
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T> {
  x?: number;
  y?: number;
  /** The control's width; the segments divide it equally. Defaults to 320. */
  width?: number;
  /** The group's accessible name. */
  label?: string;
  options: readonly SegmentOption<T>[];
  value: T | (() => T);
  onChange?(value: T): void;
  ref?: (node: ElementNode) => void;
}

/**
 * Apple's segmented control: a row of equal-width segments, one choice, noun
 * labels, a single content type per control. Enter or a click selects on a
 * pointer host; on a remote host a segment becomes selected when focus moves
 * to it, not when it is clicked (tvOS, per the HIG). A disabled segment is
 * skipped by focus. Nothing is scheduled while the scene is idle — the
 * selection is a plain color write.
 */
export function SegmentedControl<T>(
  props: SegmentedControlProps<T>,
): JSX.Element {
  const theme = () => useTheme();
  const count = () => props.options.length;
  const width = () => props.width ?? 320;
  // Equal widths are the rule; five to seven segments are the sane range.
  const segmentWidth = () => width() / Math.max(1, count());
  const height = () =>
    Math.max(32, Math.round(34 * (theme().typography.label / 13)));
  const current = () => valueOf(props.value);
  // tvOS: focus movement is the selection gesture.
  const focusSelects = () => supports('remote');
  const [focused, setFocused] = createSignal(-1);
  const select = (index: number) => {
    const option = props.options[index];
    if (option === undefined || option.disabled) return;
    if (option.value === current()) return;
    void selectionFeedback();
    props.onChange?.(option.value);
  };

  return (
    <view
      ref={chainRefs(props.ref)}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      role="group"
      ariaLabel={props.label}
      borderRadius={theme().radius.medium}
      color={theme().colors.border}
      selected={Math.max(
        0,
        props.options.findIndex((option) => option.value === current()),
      )}
      forwardFocus={navigableForwardFocus}
      onLeft={onLeft}
      onRight={onRight}
    >
      <For each={props.options}>
        {(option, index) => (
          <view
            width={segmentWidth()}
            height={height()}
            x={index() * segmentWidth()}
            y={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
            skipFocus={option.disabled}
            ariaDisabled={option.disabled}
            role="radio"
            ariaChecked={option.value === current()}
            ariaLabel={option.label}
            cursorStyle={option.disabled ? 'not-allowed' : 'pointer'}
            color={
              option.value === current() || focused() === index()
                ? theme().colors.selection
                : 0x00000000
            }
            borderRadius={theme().radius.medium}
            onFocus={() => {
              setFocused(index());
              if (focusSelects()) select(index());
            }}
            onBlur={() => setFocused(-1)}
            onEnter={() => select(index())}
            onMouseClick={() => select(index())}
          >
            <text
              skipFocus
              width={segmentWidth()}
              contain="width"
              maxLines={1}
              textAlign="center"
              fontSize={theme().typography.label}
              color={
                option.disabled ? theme().colors.textMuted : theme().colors.text
              }
            >
              {option.label}
            </text>
          </view>
        )}
      </For>
    </view>
  );
}
