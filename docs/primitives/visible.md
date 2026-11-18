# Visible

`Visible` hides its children instead of destroying them. Solid's `<Show>`
removes the nodes when its condition turns false and builds them again later.
`Visible` builds them once, the first time `when` is truthy, and afterwards
only sets `hidden` on them.

```tsx
import { createSignal } from 'solid-js';
import { Visible } from '@solid-multiplatform/platform/primitives';

export const Example = () => {
  const [open, setOpen] = createSignal(false);

  return (
    <view autofocus onEnter={() => setOpen((value) => !value)}>
      <text>Press Enter</text>
      <Visible when={open()}>
        <text y={60}>This text is created once and then shown or hidden.</text>
      </Visible>
    </view>
  );
};
```

## Props

- `when`: the children are shown while this is truthy.
- `keyed` (`boolean`): build the children again whenever the value of `when`
  changes, not only when it switches between truthy and falsy.
- `children`: the nodes to show or hide.

Use `Visible` for content that is toggled often and is costly to build. Use
`<Show>` when the hidden content should not hold memory.
