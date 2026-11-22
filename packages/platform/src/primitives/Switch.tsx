import { createSignal, Show, type JSX } from 'solid-js';
import { Config } from '../core/config.js';
import { selectionFeedback } from '../sdk/device.js';
import { useTheme } from '../sdk/theme.jsx';

export interface SwitchProps {
  checked: boolean | (() => boolean);
  onChange?(checked: boolean): void;
  /** A leading label; the whole row is the hit target. */
  label?: string;
  disabled?: boolean;
  autofocus?: boolean;
  x?: number;
  y?: number;
  /** Row width when labelled; the track width otherwise. */
  width?: number;
  /** Row height when labelled. Defaults to 44 (a touch target). */
  height?: number;
  /** Track width in logical units. Defaults to Apple's 51 (31 high). */
  size?: number;
}

/**
 * Apple's switch: a 51×31 pill with a round knob, accent-filled when on.
 * Unlike `Checkbox` (a form row with a square box), this is the control the
 * iOS Settings and Control Center use. The whole labelled row is one focus
 * target and one touch target; Space/Enter and a tap toggle it.
 */
export function Switch(props: SwitchProps): JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = createSignal(false);
  const value = () =>
    typeof props.checked === 'function' ? props.checked() : props.checked;
  const scale = () => Math.max(1, theme.typography.label / 13);
  const trackWidth = () => props.size ?? Math.round(51 * scale());
  const trackHeight = () => Math.round((trackWidth() * 31) / 51);
  const knob = () => Math.max(16, trackHeight() - 4);
  const labelled = () => props.label !== undefined && props.label !== '';
  const width = () => props.width ?? (labelled() ? 240 : trackWidth());
  const height = () => props.height ?? Math.max(44, trackHeight());
  const trackX = () =>
    labelled() ? width() - trackWidth() : (width() - trackWidth()) / 2;
  const trackY = () => (height() - trackHeight()) / 2;

  const activate = () => {
    if (props.disabled) return;
    void selectionFeedback();
    props.onChange?.(!value());
  };

  return (
    <view
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width()}
      height={height()}
      role="switch"
      ariaLabel={props.label ?? 'Switch'}
      ariaChecked={value()}
      ariaDisabled={props.disabled}
      autofocus={props.autofocus}
      skipFocus={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onEnter={activate}
      onMouseClick={activate}
      cursorStyle={props.disabled ? 'not-allowed' : 'pointer'}
      style={{ color: 0x00000000 }}
    >
      <Show when={labelled()}>
        <text
          x={4}
          y={(height() - theme.typography.label) / 2}
          width={Math.max(0, width() - trackWidth() - 24)}
          contain="width"
          maxLines={1}
          fontSize={theme.typography.label}
          color={props.disabled ? theme.colors.textMuted : theme.colors.text}
        >
          {props.label}
        </text>
      </Show>
      <view
        skipFocus
        x={trackX()}
        y={trackY()}
        width={trackWidth()}
        height={trackHeight()}
        color={
          props.disabled
            ? theme.colors.border
            : value()
              ? theme.colors.primary
              : theme.colors.border
        }
        borderRadius={trackHeight() / 2}
        border={
          focused()
            ? { width: 2, color: theme.colors.focus, align: 'inside' }
            : undefined
        }
      >
        <view
          skipFocus
          transition={
            Config.animationsEnabled
              ? { x: { duration: 160, easing: 'ease-out' } }
              : undefined
          }
          x={value() ? trackWidth() - knob() - 2 : 2}
          y={2}
          width={knob()}
          height={knob()}
          color={0xffffffff}
          borderRadius={knob() / 2}
        />
      </view>
    </view>
  );
}
