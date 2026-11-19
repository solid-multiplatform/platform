import { For, splitProps, type Accessor, type JSX } from 'solid-js';
import { isElementNode } from '@solid-multiplatform/platform';
import { Column } from './Column.jsx';
import { Row } from './Row.jsx';
import type { ColumnProps } from './types.js';

export interface ListProps<T> extends Omit<ColumnProps, 'children'> {
  each: readonly T[] | undefined | null;
  /** `column` (the default) moves with up and down, `row` with left and right. */
  direction?: 'row' | 'column';
  /** Enter, a click or a tap on an item. */
  onSelect?: (item: T, index: number) => void;
  children: (item: T, index: Accessor<number>) => JSX.Element;
}

/**
 * One focusable item per entry of `each`, in a `Column` or a `Row`: arrow
 * keys move focus, the list scrolls to keep the focused item in view, and
 * `onSelect` receives the item that was activated. For thousands of items use
 * `VirtualColumn`/`VirtualRow`.
 */
export function List<T>(props: ListProps<T>): JSX.Element {
  const [local, rest] = splitProps(props, [
    'each',
    'direction',
    'onSelect',
    'children',
  ]);
  const items = (
    <For each={local.each}>
      {(item, index) => {
        const node = local.children(item, index) as unknown;
        // The item itself is the target of Enter and of the pointer.
        if (isElementNode(node)) {
          const own = node.onEnter as
            | ((this: unknown, ...args: unknown[]) => unknown)
            | undefined;
          node.onEnter = function (this: unknown, ...args: unknown[]) {
            const handled = own?.apply(this, args);
            local.onSelect?.(item, index());
            return handled;
          } as typeof node.onEnter;
        }
        return node as JSX.Element;
      }}
    </For>
  );
  return local.direction === 'row' ? (
    <Row {...rest}>{items}</Row>
  ) : (
    <Column {...rest}>{items}</Column>
  );
}
