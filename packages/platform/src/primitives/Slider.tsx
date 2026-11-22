import { createSignal, type JSX } from 'solid-js';
import type { ElementNode } from '../core/elementNode.js';
import { selectionFeedback } from '../sdk/device.js';
import { screenRect } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';

export interface SliderProps {
  value: number | (() => number);
  onChange?(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
  autofocus?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Apple's slider: a thin track with an accent-filled leading portion and a
 * round knob. Drag the track (pointer or touch), or use Left/Right and
 * Home/End from the keyboard. The value is controlled; `onChange` receives
 * the quantised value.
 */
export function Slider(props: SliderProps): JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = createSignal(false);
  const value = () =>
    typeof props.value === 'function' ? props.value() : props.value;
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () =>
    props.step ?? Math.max((max() - min()) / 20, Number.EPSILON);
  const width = () => props.width ?? 240;
  const height = () => props.height ?? 44;
  const knob = () =>
    Math.max(20, Math.round(28 * (theme.typography.label / 13)));
  const trackHeight = () => Math.max(3, Math.round(4 * (knob() / 28)));
  // A labelled slider is a row: the label takes the leading side and the
  // track the rest, so a TV's larger type does not collide with the knob.
  const labelWidth = () =>
    props.label
      ? Math.min(
          Math.round(width() * 0.45),
          Math.round(180 * (theme.typography.label / 13)),
        )
      : 0;
  const labelGap = () => (props.label ? 12 : 0);
  const trackStart = () => labelWidth() + labelGap() + knob() / 2;
  const trackEnd = () => width() - knob() / 2;
  const trackX = () => trackStart();
  const trackWidth = () => Math.max(1, trackEnd() - trackStart());
  const fraction = () =>
    max() === min() ? 0 : clamp((value() - min()) / (max() - min()), 0, 1);
  const knobX = () => trackX() + trackWidth() * fraction() - knob() / 2;
  const trackY = () => (height() - trackHeight()) / 2;

  const setValue = (next: number, haptic = false) => {
    if (props.disabled) return;
    const quantised = clamp(
      min() + Math.round((next - min()) / step()) * step(),
      min(),
      max(),
    );
    const rounded = Number(quantised.toFixed(6));
    if (rounded === value()) return;
    if (haptic) void selectionFeedback();
    props.onChange?.(rounded);
  };

  const valueAt = (point: { x: number; y: number }, node: ElementNode) => {
    const rect = screenRect(node);
    const scale = rect.width / Math.max(1, width());
    const drawnKnob = knob() * scale;
    const local = point.x - rect.x;
    const start = (labelWidth() + labelGap()) * scale + drawnKnob / 2;
    const travel = Math.max(1, rect.width - start - drawnKnob / 2);
    return min() + clamp((local - start) / travel, 0, 1) * (max() - min());
  };

  let node: ElementNode | undefined;
  const drag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
  ) => {
    if (node === undefined || props.disabled) return;
    if (phase === 'move' || phase === 'start') setValue(valueAt(point, node));
    if (phase === 'end') {
      setValue(valueAt(point, node), true);
    }
  };

  const nudge = (direction: -1 | 1) => {
    setValue(value() + step() * direction, true);
  };

  return (
    <view
      ref={(el) => (node = el)}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      role="slider"
      ariaLabel={props.label ?? 'Slider'}
      ariaValueNow={value()}
      ariaValueMin={min()}
      ariaValueMax={max()}
      ariaDisabled={props.disabled}
      autofocus={props.autofocus}
      skipFocus={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onLeft={() => nudge(-1)}
      onRight={() => nudge(1)}
      onKeyPress={(event) => {
        if (event.key === 'Home') {
          setValue(min(), true);
          return true;
        }
        if (event.key === 'End') {
          setValue(max(), true);
          return true;
        }
        return false;
      }}
      onPointerDrag={drag}
      onMouseClick={(point, target) =>
        setValue(valueAt(point, target as ElementNode), true)
      }
      cursorStyle={props.disabled ? 'not-allowed' : 'pointer'}
      style={{ color: 0x00000000 }}
    >
      {props.label ? (
        <text
          skipFocus
          x={0}
          y={Math.round((height() - theme.typography.label * 1.3) / 2)}
          width={labelWidth()}
          contain="width"
          maxLines={1}
          fontSize={theme.typography.label}
          color={theme.colors.textMuted}
        >
          {props.label}
        </text>
      ) : null}
      <view
        skipFocus
        x={trackX()}
        y={trackY()}
        width={trackWidth()}
        height={trackHeight()}
        color={theme.colors.border}
        borderRadius={trackHeight() / 2}
      />
      {props.label ? (
        <text
          skipFocus
          x={0}
          y={Math.round((height() - theme.typography.label * 1.3) / 2)}
          width={labelWidth()}
          contain="width"
          maxLines={1}
          fontSize={theme.typography.label}
          color={theme.colors.textMuted}
        >
          {props.label}
        </text>
      ) : null}
      <view
        skipFocus
        x={trackX()}
        y={trackY()}
        width={trackWidth() * fraction()}
        height={trackHeight()}
        color={props.disabled ? theme.colors.textMuted : theme.colors.primary}
        borderRadius={trackHeight() / 2}
      />
      <view
        skipFocus
        x={knobX()}
        y={(height() - knob()) / 2}
        width={knob()}
        height={knob()}
        color={0xffffffff}
        borderRadius={knob() / 2}
        border={
          focused()
            ? { width: 2, color: theme.colors.focus, align: 'inside' }
            : { width: 1, color: theme.colors.border, align: 'inside' }
        }
      />
    </view>
  );
}
