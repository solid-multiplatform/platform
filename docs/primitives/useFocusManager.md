# useFocusManager

`useFocusManager` listens for key events, maps them to names such as `Left`
and `Enter`, and sends them along the focus path. Call it once, at the top of
your app. `startApp` already calls it for you with `options.keyMap`; call it
yourself only when you render with `createRenderer` directly.

```tsx
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';

const App = () => {
  // Defaults apply. What you pass is merged over them.
  useFocusManager({
    Back: [461, 'GoBack', 'Backspace'],
    Enter: ['Enter', 13],
  });

  return <view autofocus />;
};
```

The same functions are exported from
`@solid-multiplatform/platform/primitives`.

## Key map

You pass `{ EventName: key or keys }`. A key is a `KeyboardEvent.key` string or
a numeric `keyCode`. These are the defaults:

```js
const defaults = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  l: 'Last',
  ' ': 'Space',
  Backspace: 'Back',
  Escape: 'Escape',
};
```

No numeric key codes are mapped by default. A device that reports keys by
code, or reports a different `key` on key-down and key-up, needs them added.

Only `Left`, `Right`, `Up`, `Down`, `Enter` and `Last` have typed handler props
(`onLeft`, `onLeftRelease`, `onCaptureLeft`, …). Handlers for any other name,
including `Back`, `Space` and `Escape`, work at runtime but are not checked by
the compiler. Annotate the handler yourself:

```tsx
import type { KeyHandler } from '@solid-multiplatform/platform';

const onBack: KeyHandler = () => {
  console.log('back');
  return true;
};

export const Page = () => <view onBack={onBack} autofocus />;
```

## Event target

By default the focus manager listens on `document`. A host without a document
passes its own target as the second argument. The target needs
`addEventListener` and `removeEventListener` for `keydown` and `keyup`
(`KeyEventTarget`). Its events need `key`, `keyCode` and `repeat`
(`KeyEventLike`).

```ts
import {
  useFocusManager,
  type KeyEventTarget,
} from '@solid-multiplatform/platform/focusManager';

declare const keyBridge: KeyEventTarget;

useFocusManager(undefined, keyBridge);
```

## Focus path

`focusPath` is a signal with the elements that have focus, from the focused
leaf up to the root. When the active element changes:

- Elements entering the path get the `$focus` state and `onFocus` is called.
- Elements leaving the path lose the state and `onBlur` is called.
- `onFocusChanged(hasFocus, …)` is called on both.

```tsx
import { createSignal } from 'solid-js';

export const Card = () => {
  const [focused, setFocused] = createSignal(false);
  return <view onFocusChanged={setFocused} alpha={focused() ? 1 : 0.6} />;
};
```

## How a key press travels

1. The key map turns the event's `key`, or else its `keyCode`, into an event
   name. `ArrowLeft` becomes `Left`.
2. Capture phase, root to focused leaf: each element is checked for
   `onCapture<Name>`, then `onCaptureKey`.
3. Bubble phase, focused leaf to root: each element is checked for
   `on<Name>`, then `onKeyPress`, before moving to its parent.

A handler stops the press by returning `true`. Any other return value lets it
continue.

```ts
type KeyHandler = (
  this: ElementNode,
  e: KeyboardEvent,
  target: ElementNode,
  handlerElm: ElementNode,
  mappedEvent?: string,
) => boolean | void;
```

A key with no mapping still travels, but only `onCaptureKey` and `onKeyPress`
hear it.

## Key release

On key-up the same walk runs with `onCapture<Name>Release`, then
`onCaptureKeyRelease`, then `on<Name>Release`. `onKeyPress` is not called for a
release.

For press-and-hold, see [useHold](/primitives/useHold.md).

## Throttling

`Config.throttleInput` sets the minimum time in milliseconds between two key
presses for the whole app. The `throttleInput` prop does the same for one
element. Releases are never dropped.

```tsx
import { Config } from '@solid-multiplatform/platform';
import { Row } from '@solid-multiplatform/platform/primitives';

Config.throttleInput = 200;

export const Rail = () => <Row throttleInput={500} />;
```

## Options on Config

- `Config.preventDefaultOnHandledKeys` (default `false`): call
  `preventDefault()` on every key event the app consumed. A host uses this to
  learn which presses the app handled.
- `Config.inferKeyRepeat` (milliseconds, off by default): mark a key-down as a
  repeat when the same key sent a key-down less than this long ago with no
  key-up in between. Use it on devices that never set `repeat`.
- `Config.keyDebug` (default `false`): log key handling in development builds.
- `Config.focusHistoryDebug` (default `0`): in development builds, record
  focus changes and print the last _n_ with `console.table` after each change.

`printFocusHistory(n)` prints the last _n_ recorded focus changes.
`getFocusHistory()` returns the recorded entries, at most 50. Both do nothing
useful in production builds, where nothing is recorded.
