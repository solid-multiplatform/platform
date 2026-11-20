# Row and Column

`Row` and `Column` are flex containers that move focus between their children.
`Row` handles Left and Right. `Column` handles Up and Down. Both scroll so the
selected child stays on screen.

```tsx
import { Row } from '@solid-multiplatform/platform/primitives';

export const Rail = () => (
  <Row x={100} y={100} gap={40} scroll="auto" autofocus>
    <view width={400} height={200} color="#264653ff" />
    <view width={400} height={200} color="#2a9d8fff" />
    <view width={400} height={200} color="#e9c46aff" />
  </Row>
);
```

Both components render a `<view>` and accept every `<view>` prop. The default
style is `display: 'flex'` with `gap: 30`; `Column` also sets
`flexDirection: 'column'`. Pass `style` to change the defaults.

## Props

| Prop                                 | Type                                                 | Description                                                                |
| ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `selected`                           | `number`                                             | Index of the child that takes focus. Defaults to `0`.                      |
| `scroll`                             | `'auto' \| 'edge' \| 'always' \| 'center' \| 'none'` | When the container shifts its children. See below.                         |
| `scrollIndex`                        | `number`                                             | With `auto`, the child index at which scrolling starts.                    |
| `scrollStopLast`                     | `boolean`                                            | With `edge` or `auto`, do not scroll to remove space after the last child. |
| `offset`                             | `number`                                             | Shifts the start position on the scroll axis.                              |
| `wrap`                               | `boolean`                                            | Moving past the last child goes to the first, and the reverse.             |
| `plinko`                             | `boolean`                                            | A sibling row takes the selected index of the row focus came from.         |
| `onSelectedChanged`                  | `OnSelectedChanged`                                  | Called with `(selectedIndex, container, activeChild, lastSelectedIndex)`.  |
| `onScrolled`                         | `(elm, offset, isInitial) => void`                   | Called when the container scrolls.                                         |
| `onLeft` / `onRight`                 | `KeyHandler`                                         | `Row` only. Runs before the built-in navigation; return `true` to stop it. |
| `onUp` / `onDown`                    | `KeyHandler`                                         | `Column` only. Runs before the built-in navigation.                        |
| `transitionLeft` / `transitionRight` | `NodeStyles['transition']`                           | `Row` only. Transition used when scrolling in that direction.              |
| `transitionUp` / `transitionDown`    | `NodeStyles['transition']`                           | `Column` only. Transition used when scrolling in that direction.           |

## Scroll modes

- `auto`: scroll as soon as the selection moves.
- `edge`: scroll when focus reaches the last child on screen.
- `always`: the selected child stays at the first position.
- `center`: the selected child is centered.
- `none`: never scroll.

With `auto` and `edge` the container stops scrolling once the last child is on
screen. Both modes also finish each step by bringing the focused child wholly
into view, so items of different sizes are not left half visible (the tvOS
rule for focus). `scroll: "none"` still opts out of all scrolling.

## Skipping a child

Set `skipFocus` on a child and navigation steps over it.

## scrollToIndex

A ref to a `Row` or `Column` has `scrollToIndex(index, options)`. It selects
the child, scrolls the least distance that shows it whole, and focuses it.
Pass `{ noFocus: true }` to scroll without moving focus.

```tsx
import {
  Row,
  type NavigableElement,
} from '@solid-multiplatform/platform/primitives';

export const Rail = () => {
  let row!: NavigableElement;

  return (
    <Row
      ref={row}
      onSelectedChanged={(index) => console.log('selected', index)}
      onEnter={() => row.scrollToIndex(2)}
      autofocus
    >
      <view width={400} height={200} />
      <view width={400} height={200} />
      <view width={400} height={200} />
    </Row>
  );
};
```

See [Positioning and Layout](/flow/layout.md) for flex props and
[Focus and Key Handling](/essentials/focus.md) for how keys reach a handler.
