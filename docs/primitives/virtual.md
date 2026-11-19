# VirtualRow and VirtualColumn

`VirtualRow` and `VirtualColumn` render a window of a long list. Only the
visible items and a buffer on each side exist as nodes. Moving the selection
shifts the window.

```tsx
import { VirtualRow } from '@solid-multiplatform/platform/primitives';

export const Rail = (props: { items: string[]; loadMore: () => void }) => (
  <VirtualRow
    x={100}
    y={100}
    displaySize={5}
    bufferSize={2}
    each={props.items}
    onEndReached={props.loadMore}
    onEndReachedThreshold={3}
    autofocus
  >
    {(item, index) => (
      <view width={300} height={170} color="#264653ff">
        <text>{`${index()}: ${item()}`}</text>
      </view>
    )}
  </VirtualRow>
);
```

`children` is a function. It receives two accessors, the item and its index in
the full list. Nodes are reused as the window moves, so read both through the
accessors.

## Props

Both components take the [Row and Column](/primitives/row_column.md) props,
plus:

- `each` (`readonly T[] | undefined | null | false`): the full list.
- `displaySize` (`number`, required): number of items visible at once.
- `bufferSize` (`number`, default `2`): extra items kept rendered on each side
  of the visible window.
- `wrap` (`boolean`): navigation wraps around the ends of the list.
- `skipInitialWrap` (`boolean`): with `wrap`, wrapping starts after the first
  forward press. Ignored when `selected` is not `0` at mount.
- `scrollIndex` (`number`): position inside the visible window where the
  selection is held while scrolling.
- `onEndReached` (`() => void`): called when the selection comes close to the
  end. Needs `onEndReachedThreshold`.
- `onEndReachedThreshold` (`number`): how many items from the end
  `onEndReached` fires.
- `uniformSize` (`boolean`, default `true`): treat all items as the same size
  when computing the scroll distance.
- `debugInfo` (`boolean`): log window changes to the console.
- `selected` (`number`): initial selected index in the full list.

`factorScale` is still accepted but is deprecated and has no effect.

## Position in the full list

The container node has a `cursor` property with the selected index in the full
list. `selected` on the node is the index inside the rendered window.

A ref has `scrollToIndex(index)`, which takes an index in the full list.
