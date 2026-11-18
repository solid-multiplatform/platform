import { createSignal, type Accessor } from 'solid-js';
import type { Point } from './input.js';

export interface Section<T> {
  /** Stable key, useful for React-style reconciliation. */
  key?: string;
  title: string;
  items: readonly T[];
}

export interface SectionHeaderRow {
  type: 'header';
  section: number;
  title: string;
  offset: number;
  size: number;
}

export interface SectionItemRow<T> {
  type: 'item';
  section: number;
  index: number;
  item: T;
  offset: number;
  size: number;
}

export type SectionRow<T> = SectionHeaderRow | SectionItemRow<T>;

export interface SectionListOptions<T> {
  /** Header height. Defaults to 40. */
  headerSize?: number;
  /** Item height, fixed or per item. Defaults to 56. */
  itemSize?: number | ((item: T, index: number, section: number) => number);
}

/**
 * Flatten sections into absolutely positioned rows, the shape `Virtual`,
 * `VirtualGrid` and a scroll offset need. Headers and items share one offset
 * space, so sticky headers can be resolved without a second pass.
 */
export function flattenSections<T>(
  sections: readonly Section<T>[],
  options: SectionListOptions<T> = {},
): SectionRow<T>[] {
  const headerSize = options.headerSize ?? 40;
  const itemSize = options.itemSize ?? 56;
  const rows: SectionRow<T>[] = [];
  let offset = 0;
  sections.forEach((section, sectionIndex) => {
    rows.push({
      type: 'header',
      section: sectionIndex,
      title: section.title,
      offset,
      size: headerSize,
    });
    offset += headerSize;
    section.items.forEach((item, index) => {
      const size =
        typeof itemSize === 'function'
          ? itemSize(item, index, sectionIndex)
          : itemSize;
      rows.push({
        type: 'item',
        section: sectionIndex,
        index,
        item,
        offset,
        size,
      });
      offset += size;
    });
  });
  return rows;
}

/**
 * The header pinned at `offset`: the last header at or above the viewport top.
 * Returns undefined before the first header.
 */
export function stickyHeaderAt<T>(
  rows: readonly SectionRow<T>[],
  offset: number,
): SectionHeaderRow | undefined {
  let current: SectionHeaderRow | undefined;
  for (const row of rows) {
    if (row.offset > offset) break;
    if (row.type === 'header') current = row;
  }
  return current;
}

/** Rows intersecting `[offset, offset + height]`, with optional overscan. */
export function visibleSectionRows<T>(
  rows: readonly SectionRow<T>[],
  offset: number,
  height: number,
  overscan = 0,
): SectionRow<T>[] {
  const start = offset - overscan;
  const end = offset + height + overscan;
  return rows.filter(
    (row) => row.offset + row.size > start && row.offset < end,
  );
}

/** Total content height of a flattened section list. */
export function sectionListHeight<T>(rows: readonly SectionRow<T>[]): number {
  const last = rows[rows.length - 1];
  return last ? last.offset + last.size : 0;
}

export interface SwipeActionsOptions {
  /** Distance that commits an action. Defaults to 96. */
  threshold?: number;
  /** Maximum reveal distance. Defaults to 160. */
  max?: number;
  onAction?(direction: 'start' | 'end'): void;
}

export interface SwipeActions {
  /** Signed offset: positive reveals the start action, negative the end. */
  offset: Accessor<number>;
  direction: Accessor<'start' | 'end' | null>;
  open: Accessor<boolean>;
  /** Pass to `InputControl.drag`. */
  drag(
    phase: 'start' | 'move' | 'end' | 'cancel',
    point: Point,
    origin: Point,
  ): void;
  close(): void;
}

/**
 * Horizontal swipe-to-action state, matching Flutter `Dismissible` and iOS
 * swipe actions. The app draws the action backgrounds from `offset()` and
 * removes/undoes the row in `onAction`.
 */
export function createSwipeActions(
  options: SwipeActionsOptions = {},
): SwipeActions {
  const threshold = options.threshold ?? 96;
  const max = options.max ?? 160;
  const [offset, setOffset] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  const direction = (): 'start' | 'end' | null => {
    const value = offset();
    if (!open()) return null;
    return value > 0 ? 'start' : value < 0 ? 'end' : null;
  };

  return {
    offset,
    direction,
    open,
    drag(phase, point, origin) {
      if (phase === 'start') {
        setOffset(0);
        setOpen(false);
        return;
      }
      if (phase === 'cancel') {
        setOffset(0);
        setOpen(false);
        return;
      }
      if (phase === 'move') {
        const delta = point.x - origin.x;
        setOffset(Math.max(-max, Math.min(max, delta)));
        return;
      }
      const value = offset();
      if (Math.abs(value) < threshold) {
        setOffset(0);
        setOpen(false);
        return;
      }
      const sign = value < 0 ? -1 : 1;
      setOffset(sign * threshold);
      setOpen(true);
      options.onAction?.(sign < 0 ? 'end' : 'start');
    },
    close() {
      setOffset(0);
      setOpen(false);
    },
  };
}

/** Move `from` to `to`, returning a new array. Out-of-range is a no-op. */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export interface ReorderState {
  from: Accessor<number | null>;
  over: Accessor<number | null>;
  start(index: number): void;
  hover(index: number): void;
  /** Finish the drag. Returns the move to apply with `moveItem`. */
  drop(): { from: number; to: number } | undefined;
  cancel(): void;
}

/**
 * Drag-reorder state. The list owns item positions; this helper tracks the
 * dragged index and the hovered target so a drop produces one `moveItem` call.
 * This is the Flutter `ReorderableListView` / RN `DraggableFlatList` contract.
 */
export function createReorder(): ReorderState {
  const [from, setFrom] = createSignal<number | null>(null);
  const [over, setOver] = createSignal<number | null>(null);
  const reset = () => {
    setFrom(null);
    setOver(null);
  };
  return {
    from,
    over,
    start(index) {
      setFrom(index);
      setOver(index);
    },
    hover(index) {
      if (from() !== null) setOver(index);
    },
    drop() {
      const start = from();
      const end = over();
      reset();
      if (start === null || end === null || start === end) return undefined;
      return { from: start, to: end };
    },
    cancel: reset,
  };
}
