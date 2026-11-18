import { activeElement } from '../core/activeElement.js';
import type { ElementNode } from '../core/elementNode.js';

/** A focus scope survives virtualization through stable item keys. */
export function createFocusScope<K>(
  options: { restore?: () => void; wrap?: boolean } = {},
) {
  const entries = new Map<K, { focus(): void; disabled?(): boolean }>();
  let key: K | undefined,
    closed = false;
  function focus(value: K) {
    const entry = entries.get(value);
    if (closed || !entry || entry.disabled?.()) return false;
    key = value;
    entry.focus();
    return true;
  }
  function move(delta: number) {
    const available = [...entries]
      .filter(([, e]) => !e.disabled?.())
      .map(([k]) => k);
    if (!available.length || !delta) return false;
    const position = key === undefined ? -1 : available.indexOf(key);
    const start = position < 0 ? (delta > 0 ? -1 : available.length) : position;
    const index =
      options.wrap === false
        ? Math.max(0, Math.min(available.length - 1, start + delta))
        : (((start + delta) % available.length) + available.length) %
          available.length;
    return focus(available[index]!);
  }
  return {
    focus,
    move,
    selected: () => key,
    register(value: K, entry: { focus(): void; disabled?(): boolean }) {
      if (closed) throw new Error('Focus scope is closed');
      entries.set(value, entry);
      if (key === value && !entry.disabled?.()) entry.focus();
      return () => {
        if (entries.get(value) === entry) entries.delete(value);
      };
    },
    close() {
      if (!closed) {
        closed = true;
        entries.clear();
        options.restore?.();
      }
    },
  };
}

export interface FocusTraversalOptions {
  /** Wrap from the last field to the first. Defaults to true. */
  wrap?: boolean;
}

export interface FocusTraversal {
  /** Focusable elements currently in the group, in Tab order. */
  items(): ElementNode[];
  /** Index of the active element, or -1 when focus is outside the group. */
  activeIndex(): number;
  /** Move focus by `delta` positions. Returns false when it cannot move. */
  move(delta: number): boolean;
  next(): boolean;
  previous(): boolean;
  /**
   * Handle a Tab keydown. Returns true when focus moved and should be
   * consumed. Pass the real event; `shiftKey` reverses the direction.
   */
  handleTab(event: {
    key: string;
    shiftKey?: boolean;
    preventDefault?(): void;
  }): boolean;
}

/**
 * Ordered Tab traversal over an explicit list of fields. This is the
 * React Native `focusable` / HTML tab-order contract for scene-drawn forms,
 * where the browser cannot see the individual fields. The list is read on
 * every move, so fields can mount, unmount or be conditionally disabled
 * without rebuilding the traversal.
 */
export function createFocusTraversal(
  source: () => readonly (ElementNode | undefined)[],
  options: FocusTraversalOptions = {},
): FocusTraversal {
  const items = () =>
    source().filter((item): item is ElementNode => !!item && !item.destroyed);
  const activeIndex = () => {
    const active = activeElement();
    return active ? items().indexOf(active) : -1;
  };

  const move = (delta: number) => {
    const available = items();
    if (!available.length || !delta) return false;
    const current = activeIndex();
    let next: number;
    if (current < 0) {
      next = delta > 0 ? 0 : available.length - 1;
    } else {
      next = current + delta;
      if (options.wrap === false) {
        if (next < 0 || next >= available.length) return false;
      } else {
        next =
          ((next % available.length) + available.length) % available.length;
      }
    }
    available[next]!.setFocus();
    return true;
  };

  return {
    items,
    activeIndex,
    move,
    next: () => move(1),
    previous: () => move(-1),
    handleTab(event) {
      if (event.key !== 'Tab') return false;
      const moved = move(event.shiftKey ? -1 : 1);
      if (moved) event.preventDefault?.();
      return moved;
    },
  };
}
