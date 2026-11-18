# Grid

`Grid` places items in fixed-size cells and moves focus in four directions. It
renders every item. For long lists use
[VirtualGrid](/primitives/virtualgrid.md).

```tsx
import {
  Grid,
  type GridItemProps,
} from '@solid-multiplatform/platform/primitives';

const items = ['One', 'Two', 'Three', 'Four', 'Five'];

const Cell = (props: GridItemProps<string>) => (
  <view
    x={props.x}
    y={props.y}
    width={props.width}
    height={props.height}
    color="#264653ff"
  >
    <text>{props.item}</text>
  </view>
);

export const Example = () => (
  <Grid
    items={items}
    columns={3}
    itemWidth={200}
    itemHeight={150}
    itemOffset={10}
    looping
    onSelectedChanged={(index) => console.log('selected', index)}
    autofocus
  >
    {Cell}
  </Grid>
);
```

The grid does not use flex. It passes `x`, `y`, `width` and `height` to each
item, and the item must apply them.

## Props

`Grid` accepts every `<view>` prop except `children`, plus:

- `items` (`readonly T[]`): the items to render.
- `children` (`(props: GridItemProps<T>) => JSX.Element`): renders one item.
- `itemWidth` (`number`, default `300`): cell width.
- `itemHeight` (`number`, default `300`): cell height.
- `itemOffset` (`number`, default `0`): gap between cells.
- `columns` (`number`, default `4`): cells per row.
- `looping` (`boolean`): navigation wraps at the edges.
- `scroll` (`'auto' | 'none'`): `none` keeps the grid in place when the focused
  row changes.
- `selected` (`number`): index to focus. The grid follows changes to it.
- `onSelectedChanged` (`(index, grid, elm) => void`): called when the focused
  index changes.

`GridItemProps<T>` has `item`, `index`, `x`, `y`, `width` and `height`.

A ref has `scrollToIndex(index)`, which focuses the grid and the item at that
index.
