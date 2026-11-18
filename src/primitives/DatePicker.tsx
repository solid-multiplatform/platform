import { For, Show, createEffect, createSignal, type JSX } from 'solid-js';
import { formatDate } from '../sdk/i18n.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';

const valueOf = (
  value:
    | Date
    | number
    | string
    | (() => Date | number | string | undefined)
    | undefined,
): Date => {
  const resolved = typeof value === 'function' ? value() : value;
  if (resolved === undefined) return new Date();
  return resolved instanceof Date ? new Date(resolved) : new Date(resolved);
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export interface DatePickerProps {
  visible: boolean | (() => boolean);
  value?:
    | Date
    | number
    | string
    | (() => Date | number | string | undefined)
    | undefined;
  onChange?(date: Date): void;
  onRequestClose?(): void;
  /** Include hour/minute steppers. Defaults to false. */
  withTime?: boolean;
  /** Earliest selectable day. */
  min?: Date;
  /** Latest selectable day. */
  max?: Date;
  title?: string;
  /** Close after pressing Done. Defaults to true. */
  closeOnSelect?: boolean;
}

/**
 * Calendar date/time dialog. Follows the Flutter `DatePickerDialog` /
 * HTML `<input type="date">` pattern: month navigation, a six-week grid, an
 * optional time row, and Cancel/Done actions. The panel uses the shared
 * `Modal` focus trap, barrier and Back/Escape handling.
 */
export function DatePicker(props: DatePickerProps): JSX.Element {
  const theme = () => useTheme();
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  const [working, setWorking] = createSignal(new Date());
  const [month, setMonth] = createSignal(new Date());

  createEffect(() => {
    if (!visible()) return;
    const initial = valueOf(props.value);
    setWorking(initial);
    setMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
  });

  const panelWidth = 420;
  const panelHeight = () => (props.withTime ? 560 : 490);
  const panelX = () => (viewport().width - panelWidth) / 2;
  const panelY = () =>
    Math.max(
      viewport().insets.safeArea.top + 24,
      (viewport().height - panelHeight()) / 2,
    );
  const footerY = () => (props.withTime ? 500 : 430);

  const daysInMonth = () =>
    new Date(month().getFullYear(), month().getMonth() + 1, 0).getDate();
  const firstWeekday = () => month().getDay();
  const weekdayLabels = () =>
    Array.from({ length: 7 }, (_, index) =>
      formatDate(new Date(2024, 0, 7 + index), { weekday: 'narrow' }),
    );
  const monthLabel = () =>
    formatDate(month(), { month: 'long', year: 'numeric' });

  const disabled = (date: Date) => {
    if (props.min && startOfDay(date) < startOfDay(props.min)) return true;
    if (props.max && startOfDay(date) > startOfDay(props.max)) return true;
    return false;
  };

  const chooseDay = (day: number) => {
    const next = new Date(
      month().getFullYear(),
      month().getMonth(),
      day,
      working().getHours(),
      working().getMinutes(),
    );
    if (disabled(next)) return;
    setWorking(next);
  };

  const shiftMonth = (delta: number) => {
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };

  const shiftTime = (minutes: number) => {
    const next = new Date(working());
    next.setMinutes(next.getMinutes() + minutes);
    setWorking(next);
  };

  const done = () => {
    props.onChange?.(new Date(working()));
    if (props.closeOnSelect !== false) props.onRequestClose?.();
  };

  const cellWidth = 54;
  const cellHeight = 40;

  return (
    <Modal
      visible={visible()}
      onRequestClose={() => props.onRequestClose?.()}
      label={props.title ?? 'Select date'}
      transparent
    >
      <view
        x={panelX()}
        y={panelY()}
        width={panelWidth}
        height={panelHeight()}
        color={theme().colors.surface}
        borderRadius={theme().radius.medium}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        <text
          x={24}
          y={20}
          width={panelWidth - 48}
          contain="width"
          fontSize={theme().typography.title}
          color={theme().colors.text}
        >
          {props.title ?? 'Select date'}
        </text>

        <view
          x={16}
          y={68}
          width={44}
          height={44}
          color={theme().colors.surfaceRaised}
          borderRadius={theme().radius.small}
          onEnter={() => shiftMonth(-1)}
          onMouseClick={() => shiftMonth(-1)}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={8}
            width={44}
            contain="width"
            textAlign="center"
            fontSize={24}
            color={theme().colors.text}
          >
            ‹
          </text>
        </view>
        <text
          x={64}
          y={80}
          width={panelWidth - 128}
          contain="width"
          textAlign="center"
          fontSize={theme().typography.label}
          color={theme().colors.text}
        >
          {monthLabel()}
        </text>
        <view
          x={panelWidth - 60}
          y={68}
          width={44}
          height={44}
          color={theme().colors.surfaceRaised}
          borderRadius={theme().radius.small}
          onEnter={() => shiftMonth(1)}
          onMouseClick={() => shiftMonth(1)}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={8}
            width={44}
            contain="width"
            textAlign="center"
            fontSize={24}
            color={theme().colors.text}
          >
            ›
          </text>
        </view>

        <For each={weekdayLabels()}>
          {(label, index) => (
            <text
              x={20 + index() * cellWidth}
              y={124}
              width={cellWidth}
              contain="width"
              textAlign="center"
              fontSize={16}
              color={theme().colors.textMuted}
            >
              {label}
            </text>
          )}
        </For>

        <For each={Array.from({ length: 42 }, (_, index) => index)}>
          {(index) => {
            const day = () => index - firstWeekday() + 1;
            const date = () =>
              new Date(month().getFullYear(), month().getMonth(), day());
            const selected = () =>
              day() >= 1 &&
              day() <= daysInMonth() &&
              sameDay(date(), working());
            const isDisabled = () =>
              day() < 1 || day() > daysInMonth() || disabled(date());
            return (
              <Show when={day() >= 1 && day() <= daysInMonth()}>
                <view
                  x={20 + (index % 7) * cellWidth}
                  y={150 + Math.floor(index / 7) * cellHeight}
                  width={cellWidth}
                  height={cellHeight}
                  color={
                    selected() ? theme().colors.primary : theme().colors.surface
                  }
                  borderRadius={theme().radius.small}
                  onEnter={() => chooseDay(day())}
                  onMouseClick={() => chooseDay(day())}
                  cursorStyle={isDisabled() ? 'not-allowed' : 'pointer'}
                >
                  <text
                    x={0}
                    y={8}
                    width={cellWidth}
                    contain="width"
                    textAlign="center"
                    fontSize={20}
                    color={
                      selected()
                        ? theme().colors.onPrimary
                        : isDisabled()
                          ? theme().colors.textMuted
                          : theme().colors.text
                    }
                  >
                    {String(day())}
                  </text>
                </view>
              </Show>
            );
          }}
        </For>

        <Show when={props.withTime}>
          <text
            x={24}
            y={404}
            width={80}
            contain="width"
            fontSize={theme().typography.label}
            color={theme().colors.textMuted}
          >
            Time
          </text>
          <text
            x={112}
            y={404}
            width={60}
            contain="width"
            textAlign="center"
            fontSize={theme().typography.label}
            color={theme().colors.text}
          >
            {String(working().getHours()).padStart(2, '0')}
          </text>
          <view
            x={180}
            y={396}
            width={40}
            height={40}
            color={theme().colors.surfaceRaised}
            borderRadius={theme().radius.small}
            onEnter={() => shiftTime(60)}
            onMouseClick={() => shiftTime(60)}
            cursorStyle="pointer"
          >
            <text
              x={0}
              y={6}
              width={40}
              contain="width"
              textAlign="center"
              fontSize={22}
              color={theme().colors.text}
            >
              +
            </text>
          </view>
          <text
            x={236}
            y={404}
            width={60}
            contain="width"
            textAlign="center"
            fontSize={theme().typography.label}
            color={theme().colors.text}
          >
            {String(working().getMinutes()).padStart(2, '0')}
          </text>
          <view
            x={304}
            y={396}
            width={40}
            height={40}
            color={theme().colors.surfaceRaised}
            borderRadius={theme().radius.small}
            onEnter={() => shiftTime(5)}
            onMouseClick={() => shiftTime(5)}
            cursorStyle="pointer"
          >
            <text
              x={0}
              y={6}
              width={40}
              contain="width"
              textAlign="center"
              fontSize={22}
              color={theme().colors.text}
            >
              +
            </text>
          </view>
        </Show>

        <view
          x={panelWidth - 220}
          y={footerY()}
          width={90}
          height={44}
          color={theme().colors.surfaceRaised}
          borderRadius={theme().radius.small}
          onEnter={() => props.onRequestClose?.()}
          onMouseClick={() => props.onRequestClose?.()}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={10}
            width={90}
            contain="width"
            textAlign="center"
            fontSize={18}
            color={theme().colors.text}
          >
            Cancel
          </text>
        </view>
        <view
          x={panelWidth - 118}
          y={footerY()}
          width={94}
          height={44}
          color={theme().colors.primary}
          borderRadius={theme().radius.small}
          onEnter={done}
          onMouseClick={done}
          cursorStyle="pointer"
        >
          <text
            x={0}
            y={10}
            width={94}
            contain="width"
            textAlign="center"
            fontSize={18}
            color={theme().colors.onPrimary}
          >
            Done
          </text>
        </view>
      </view>
    </Modal>
  );
}
