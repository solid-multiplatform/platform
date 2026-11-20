import { For, Show, createEffect, createSignal, type JSX } from 'solid-js';
import { activeElement } from '../core/activeElement.js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { formatDate } from '../sdk/i18n.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { Modal } from './Modal.jsx';
import {
  handleNavigation,
  navigableForwardFocus,
} from './utils/handleNavigation.js';

// The panel and its rows are the containers `Row` and `Column` are, without
// their flex layout: the calendar keeps its own positions.
const onUp = handleNavigation('up');
const onDown = handleNavigation('down');
const onLeft = handleNavigation('left');
const onRight = handleNavigation('right');

/** A button of the picker: outlined while it has focus. */
function PickerButton(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** Read by assistive technology when the label is a symbol. */
  ariaLabel?: string;
  primary?: boolean;
  fontSize: number;
  onPress(): void;
}): JSX.Element {
  const theme = () => useTheme();
  const [focused, setFocused] = createSignal(false);
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      color={
        props.primary ? theme().colors.primary : theme().colors.surfaceRaised
      }
      borderRadius={theme().radius.small}
      border={{ width: focused() ? 3 : 0, color: theme().colors.text }}
      role="button"
      ariaLabel={props.ariaLabel ?? props.label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onEnter={() => props.onPress()}
      onMouseClick={() => props.onPress()}
      cursorStyle="pointer"
    >
      <text
        x={0}
        y={(props.height - props.fontSize) / 2 - 2}
        width={props.width}
        contain="width"
        textAlign="center"
        fontSize={props.fontSize}
        color={props.primary ? theme().colors.onPrimary : theme().colors.text}
      >
        {props.label}
      </text>
    </view>
  );
}

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

