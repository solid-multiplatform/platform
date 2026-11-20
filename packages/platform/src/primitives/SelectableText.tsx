import {
  createEffect,
  createMemo,
  createSignal,
  For,
  splitProps,
  type JSX,
} from 'solid-js';
import type {
  ElementNode,
  TextProps as NodeTextProps,
} from '@solid-multiplatform/platform';
import { writeClipboard } from '../sdk/device.js';
import { serviceAvailable } from '../sdk/registry.js';
import { useTheme, type Theme } from '../sdk/theme.jsx';
import {
  charIndexAt,
  nextWordBoundary,
  rangeSegments,
  selectedText,
  wordRangeAt,
  type SelectionLayout,
  type SelectionRange,
  type SelectionSegment,
} from './selectionModel.js';

/** How long two clicks count as a double click, in milliseconds. */
const DOUBLE_CLICK_MS = 400;
/** How far apart two clicks may be and still be a double click, in pixels. */
const DOUBLE_CLICK_SLOP = 8;

/** The key event fields selection reads; hosts without a DOM may omit them. */
type SelectionKeyEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export interface SelectableTextProps extends NodeTextProps {
  /** Accepted so `<Text selectable>` can spread its props; always selectable. */
  selectable?: boolean;
  /** A step of the theme's type scale (`body` when omitted), or a font size. */
  size?: keyof Theme['typography'] | number;
  /** Draws in the theme's secondary text colour. */
  muted?: boolean;
  /** Called with the selected text, or null when the selection is cleared. */
  onSelectionChange?: (text: string | null) => void;
  /** The highlight colour; the theme's `selection` when omitted. */
  selectionColor?: number;
}

/**
 * Text whose characters can be selected with a pointer and copied.
 *
 * A drag across the text selects from the point it went down at to the
 * current point; a drag that leaves the box extends to the nearest end; a
 * double click selects a word, and a double-click drag extends by words.
 * Releasing keeps the selection; a click without a drag clears it. On a host
 * with keys, Shift+Arrow extends by character, Shift+Ctrl/Cmd+Arrow by word,
 * Ctrl/Cmd+C copies, and Escape clears. An app writes none of this.
 *
 * The highlight is drawn in the scene behind the glyphs: one quad per line
 * segment, in the theme's `selection` colour. It works with wrapped,
 * truncated and letter-spaced text because the geometry comes from the
 * backend that laid the glyphs out. A host with no pointer cannot select
 * (`selectable` is a no-op there); a host with no clipboard service logs a
 * warning instead of copying.
 */
