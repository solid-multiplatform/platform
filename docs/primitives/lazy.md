# LazyRow and LazyColumn

`LazyRow` and `LazyColumn` are a [Row or Column](/primitives/row_column.md)
that mounts its children a few at a time. They start with `upCount` items and
add one more each time the selection comes close to the last mounted item.
Mounted items stay mounted. To keep the node count bounded on long lists, use
[VirtualRow and VirtualColumn](/primitives/virtual.md).

```tsx
import { LazyRow } from '@solid-multiplatform/platform/primitives';

export const Rail = (props: { items: string[] }) => (
  <LazyRow upCount={5} delay={250} each={props.items} gap={20} autofocus>
    {(item, index) => (
      <view width={300} height={170} color="#264653ff">
        <text>{`${index}: ${item()}`}</text>
      </view>
    )}
  </LazyRow>
);
```

`children` receives the item as an accessor and the index as a number.

## Props

Both components take the `Row` or `Column` props, plus:

- `each` (`T[] | undefined | null | false`): the items.
- `upCount` (`number`, required): how many items to mount before the user
  navigates.
- `buffer` (`number`): how many items to keep mounted ahead of the selection.
  The default depends on the `scroll` mode.
- `delay` (`number`): milliseconds to wait after a key press before mounting
  the next item. Set it to the duration of the scroll transition so a mount
  does not land in the middle of the animation. If the user presses again
  before the delay ends, the item mounts at once.
- `sync` (`boolean`): mount the first `upCount` items in one pass instead of
  one by one.
- `eagerLoad` (`boolean`): keep mounting the remaining items in the background
  after the first `upCount`.
- `noRefocus` (`boolean`): do not refocus the container when the length of
  `each` changes.

## lazyScrollToIndex

A ref has `lazyScrollToIndex(index, options)`. It mounts items up to `index`
and then calls `scrollToIndex`. Pass `{ noFocus: true }` to scroll without
moving focus.

## Timers

`delay` and the initial ramp-up use timers. They run only while items are
still being mounted and are cleared when the component is destroyed. Nothing
is scheduled once the list is fully mounted or the user stops navigating.