// The host may have no `Intl` (the desktop runtime embeds Hermes without it):
// `formatDate` then throws for both the locale and its own fallback. The
// labels are what a picker cannot open without, so each has an English one
// the exception falls back to — the dialog must render and take keys.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
// Narrow weekday initials, Sunday first, as formatDate({ weekday: 'narrow' }).
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const formatOr = (
  date: Date,
  options: Intl.DateTimeFormatOptions,
  fallback: string,
): string => {
  try {
    return formatDate(date, options);
  } catch {
    return fallback;
  }
};

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
      formatOr(
        new Date(2024, 0, 7 + index),
        { weekday: 'narrow' },
        WEEKDAYS[index]!,
      ),
    );
  const monthLabel = () =>
    formatOr(
      month(),
      { month: 'long', year: 'numeric' },
      `${MONTHS[month().getMonth()]} ${month().getFullYear()}`,
    );

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

  let panel: ElementNode | undefined;
  let grid: ElementNode | undefined;

  // The grid's children are the days of the month in order: day 1 is first.
  const focusDay = (day: number) =>
    (grid?.children[day - 1] as ElementNode | undefined)?.setFocus();

  // Focus enters the grid on the chosen day, or on the 1st of another month.
  const enterGrid: ForwardFocusHandler = () => {
    const chosen = working();
    const shown = month();
    const day =
      chosen.getFullYear() === shown.getFullYear() &&
      chosen.getMonth() === shown.getMonth()
        ? chosen.getDate()
        : 1;
    if (grid?.children[day - 1] === undefined) return false;
    focusDay(day);
    return true;
  };

  /**
   * The day the next arrow step starts from. Focus is normally on a day; if
   * it is on the grid itself — the day children were not inserted yet when
   * the dialog took focus — start from the chosen day instead of losing every
   * direction (`children.indexOf(grid)` is -1).
   */
  const currentDay = (): number => {
    const active = activeElement();
    if (grid !== undefined && active !== grid) {
      const index = grid.children.indexOf(active as ElementNode);
      if (index >= 0) return index + 1;
    }
    const chosen = working();
    const shown = month();
    return chosen.getFullYear() === shown.getFullYear() &&
      chosen.getMonth() === shown.getMonth()
      ? chosen.getDate()
      : 1;
  };

  /**
   * Left and Right move by a day and cross into the next month; Up and Down
   * move by a week and, past the first or last week, leave the grid for the
   * row above or below it (the key is not taken).
   */
  const moveDay = (delta: number): boolean => {
    if (grid === undefined) return false;
    const day = currentDay();
    const target = day + delta;
    const outside = target < 1 || target > daysInMonth();
    if (outside && (delta === 7 || delta === -7)) return false;
    const next = new Date(month().getFullYear(), month().getMonth(), target);
    if (disabled(next)) return true;
    if (outside) {
      // The other month's days exist once this key's updates have run.
      pendingDay = next.getDate();
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    } else {
      focusDay(target);
    }
    return true;
  };
  let pendingDay: number | undefined;
  createEffect(() => {
    month();
    if (pendingDay === undefined) return;
    const day = pendingDay;
    pendingDay = undefined;
    focusDay(day);
  });

  return (
    <Modal
      visible={visible()}
      onRequestClose={() => props.onRequestClose?.()}
      label={props.title ?? 'Select date'}
      transparent
      initialFocus={() => panel}
    >
      {/* Rows top to bottom: title, month, weekdays, days, time, actions.
          Up and Down move between the ones that take focus; it opens on the
          days (index 3). */}
      <view
        ref={(node) => {
          panel = node as ElementNode;
        }}
        x={panelX()}
        y={panelY()}
        width={panelWidth}
        height={panelHeight()}
        color={theme().colors.surface}
        borderRadius={theme().radius.medium}
        role="none"
        selected={3}
        forwardFocus={navigableForwardFocus}
        onUp={onUp}
        onDown={onDown}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        <text
          skipFocus
          x={24}
          y={20}
          width={panelWidth - 48}
          contain="width"
          fontSize={theme().typography.title}
          color={theme().colors.text}
        >
          {props.title ?? 'Select date'}
        </text>

        {/* Left on the first button and Right on the last change the month
            as the buttons themselves do. */}
        <view
          x={16}
          y={68}
          width={panelWidth - 32}
          height={44}
          selected={0}
          forwardFocus={navigableForwardFocus}
          onLeft={function (this: ElementNode, ...args) {
            if (onLeft.apply(this, args) !== true) shiftMonth(-1);
            return true;
          }}
          onRight={function (this: ElementNode, ...args) {
            if (onRight.apply(this, args) !== true) shiftMonth(1);
            return true;
          }}
        >
          <PickerButton
            x={0}
            y={0}
            width={44}
            height={44}
            label="<"
            ariaLabel="Previous month"
            fontSize={24}
            onPress={() => shiftMonth(-1)}
          />
          <text
            skipFocus
            x={48}
            y={12}
            width={panelWidth - 128}
            contain="width"
            textAlign="center"
            fontSize={theme().typography.label}
            color={theme().colors.text}
          >
            {monthLabel()}
          </text>
          <PickerButton
            x={panelWidth - 76}
            y={0}
            width={44}
            height={44}
            label=">"
            ariaLabel="Next month"
            fontSize={24}
            onPress={() => shiftMonth(1)}
          />
        </view>

        <view skipFocus x={20} y={124} width={7 * cellWidth} height={20}>
          <For each={weekdayLabels()}>
            {(label, index) => (
              <text
                x={index() * cellWidth}
                y={0}
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
        </view>

        <view
          ref={(node) => {
            grid = node as ElementNode;
          }}
          x={20}
          y={150}
          width={7 * cellWidth}
          height={6 * cellHeight}
          forwardFocus={enterGrid}
          onLeft={() => moveDay(-1)}
          onRight={() => moveDay(1)}
          onUp={() => moveDay(-7)}
          onDown={() => moveDay(7)}
          // Focus can land on the grid itself (the panel is its forwardFocus
          // fallback); Enter then picks the day arrows would start from.
          onEnter={() => {
            chooseDay(currentDay());
            return true;
          }}
        >
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
              const [focused, setFocused] = createSignal(false);
              return (
                <Show when={day() >= 1 && day() <= daysInMonth()}>
                  <view
                    x={(index % 7) * cellWidth}
                    y={Math.floor(index / 7) * cellHeight}
                    width={cellWidth}
                    height={cellHeight}
                    color={
                      selected()
                        ? theme().colors.primary
                        : focused()
                          ? theme().colors.surfaceRaised
                          : theme().colors.surface
                    }
                    borderRadius={theme().radius.small}
                    border={{
                      width: focused() ? 3 : 0,
                      color: theme().colors.text,
                    }}
                    ariaSelected={selected()}
                    ariaDisabled={isDisabled()}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
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
        </view>

        {/* Always a row of the panel, so that the rows keep their places;
            without a time it is empty and passed over. */}
        <view
          skipFocus={!props.withTime}
          x={0}
          y={396}
          width={panelWidth}
          height={40}
          selected={2}
          forwardFocus={navigableForwardFocus}
          onLeft={onLeft}
          onRight={onRight}
        >
          <Show when={props.withTime}>
            <text
              skipFocus
              x={24}
              y={8}
              width={80}
              contain="width"
              fontSize={theme().typography.label}
              color={theme().colors.textMuted}
            >
              Time
            </text>
            <text
              skipFocus
              x={112}
              y={8}
              width={60}
              contain="width"
              textAlign="center"
              fontSize={theme().typography.label}
              color={theme().colors.text}
            >
              {String(working().getHours()).padStart(2, '0')}
            </text>
            <PickerButton
              x={180}
              y={0}
              width={40}
              height={40}
              label="+"
              ariaLabel="Add an hour"
              fontSize={22}
              onPress={() => shiftTime(60)}
            />
            <text
              skipFocus
              x={236}
              y={8}
              width={60}
              contain="width"
              textAlign="center"
              fontSize={theme().typography.label}
              color={theme().colors.text}
            >
              {String(working().getMinutes()).padStart(2, '0')}
            </text>
            <PickerButton
              x={304}
              y={0}
              width={40}
              height={40}
              label="+"
              ariaLabel="Add 5 minutes"
              fontSize={22}
              onPress={() => shiftTime(5)}
            />
          </Show>
        </view>

        {/* Focus arrives on Done, the action a chosen day leads to. */}
        <view
          x={panelWidth - 220}
          y={footerY()}
          width={196}
          height={44}
          selected={1}
          forwardFocus={navigableForwardFocus}
          onLeft={onLeft}
          onRight={onRight}
        >
          <PickerButton
            x={0}
            y={0}
            width={90}
            height={44}
            label="Cancel"
            fontSize={18}
            onPress={() => props.onRequestClose?.()}
          />
          <PickerButton
            x={102}
            y={0}
            width={94}
            height={44}
            label="Done"
            primary
            fontSize={18}
            onPress={done}
          />
        </view>
      </view>
    </Modal>
  );
}
