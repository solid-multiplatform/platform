# useMouse

`useMouse` lets a mouse or pointer remote drive an app that is built for keys.
It focuses the element under the pointer, turns a click into Enter, and turns
the wheel into Up and Down.

`useMouse` listens on `window` and `document`. It works only on hosts that
have them: the web and browser TV targets. Pointer input as a framework
feature for every target is in progress in an open pull request and is not on
`main`.

## Usage

Call it once, inside your app:

```tsx
import { useMouse } from '@solid-multiplatform/platform/primitives';

export const App = () => {
  useMouse();

  return <view autofocus />;
};
```

The signature is `useMouse(root, throttleBy, options)`:

- `root` (`ElementNode`, default the root node): the tree to hit-test.
- `throttleBy` (`number`, default `100`): milliseconds between two hit tests
  while the pointer moves.
- `options.customStates`: `{ hoverState, pressedState }`, two state names that
  start with `$`.

## Hover

On pointer move, `useMouse` finds the deepest element under the pointer that
has `onEnter`, `onMouseClick`, `onFocus`, `cursorStyle` or a focus state style.
That element gets focus. If its parent has a `selected` index, as `Row` and
`Column` do, the index is updated.

With `customStates`, hover does not move focus. The element gets the
`hoverState` state instead, and `pressedState` while the button is down:

```tsx
import { rootNode } from '@solid-multiplatform/platform';
import { useMouse } from '@solid-multiplatform/platform/primitives';

export const App = () => {
  useMouse(rootNode, 100, {
    customStates: { hoverState: '$hover', pressedState: '$pressed' },
  });

  return (
    <view
      width={200}
      height={80}
      color="#264653ff"
      $hover={{ color: '#2a9d8fff' }}
      $pressed={{ color: '#e9c46aff' }}
      onEnter={() => console.log('activated')}
    />
  );
};
```

See [States](/essentials/states.md) for how state styles work.

## Click

- If the element has `onMouseClick`, it is called with the mouse event and the
  element. A key press never calls it.
- Otherwise the element is focused and an Enter key-down and key-up are
  dispatched on `document`. The press goes through the focus manager like a
  remote's Enter, so the same `onEnter` runs.

## Wheel

A wheel movement dispatches `ArrowUp` or `ArrowDown`. The wheel is throttled.

## isCursorVisible

`isCursorVisible()` is a reactive accessor for the webOS pointer. It follows
the `cursorStateChange` event that webOS raises on `document`. It attaches one
listener on first use and returns `false` until an event says otherwise.

```tsx
import { Show } from 'solid-js';
import {
  isCursorVisible,
  Row,
  type NavigableElement,
} from '@solid-multiplatform/platform/primitives';

export const MouseRow = () => {
  let row!: NavigableElement;
  const step = (delta: number) =>
    row.scrollToIndex(Math.max(0, row.selected + delta), { noFocus: true });

  return (
    <view>
      <Row ref={row} autofocus>
        <view width={400} height={200} />
        <view width={400} height={200} />
        <view width={400} height={200} />
      </Row>
      <Show when={isCursorVisible()}>
        <view width={60} height={200} onMouseClick={() => step(-1)} />
        <view x={1860} width={60} height={200} onMouseClick={() => step(1)} />
      </Show>
    </view>
  );
};
```

A `Row` scrolls on Left and Right. With a pointer the user hovers instead, so
items outside the screen cannot be reached. Arrow areas like the ones above
scroll the row without taking focus from the pointer.

This project has no automated test of `useMouse` on a TV. Check pointer
behavior on your device.
