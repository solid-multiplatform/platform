# Focus stack

The focus stack stores elements so you can return focus to them later. Use it
when focus leaves an area, for example to a side menu, and must come back to
where it was.

## Setup

Wrap your app in `FocusStackProvider`:

```tsx
import type { JSX } from 'solid-js';
import { FocusStackProvider } from '@solid-multiplatform/platform/primitives';

export const Root = (props: { children: JSX.Element }) => (
  <FocusStackProvider>{props.children}</FocusStackProvider>
);
```

## Usage

```tsx
import { useFocusStack } from '@solid-multiplatform/platform/primitives';

export const Page = () => {
  const { storeFocus, restoreFocus } = useFocusStack();

  return (
    <view>
      <view id="menu" onFocus={storeFocus} onRight={() => restoreFocus()} />
      <view id="content" autofocus />
    </view>
  );
};
```

When the menu takes focus, `onFocus` passes the element that had focus before
as the second argument, and `storeFocus` stores it. Right on the menu sends
focus back to it.

`useFocusStack` throws when there is no `FocusStackProvider` above it.

## API

- `useFocusStack(autoClear = true)`: returns the three functions below. With
  `autoClear`, the stack is emptied shortly after the calling component is
  cleaned up, so destroyed elements are not kept. Pass `false` to keep the
  stack.
- `storeFocus(element, prevElement?)`: pushes `prevElement` when it is given,
  otherwise `element`. It has the argument order of `onFocus` and `onBlur`, so
  you can pass it to either.
- `restoreFocus()`: pops the last stored element and focuses it. Elements that
  were destroyed since they were stored are skipped. Returns `true` when an
  element was focused.
- `clearFocusStack()`: empties the stack.
