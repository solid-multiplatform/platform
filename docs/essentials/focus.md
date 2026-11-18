# Focus and keys

Nothing here is a DOM element, so the platform keeps focus itself. One element
has focus at a time. Keys go to that element and bubble up through its parents.

## `activeElement`

`activeElement` is a Solid signal that holds the focused `ElementNode`. Give an
element focus with the `autofocus` prop or by calling `setFocus()` on it.

```tsx
import { createEffect, on, onMount } from 'solid-js';
import { activeElement, type ElementNode } from '@solid-multiplatform/platform';

let ring!: ElementNode;
let sports!: ElementNode;

// Runs whenever focus moves.
createEffect(
  on(
    activeElement,
    (element) => {
      if (element) ring.x = element.x;
    },
    { defer: true },
  ),
);

onMount(() => sports.setFocus());

<>
  <view ref={ring} width={312} height={8} color={0x31609bff} />
  <view autofocus width={312} height={132} color={0x253040ff} />
  <view ref={sports} x={336} width={312} height={132} color={0x253040ff} />
</>;
```

The focused element gets the `$focus` state, so `$focus` styles apply to it.
See [States](/essentials/states.md).

## Turning key handling on

`useFocusManager` listens for keys and runs your handlers. `startApp` calls it
for you. If you start the app with `createRenderer`, call it once inside
`render`:

```tsx
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';

render(() => {
  useFocusManager();
  return <App />;
});
```

It takes an optional key map and an optional key event target. Without a
target it listens on `document`.

## Key handlers

The default key map names these keys: `Left`, `Right`, `Up`, `Down`, `Enter`,
`Last`, `Space`, `Back` and `Escape`. Each name gives you three props:
`on<Name>`, `on<Name>Release` and `onCapture<Name>`.

```tsx
<view
  autofocus
  width={312}
  height={132}
  onEnter={() => {
    play();
    return true;
  }}
  onLeft={() => previous()}
  onRight={() => next()}
/>
```

A handler is called as `handler(event, handlerElement, focusedElement)`, with
`this` set to the element the handler is on. Return `true` to mark the key as
handled. Otherwise the key bubbles to the parent.

- `onKeyPress(event, mappedName, handlerElement, focusedElement)` hears every
  key press that no named handler on that element handled.
- `onCapture<Name>` and `onCaptureKey` run first, from the root down to the
  focused element. Return `true` to claim the key before it bubbles.

Add your own key names with a key map. With `startApp`, pass `keyMap` in the
options.

```tsx
useFocusManager({
  Menu: ['m', 'ContextMenu'],
  Play: 'MediaPlay',
});

<view autofocus onMenu={() => openMenu()} onPlay={() => play()} />;
```

## `onFocus`, `onBlur` and `onFocusChanged`

```tsx
<view
  autofocus
  width={312}
  height={132}
  onFocus={(current, previous) => console.log('focus', current.id)}
  onBlur={(current, previous) => console.log('blur', previous.id)}
  onFocusChanged={(hasFocus) => console.log(hasFocus)}
/>
```

These fire for every element on the focus path, not only the focused leaf. A
parent hears `onFocus` when focus enters any of its descendants.

## `autofocus`

`autofocus` gives an element focus when it is created. Have one element with
`autofocus` on each screen. It also accepts a signal's value: the element takes
focus again when the value changes to something truthy. That is useful when
data arrives later and a `Row` or `Column` must reset its focus.

```tsx
<Column autofocus={items()}>
  <For each={items()}>{(item) => <Tile item={item} />}</For>
</Column>
```

## `forwardFocus`

`forwardFocus` passes focus on to a child when the element itself is focused.

```tsx
// Focus lands on the first child.
<view autofocus forwardFocus={0}>
  <view width={312} height={132} />
  <view x={336} width={312} height={132} />
</view>
```

- A number is the index of the child that receives focus.
- A function receives the element. Focus whatever you like inside it. Return
  `false` to let the element keep focus itself.

A child may have `forwardFocus` too.

## `skipFocus`

`Row`, `Column` and the other navigation primitives skip children that have
`skipFocus` set. See [Row and Column](/primitives/row_column.md).

## Throttling

`throttleInput` on an element, or `Config.throttleInput` for the whole app,
sets the minimum time in ms between handled key presses.

## Debugging focus

```ts
import { Config } from '@solid-multiplatform/platform';

Config.focusDebug = true; // marks the focus path
Config.keyDebug = true; // logs key events
```