export function SelectableText(props: SelectableTextProps): JSX.Element {
  const theme = () => useTheme();
  const [local, rest] = splitProps(props, [
    'size',
    'muted',
    'children',
    'onSelectionChange',
    'selectionColor',
    'selectable',
    'onEvent',
    'autofocus',
    'x',
    'y',
    'width',
    'height',
  ]);
  const [selection, setSelection] = createSignal<SelectionRange | null>(null);
  const [layout, setLayout] = createSignal<SelectionLayout | null>(null);
  const [measured, setMeasured] = createSignal({ w: 0, h: 0 });

  let wrapper: ElementNode | undefined;
  let textNode: ElementNode | undefined;
  /** The geometry a drag started on, used for the whole gesture. */
  let dragLayout: SelectionLayout | null = null;
  /** Whether the current drag extends by whole words. */
  let snapWord = false;
  /** The last click, for recognising a double click without a timer. */
  let lastClick = { time: 0, x: 0, y: 0 };

  /** The text backend's line geometry, as the selection model reads it. */
  const readLayout = (): SelectionLayout | null => {
    const geometry = textNode?.getTextGeometry();
    return geometry === null || geometry === undefined
      ? null
      : { text: geometry.text, lines: geometry.lines };
  };

  const localPoint = (point: { x: number; y: number }) => ({
    x: point.x - (wrapper?.absX || 0),
    y: point.y - (wrapper?.absY || 0),
  });

  const segments = createMemo<SelectionSegment[]>(() => {
    const current = layout();
    const range = selection();
    return current !== null && range !== null
      ? rangeSegments(current, range)
      : [];
  });

  const selected = createMemo<string | null>(() => {
    const current = layout();
    const range = selection();
    return current !== null && range !== null
      ? selectedText(current, range)
      : null;
  });

  createEffect(() => {
    local.onSelectionChange?.(selected());
  });

  const apply = (next: SelectionLayout, range: SelectionRange) => {
    setLayout(next);
    setSelection(range);
  };

  const clear = () => {
    dragLayout = null;
    snapWord = false;
    setLayout(null);
    setSelection(null);
  };

  /**
   * Copy the selection through the host's clipboard service. Returns the
   * copied string (the tests' handle on it), or null when nothing is
   * selected or the host has no clipboard.
   */
  const copySelection = (): string | null => {
    const text = selected();
    if (text === null || text.length === 0) return null;
    if (serviceAvailable('clipboard') === 'unavailable') {
      console.warn(
        'SelectableText: this host has no clipboard service; nothing was copied',
      );
      return null;
    }
    // The write is asynchronous, the copy is already decided by the service's
    // availability (and browsers keep the gesture for it).
    void writeClipboard(text).catch((error: unknown) => {
      console.warn('SelectableText: clipboard write failed', error);
    });
    return text;
  };

  const selectWordAt = (
    current: SelectionLayout,
    point: { x: number; y: number },
  ) => {
    const index = charIndexAt(current, point.x, point.y);
    apply(current, wordRangeAt(current, index));
  };

  const onMouseClick = (point: { x: number; y: number }) => {
    wrapper?.setFocus();
    const now = Date.now();
    const local = localPoint(point);
    const isDouble =
      now - lastClick.time < DOUBLE_CLICK_MS &&
      Math.abs(local.x - lastClick.x) < DOUBLE_CLICK_SLOP &&
      Math.abs(local.y - lastClick.y) < DOUBLE_CLICK_SLOP;
    lastClick = { time: now, x: local.x, y: local.y };
    if (isDouble === false) {
      clear();
      return;
    }
    // A second click selected the word; keep it and let the next press drag.
    const current = readLayout();
    if (current !== null) selectWordAt(current, local);
  };

  const onPointerDrag = (
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: { x: number; y: number },
    origin: { x: number; y: number },
  ) => {
    wrapper?.setFocus();
    if (phase === 'start') {
      const current = readLayout();
      if (current === null) return;
      const now = Date.now();
      const local = localPoint(origin);
      snapWord =
        now - lastClick.time < DOUBLE_CLICK_MS &&
        Math.abs(local.x - lastClick.x) < DOUBLE_CLICK_SLOP &&
        Math.abs(local.y - lastClick.y) < DOUBLE_CLICK_SLOP;
      dragLayout = current;
      if (snapWord === true) {
        selectWordAt(current, local);
      } else {
        const index = charIndexAt(current, local.x, local.y);
        apply(current, { anchor: index, focus: index });
      }
      // Extend at once to where the pointer is when the drag was recognised.
      if (phase === 'start') extendTo(point);
      return;
    }
    if (phase === 'end') {
      extendTo(point);
      dragLayout = null;
      snapWord = false;
      return;
    }
    if (phase === 'move') {
      extendTo(point);
    }
    // 'cancel': keep what was selected, as releasing does.
  };

  const extendTo = (point: { x: number; y: number }) => {
    const current = dragLayout ?? layout() ?? readLayout();
    const range = selection();
    if (current === null || range === null) return;
    const local = localPoint(point);
    const index = charIndexAt(current, local.x, local.y);
    let focus = index;
    if (snapWord === true) {
      const word = wordRangeAt(current, index);
      focus = index < range.anchor ? word.anchor : word.focus;
    }
    apply(current, { anchor: range.anchor, focus });
  };

  const onKeyPress = (event: SelectionKeyEvent): boolean => {
    const key = event.key;
    const withModifier = event.ctrlKey === true || event.metaKey === true;
    if (withModifier && (key === 'c' || key === 'C') && selection() !== null) {
      copySelection();
      return true;
    }
    if (key === 'Escape' && selection() !== null) {
      clear();
      return true;
    }
    if (event.shiftKey !== true) return false;
    const direction = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    if (direction === 0) return false;
    const current = layout() ?? readLayout();
    if (current === null) return false;
    const range = selection();
    const anchor = range?.anchor ?? 0;
    const focus = range?.focus ?? 0;
    const next =
      withModifier === true
        ? nextWordBoundary(current.text, focus, direction)
        : Math.max(0, Math.min(current.text.length, focus + direction));
    apply(current, { anchor, focus: next });
    return true;
  };

  /** The `loaded` event carries the measured size; it sizes the wrapper. */
  const onEvent = {
    ...(local.onEvent ?? {}),
    loaded(
      target: ElementNode,
      event?: { dimensions?: { w?: number; h?: number } },
    ) {
      const dimensions = event?.dimensions;
      if (dimensions !== undefined) {
        setMeasured({ w: dimensions.w ?? 0, h: dimensions.h ?? 0 });
      }
      const previous = (
        local.onEvent as
          | { loaded?: (target: ElementNode, event?: unknown) => void }
          | undefined
      )?.loaded;
      previous?.call(target, target, event);
    },
  };

  const wrapperWidth = () => local.width ?? measured().w;
  const wrapperHeight = () => local.height ?? measured().h;

  return (
    <view
      ref={wrapper}
      x={local.x}
      y={local.y}
      width={wrapperWidth()}
      height={wrapperHeight()}
      autofocus={local.autofocus}
      cursorStyle="text"
      onMouseClick={onMouseClick}
      onPointerDrag={onPointerDrag}
      onKeyPress={onKeyPress}
    >
      <For each={segments()}>
        {(segment) => (
          <view
            x={segment.x}
            y={segment.y}
            width={segment.width}
            height={segment.height}
            color={local.selectionColor ?? theme().colors.selection}
          />
        )}
      </For>
      <text
        ref={textNode}
        x={0}
        y={0}
        width={local.width}
        height={local.height}
        skipFocus
        fontSize={
          typeof local.size === 'number'
            ? local.size
            : theme().typography[local.size ?? 'body']
        }
        color={local.muted ? theme().colors.textMuted : theme().colors.text}
        onEvent={onEvent}
        {...rest}
      >
        {local.children}
      </text>
    </view>
  );
}
