# Portal

`Portal` renders its children under a different parent. Use it for content
that must sit outside the component that owns it, such as a dialog or an
overlay.

```tsx
import { Portal } from '@solid-multiplatform/platform/primitives';

export const App = () => (
  <view>
    <view id="overlay" zIndex={10} />
    <Portal mount="overlay">
      <text>This text is a child of the node with id "overlay".</text>
    </Portal>
  </view>
);
```

## Props

- `mount` (`string`): the `id` of the node to render under. The node is looked
  up from the root. Without `mount`, or when no node has that id, the children
  are added to the root node.
- `children`: what to render.

The children are removed when the `Portal` is disposed.
