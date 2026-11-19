# VirtualGrid

`VirtualGrid` renders a window of a long list as a grid. It lays items out with
flex wrap and scrolls vertically one row at a time. Only the visible rows and a
buffer above and below exist as nodes.

```tsx
import { VirtualGrid } from '@solid-multiplatform/platform/primitives';

export const Posters = (props: { items: string[]; loadMore: () => void }) => (
  <VirtualGrid
    x={160}
    y={24}
    width={1620}
    columns={7}
    rows={2}
    buffer={2}
    each={props.items}
    onEndReached={props.loadMore}
    onEndReachedThreshold={15}
    autofocus
  >
    {(item) => <view width={200} height={300} src={item()} />}
  </VirtualGrid>
);
```

Give the grid a `width`. Flex wrap uses it to break rows, so `columns` must
match the number of items that fit.

## Props

`VirtualGrid` takes the `Row` props from
[Row and Column](/primitives/row_column.md), plus:

| Prop                    | Type                                         | Description                                                           |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `each`                  | `readonly T[] \| undefined \| null \| false` | The full list.                                                        |
| `columns`               | `number`                                     | Items per row. Required.                                              |
| `rows`                  | `number`                                     | Visible rows. Defaults to `1`.                                        |
| `buffer`                | `number`                                     | Rows kept rendered above and below the visible rows. Defaults to `2`. |
| `onEndReached`          | `() => void`                                 | Called when the selection comes close to the end.                     |
| `onEndReachedThreshold` | `number`                                     | How many items from the end `onEndReached` fires.                     |
| `selected`              | `number`                                     | Initial selected index in the full list.                              |
| `children`              | `(item, index) => JSX.Element`               | Renders one item. Both arguments are accessors.                       |

Up and Down move by one row. Left and Right move by one item. Your own
`onUp`, `onDown`, `onLeft` and `onRight` handlers run first.
