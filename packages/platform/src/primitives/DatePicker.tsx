import { For, Show, createEffect, createSignal, type JSX } from 'solid-js';
import { activeElement } from '../core/activeElement.js';
import type { ElementNode } from '../core/elementNode.js';
import type { ForwardFocusHandler } from '../core/focusKeyTypes.js';
import { supports } from '../sdk/capabilities.js';
import { selectionFeedback } from '../sdk/device.js';
import { formatDate } from '../sdk/i18n.js';
import { useUiScale } from '../sdk/layout.js';
import { useTheme } from '../sdk/theme.jsx';
import { viewport } from '../sdk/viewport.js';
import { ChevronIcon } from './icons.jsx';
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

/**
 * A button of the picker. `plain` is the calendar's style: no fill, the
 * accent colour for symbols and the theme's selection tint under focus.
 * `filled` draws a solid accent action (used only where the platform has
 * one). Every size arrives already scaled by the panel's metrics.
 */
function PickerButton(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** Read by assistive technology when the label is a symbol. */
  ariaLabel?: string;
  /** Drawn instead of text: an icon button, like the app's round actions. */
  icon?: 'left' | 'right';
  primary?: boolean;
  plain?: boolean;
  fontSize: number;
  fontWeight?: number;
  onPress(): void;
}): JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = createSignal(false);
  const radius = () =>
    props.plain ? theme.radius.medium : Math.min(props.width, props.height) / 2;
  const background = () => {
    if (props.primary) return theme.colors.primary;
    if (props.plain && focused()) return theme.colors.selection;
    return 0x00000000;
  };
  const foreground = () => {
    if (props.primary) return theme.colors.onPrimary;
    return props.plain ? theme.colors.primary : theme.colors.text;
  };
  return (
    <view
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      color={background()}
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius={radius()}
      border={
        focused() && props.plain
          ? { width: 2, color: theme.colors.focus, align: 'inside' }
          : undefined
      }
      role="button"
      ariaLabel={props.ariaLabel ?? props.label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onEnter={() => props.onPress()}
      onMouseClick={() => props.onPress()}
      cursorStyle="pointer"
    >
      {props.icon === undefined ? (
        <text
          x={0}
          y={(props.height - props.fontSize) / 2 - 2}
          width={props.width}
          contain="width"
          textAlign="center"
          fontSize={props.fontSize}
          fontWeight={props.fontWeight}
          color={foreground()}
        >
          {props.label}
        </text>
      ) : (
        <ChevronIcon
          size={Math.max(12, Math.round(props.fontSize * 0.8))}
          direction={props.icon}
          color={foreground()}
          thickness={2}
        />
      )}
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

/** Whether the device's locale writes a 12-hour clock. No Intl: 24-hour. */
function usesHour12(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
}

/**
 * The first day of the week the device's locale uses: 0 is Sunday, 1 Monday.
 * Apple's picker follows the device location; a host without `Intl.Locale`
 * (Hermes without ICU) falls back to Sunday, the app's English default.
 */
function weekStart(): number {
  try {
    const locale = new Intl.Locale(
      Intl.DateTimeFormat().resolvedOptions().locale,
    );
    const info = (locale as unknown as { weekInfo?: { firstDay?: number } })
      .weekInfo;
    if (typeof info?.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // No Intl: the fallback below is the whole answer.
  }
  return 0;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Every picker gets an id prefix, so two open pickers cannot claim the same
// day cell for focus.
let pickerCounter = 0;

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
 * Calendar date/time dialog in the compact-picker shape Apple documents:
 * a modal calendar that can be edited several times before Done, month
 * navigation with 44-pt targets, weekday labels, a selected day drawn as a
 * filled accent circle, the current value in accent, and text actions.
 *
 * The panel is measured from the viewport and the safe area, never from a
 * fixed width. The day cells divide whatever room the panel has, so the last
 * column cannot hang off the right edge on a 320-pt phone or a 412-pt Pixel;
 * a short landscape window shrinks the rows instead of pushing the footer
 * past the bottom. The panel uses the shared `Modal` focus trap, barrier and
 * Back/Escape handling.
 */
export function DatePicker(props: DatePickerProps): JSX.Element {
  const theme = useTheme();
  const scale = useUiScale();
  const visible = () =>
    typeof props.visible === 'function' ? props.visible() : props.visible;
  const [working, setWorking] = createSignal(new Date());
  const [month, setMonth] = createSignal(new Date());
  const instance = ++pickerCounter;

  createEffect(() => {
    if (!visible()) return;
    const initial = valueOf(props.value);
    setWorking(initial);
    setMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
  });

  const tv = () => supports('remote');
  /** A design-unit constant in screen units. */
  const u = (value: number) => Math.round(value * scale);

  const safe = () => viewport().insets.safeArea;
  const availableWidth = () =>
    Math.max(0, viewport().width - safe().left - safe().right);
  const availableHeight = () =>
    Math.max(0, viewport().height - safe().top - safe().bottom);

  // A 320-wide phone gets a 288-wide panel with a 4-unit inset; a Pixel 7 Pro
  // gets 360. A TV gets a larger card, still inside its safe area.
  const margin = () => u(tv() ? 40 : 8);
  const panelWidth = () => {
    const preferred = u(tv() ? 560 : 360);
    const room = Math.max(0, availableWidth() - 2 * margin());
    // Never wider than the room, even on a window narrower than the smallest
    // phone the framework supports.
    return Math.max(Math.min(u(240), room), Math.min(preferred, room));
  };
  const padX = () => (panelWidth() < u(320) ? u(8) : u(tv() ? 24 : 16));

  const titleSize = () => u(tv() ? 30 : 17);
  const titleLine = () => titleSize() + u(6);
  const headerHeight = () => u(44);
  const weekdayHeight = () => u(tv() ? 30 : 18);
  const footerHeight = () => u(44);
  const timeHeight = () => u(44);
  const gap = () => u(tv() ? 10 : 8);

  const daysInMonth = () =>
    new Date(month().getFullYear(), month().getMonth() + 1, 0).getDate();
  const weekStartDay = () => weekStart();
  const firstWeekday = () => (month().getDay() - weekStartDay() + 7) % 7;
  /** Four to six rows, so a 28-day February does not reserve six. */
  const weeks = () => Math.ceil((firstWeekday() + daysInMonth()) / 7);
  const weekdayLabels = () =>
    Array.from({ length: 7 }, (_, index) => {
      // 2024-01-07 is a Sunday; rotate by the locale's first day.
      const day = (weekStartDay() + index) % 7;
      return formatOr(
        new Date(2024, 0, 7 + day),
        { weekday: 'narrow' },
        WEEKDAYS[day]!,
      );
    });
  const monthLabel = () =>
    formatOr(
      month(),
      { month: 'long', year: 'numeric' },
      `${MONTHS[month().getMonth()]} ${month().getFullYear()}`,
    );

  // A short window (a phone on its side, a 540-pt TV stage) keeps the
  // calendar usable by shrinking the rows and the surrounding gaps: it never
  // pushes the footer off the bottom.
  const compact = () => availableHeight() < u(520);
  const panelPadY = () => (compact() ? u(8) : u(16));
  const stackGap = () => (compact() ? u(4) : gap());
  const showTitle = () => !compact();

  const fixedHeight = () => {
    let total = panelPadY() * 2;
    if (showTitle()) total += titleLine() + stackGap();
    total += headerHeight() + stackGap();
    total += weekdayHeight() + stackGap();
    if (props.withTime) total += timeHeight() + stackGap();
    total += footerHeight() + stackGap();
    return total;
  };
  const cellHeight = () => {
    const room = availableHeight() - 2 * margin() - fixedHeight();
    const target = u(tv() ? 56 : 44);
    return Math.max(0, Math.min(target, Math.floor(room / weeks())));
  };
  const panelHeight = () => fixedHeight() + cellHeight() * weeks();
  const panelX = () =>
    Math.round(
      safe().left + Math.max(margin(), (availableWidth() - panelWidth()) / 2),
    );
  const panelY = () =>
    Math.round(
      safe().top + Math.max(margin(), (availableHeight() - panelHeight()) / 2),
    );

  const titleY = () => panelPadY();
  const headerY = () => titleY() + (showTitle() ? titleLine() + stackGap() : 0);
  const weekdayY = () => headerY() + headerHeight() + stackGap();
  const gridY = () => weekdayY() + weekdayHeight() + stackGap();
  const timeY = () => gridY() + weeks() * cellHeight() + stackGap();
  const footerY = () =>
    (props.withTime
      ? timeY() + timeHeight()
      : gridY() + weeks() * cellHeight()) + stackGap();

  const gridWidth = () => panelWidth() - padX() * 2;
  const cellWidth = () => Math.floor(gridWidth() / 7);
  const gridX = () => padX() + Math.floor((gridWidth() - cellWidth() * 7) / 2);

  const selectedDaySize = () =>
    Math.max(0, Math.min(cellWidth(), cellHeight()) - u(8));
  const dayFontSize = () =>
    Math.max(
      u(10),
      Math.min(u(tv() ? 28 : 17), Math.max(u(10), cellHeight() - u(2))),
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
    void selectionFeedback();
    setWorking(next);
  };

  const shiftMonth = (delta: number) => {
    void selectionFeedback();
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };

  const shiftTime = (minutes: number) => {
    void selectionFeedback();
    const next = new Date(working());
    next.setMinutes(next.getMinutes() + minutes);
    setWorking(next);
  };

  const done = () => {
    props.onChange?.(new Date(working()));
    if (props.closeOnSelect !== false) props.onRequestClose?.();
  };

  let panel: ElementNode | undefined;
  let grid: ElementNode | undefined;

  /**
   * The focusable cell for a day. It is found in the live grid rather than
   * kept in a side table, so a month change can never leave focus pointing at
   * yesterday's node.
   */
  const cellPrefix = () => `date-picker-${instance}-day-`;
  const dayOf = (node: ElementNode | undefined): number | undefined => {
    const id = node?.id;
    if (typeof id !== 'string' || !id.startsWith(cellPrefix()))
      return undefined;
    const day = Number(id.slice(cellPrefix().length));
    return Number.isFinite(day) ? day : undefined;
  };
  const cellFor = (day: number): ElementNode | undefined => {
    const children = grid?.children;
    if (children === undefined) return undefined;
    const id = `${cellPrefix()}${day}`;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as ElementNode | undefined;
      if (child !== undefined && child.id === id) return child;
    }
    return undefined;
  };

  const focusDay = (day: number) => {
    let cell = cellFor(day);
    if (cell?.skipFocus === true) {
      // The chosen day may be outside min/max: land on the nearest in-month
      // day that can actually be chosen.
      for (let d = day + 1; d <= daysInMonth(); d++) {
        const candidate = cellFor(d);
        if (candidate !== undefined && candidate.skipFocus !== true) {
          cell = candidate;
          break;
        }
      }
      if (cell?.skipFocus === true) {
        for (let d = day - 1; d >= 1; d--) {
          const candidate = cellFor(d);
          if (candidate !== undefined && candidate.skipFocus !== true) {
            cell = candidate;
            break;
          }
        }
      }
    }
    if (cell !== undefined && cell.skipFocus !== true) {
      cell.setFocus();
      return true;
    }
    return false;
  };

  const enterGrid: ForwardFocusHandler = () => {
    const chosen = working();
    const shown = month();
    const day =
      chosen.getFullYear() === shown.getFullYear() &&
      chosen.getMonth() === shown.getMonth()
        ? chosen.getDate()
        : 1;
    if (focusDay(day)) return true;
    const children = grid?.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as ElementNode | undefined;
      if (
        child !== undefined &&
        typeof child.setFocus === 'function' &&
        child.skipFocus !== true
      ) {
        child.setFocus();
        return true;
      }
    }
    return false;
  };

  const currentDay = (): number => {
    const active = activeElement();
    const children = grid?.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as ElementNode | undefined;
      if (child === active) {
        const day = dayOf(child);
        if (day !== undefined) return day;
      }
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
    const shown = month();
    let next = new Date(
      shown.getFullYear(),
      shown.getMonth(),
      currentDay() + delta,
    );
    // Every onscreen focusable must be actionable: step over disabled days
    // (a min/max range, a blocked date) instead of parking focus on one.
    let guard = 0;
    while (disabled(next) && guard++ < 62) {
      next = new Date(
        next.getFullYear(),
        next.getMonth(),
        next.getDate() + delta,
      );
    }
    if (disabled(next)) return true;
    if (delta === 7 || delta === -7) {
      // Up/Down past the first or last week leaves the grid for the row
      // above/below, as before.
      if (
        next.getFullYear() !== shown.getFullYear() ||
        next.getMonth() !== shown.getMonth()
      )
        return false;
      focusDay(next.getDate());
      return true;
    }
    if (
      next.getFullYear() !== shown.getFullYear() ||
      next.getMonth() !== shown.getMonth()
    ) {
      pendingDay = next.getDate();
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    } else {
      focusDay(next.getDate());
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

  // The time row is one action group: two steppers, and (where the locale
  // uses it) an AM/PM toggle. Sizes shrink together on a narrow panel.
  const hour12 = () => usesHour12();
  const timeButton = () =>
    Math.min(u(44), Math.max(u(32), Math.floor((gridWidth() - u(40)) / 6)));
  const timeValueWidth = () => Math.max(u(28), timeButton() - u(6));
  const timeGroupWidth = () => timeButton() * 2 + timeValueWidth();
  const timeSecondX = () => timeGroupWidth() + stackGap();
  const meridiemX = () => timeSecondX() + timeGroupWidth() + stackGap();
  const showMeridiem = () =>
    hour12() && meridiemX() + timeButton() <= gridWidth();
  const timeTotalWidth = () =>
    showMeridiem()
      ? meridiemX() + timeButton()
      : timeSecondX() + timeGroupWidth();
  const timeStartX = () =>
    Math.max(0, Math.floor((gridWidth() - timeTotalWidth()) / 2));
  const hourLabel = () => {
    const hour = working().getHours();
    if (!hour12()) return String(hour).padStart(2, '0');
    return String(hour % 12 === 0 ? 12 : hour % 12);
  };
  const minuteLabel = () => String(working().getMinutes()).padStart(2, '0');
  const meridiem = () => (working().getHours() < 12 ? 'AM' : 'PM');
  const toggleMeridiem = () => {
    void selectionFeedback();
    const next = new Date(working());
    next.setHours((next.getHours() + 12) % 24);
    setWorking(next);
  };

  return (
    <Modal
      visible={visible()}
      onRequestClose={() => props.onRequestClose?.()}
      label={props.title ?? 'Select date'}
      transparent
      // Apple's compact picker dims its parent and confirms the current
      // value when people tap outside; Cancel is the explicit discard.
      barrierColor={0x00000080}
      onBackdrop={done}
      // The panel measures the safe area itself; Modal's inset box would
      // apply it a second time and shift the card down and right.
      useSafeArea={false}
      initialFocus={() => panel}
    >
      {/* Rows top to bottom: title, month, weekdays, days, time, actions.
          Up and Down move between the ones that take focus; it opens on the
          days (index 3). The indexes are child positions, as the panel's
          forwardFocus walks them. */}
      <view
        ref={(node) => {
          panel = node as ElementNode;
        }}
        id="date-picker-panel"
        x={panelX()}
        y={panelY()}
        width={panelWidth()}
        height={panelHeight()}
        color={theme.colors.surfaceRaised}
        borderRadius={theme.radius.medium}
        border={{ width: 1, color: theme.colors.border, align: 'inside' }}
        role="none"
        selected={showTitle() ? 3 : 2}
        forwardFocus={navigableForwardFocus}
        onUp={onUp}
        onDown={onDown}
        onMouseClick={() => true}
        onEnter={() => true}
      >
        <Show when={showTitle()}>
          <text
            skipFocus
            x={padX()}
            y={titleY()}
            width={panelWidth() - padX() * 2}
            contain="width"
            fontSize={titleSize()}
            color={theme.colors.text}
          >
            {props.title ?? 'Select date'}
          </text>
        </Show>

        {/* Left on the first button and Right on the last change the month
            as the buttons themselves do. */}
        <view
          x={padX()}
          y={headerY()}
          width={gridWidth()}
          height={headerHeight()}
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
            width={headerHeight()}
            height={headerHeight()}
            label="Previous month"
            ariaLabel="Previous month"
            icon="left"
            plain
            fontSize={u(20)}
            onPress={() => shiftMonth(-1)}
          />
          <text
            skipFocus
            x={headerHeight()}
            y={(headerHeight() - u(17)) / 2 - 2}
            width={gridWidth() - headerHeight() * 2}
            contain="width"
            textAlign="center"
            fontSize={u(tv() ? 30 : 17)}
            fontWeight={700}
            color={theme.colors.text}
          >
            {monthLabel()}
          </text>
          <PickerButton
            x={gridWidth() - headerHeight()}
            y={0}
            width={headerHeight()}
            height={headerHeight()}
            label="Next month"
            ariaLabel="Next month"
            icon="right"
            plain
            fontSize={u(20)}
            onPress={() => shiftMonth(1)}
          />
        </view>

        <view
          skipFocus
          x={gridX()}
          y={weekdayY()}
          width={cellWidth() * 7}
          height={weekdayHeight()}
        >
          <For each={weekdayLabels()}>
            {(label, index) => (
              <text
                x={index() * cellWidth()}
                y={0}
                width={cellWidth()}
                contain="width"
                textAlign="center"
                fontSize={u(tv() ? 22 : 13)}
                color={theme.colors.textMuted}
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
          x={gridX()}
          y={gridY()}
          width={cellWidth() * 7}
          height={weeks() * cellHeight()}
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
          <For each={Array.from({ length: weeks() * 7 }, (_, index) => index)}>
            {(index) => {
              const day = () => index - firstWeekday() + 1;
              const date = () =>
                new Date(month().getFullYear(), month().getMonth(), day());
              const selected = () =>
                day() >= 1 &&
                day() <= daysInMonth() &&
                sameDay(date(), working());
              const today = () =>
                day() >= 1 &&
                day() <= daysInMonth() &&
                sameDay(date(), new Date());
              const isDisabled = () =>
                day() < 1 || day() > daysInMonth() || disabled(date());
              const [focused, setFocused] = createSignal(false);
              const circle = () => selectedDaySize();
              return (
                <Show when={day() >= 1 && day() <= daysInMonth()}>
                  <view
                    id={`date-picker-${instance}-day-${day()}`}
                    x={(index % 7) * cellWidth()}
                    y={Math.floor(index / 7) * cellHeight()}
                    width={cellWidth()}
                    height={cellHeight()}
                    color={0x00000000}
                    borderRadius={Math.min(cellWidth(), cellHeight()) / 2}
                    border={
                      focused()
                        ? {
                            width: 2,
                            color: theme.colors.focus,
                            align: 'inside',
                          }
                        : undefined
                    }
                    ariaSelected={selected()}
                    ariaDisabled={isDisabled()}
                    skipFocus={isDisabled()}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onEnter={() => chooseDay(day())}
                    onMouseClick={() => chooseDay(day())}
                    cursorStyle={isDisabled() ? 'not-allowed' : 'pointer'}
                  >
                    {/* The selection is the circle, not the cell: the touch
                        target stays the full row height. */}
                    <view
                      skipFocus
                      x={(cellWidth() - circle()) / 2}
                      y={(cellHeight() - circle()) / 2}
                      width={circle()}
                      height={circle()}
                      borderRadius={circle() / 2}
                      color={selected() ? theme.colors.primary : 0x00000000}
                    />
                    <text
                      skipFocus
                      x={0}
                      y={(cellHeight() - dayFontSize()) / 2 - 2}
                      width={cellWidth()}
                      contain="width"
                      textAlign="center"
                      fontSize={dayFontSize()}
                      color={
                        selected()
                          ? theme.colors.onPrimary
                          : isDisabled()
                            ? theme.colors.textMuted
                            : today()
                              ? theme.colors.primary
                              : theme.colors.text
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
          x={padX()}
          y={timeY()}
          width={gridWidth()}
          height={props.withTime ? timeHeight() : 0}
          selected={2}
          forwardFocus={navigableForwardFocus}
          onLeft={onLeft}
          onRight={onRight}
        >
          <Show when={props.withTime}>
            <PickerButton
              x={timeStartX()}
              y={(timeHeight() - timeButton()) / 2}
              width={timeButton()}
              height={timeButton()}
              label="−"
              ariaLabel="Subtract an hour"
              plain
              fontSize={u(22)}
              onPress={() => shiftTime(-60)}
            />
            <text
              skipFocus
              x={timeStartX() + timeButton()}
              y={(timeHeight() - u(18)) / 2 - 2}
              width={timeValueWidth()}
              contain="width"
              textAlign="center"
              fontSize={u(tv() ? 30 : 18)}
              color={theme.colors.text}
            >
              {hourLabel()}
            </text>
            <PickerButton
              x={timeStartX() + timeButton() + timeValueWidth()}
              y={(timeHeight() - timeButton()) / 2}
              width={timeButton()}
              height={timeButton()}
              label="+"
              ariaLabel="Add an hour"
              plain
              fontSize={u(22)}
              onPress={() => shiftTime(60)}
            />
            <PickerButton
              x={timeStartX() + timeSecondX()}
              y={(timeHeight() - timeButton()) / 2}
              width={timeButton()}
              height={timeButton()}
              label="−"
              ariaLabel="Subtract 5 minutes"
              plain
              fontSize={u(22)}
              onPress={() => shiftTime(-5)}
            />
            <text
              skipFocus
              x={timeStartX() + timeSecondX() + timeButton()}
              y={(timeHeight() - u(18)) / 2 - 2}
              width={timeValueWidth()}
              contain="width"
              textAlign="center"
              fontSize={u(tv() ? 30 : 18)}
              color={theme.colors.text}
            >
              {minuteLabel()}
            </text>
            <PickerButton
              x={timeStartX() + timeSecondX() + timeButton() + timeValueWidth()}
              y={(timeHeight() - timeButton()) / 2}
              width={timeButton()}
              height={timeButton()}
              label="+"
              ariaLabel="Add 5 minutes"
              plain
              fontSize={u(22)}
              onPress={() => shiftTime(5)}
            />
            <Show when={showMeridiem()}>
              <PickerButton
                x={timeStartX() + meridiemX()}
                y={(timeHeight() - timeButton()) / 2}
                width={timeButton()}
                height={timeButton()}
                label={meridiem()}
                ariaLabel={`Switch to ${meridiem() === 'AM' ? 'PM' : 'AM'}`}
                plain
                fontSize={u(15)}
                onPress={toggleMeridiem}
              />
            </Show>
          </Show>
        </view>

        {/* Focus arrives on Done, the action a chosen day leads to. */}
        <view
          x={panelWidth() - padX() - u(148)}
          y={footerY()}
          width={u(148)}
          height={footerHeight()}
          selected={1}
          forwardFocus={navigableForwardFocus}
          onLeft={onLeft}
          onRight={onRight}
        >
          <PickerButton
            x={0}
            y={0}
            width={u(68)}
            height={footerHeight()}
            label="Cancel"
            plain
            fontSize={u(tv() ? 26 : 17)}
            onPress={() => props.onRequestClose?.()}
          />
          <PickerButton
            x={u(76)}
            y={0}
            width={u(72)}
            height={footerHeight()}
            label="Done"
            plain
            fontSize={u(tv() ? 26 : 17)}
            fontWeight={700}
            onPress={done}
          />
        </view>
      </view>
    </Modal>
  );
}
