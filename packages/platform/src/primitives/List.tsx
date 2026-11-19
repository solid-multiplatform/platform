import { For, splitProps, type Accessor, type JSX } from 'solid-js';
import { createMemo, createRenderEffect, onCleanup } from 'solid-js';
import { isElementNode } from '@solid-multiplatform/platform';
import { Column } from './Column.jsx';
import { Row } from './Row.jsx';
import type { ColumnProps } from './types.js';
import {
  keyIndex,
  registerItemSource,
  setItemKey,
  unregisterItemSource,
} from './screenHistory.js';
import { chainRefs } from './utils/chainFunctions.js';

export interface ListProps<T> extends Omit<ColumnProps, 'children'> {
  each: readonly T[] | undefined | null;
  /** `column` (the default) moves with up and down, `row` with left and right. */
  direction?: 'row' | 'column';
  /**
   * Stable key for one entry, used by screen-history focus restore. Restore
   * resolves this key against the current `each`, never an index.
   */
  itemKey?: (item: T) => string;
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
    'itemKey',
    'onSelect',
    'children',
  ]);
  // Rebuilt only when `each` (or the key function) changes.
  const indexByKey = createMemo(() =>
    keyIndex(local.each ?? [], local.itemKey, 'List'),
  );
  let listNode: import('../core/elementNode.js').ElementNode | undefined;
  onCleanup(() => {
    if (listNode !== undefined) unregisterItemSource(listNode);
  });
  const register = (node: import('../core/elementNode.js').ElementNode) => {
    listNode = node;
    registerItemSource(node, indexByKey);
  };
  const listRef = chainRefs(register, (rest as { ref?: never }).ref);
  const items = (
    <For each={local.each}>
      {(item, index) => {
        const node = local.children(item, index) as unknown;
        // The item itself is the target of Enter and of the pointer.
        if (isElementNode(node)) {
          if (local.itemKey !== undefined) {
            const itemKey = local.itemKey;
            createRenderEffect(() => setItemKey(node, itemKey(item)));
          }
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
    <Row {...rest} ref={listRef}>
      {items}
    </Row>
  ) : (
    <Column {...rest} ref={listRef}>
      {items}
    </Column>
  );
}
