# Events

## Component lifecycle

Use Solid's own hooks in components:

- [`onMount`](https://docs.solidjs.com/reference/lifecycle/on-mount) runs once
  after the component is first inserted.
- [`onCleanup`](https://docs.solidjs.com/reference/lifecycle/on-cleanup) runs
  when the component is removed.

## Node events

Every `<view>` and `<text>` accepts these callbacks:

```ts
onCreate?: (this: ElementNode, el: ElementNode) => void;
onRender?: (this: ElementNode, el: ElementNode) => void;
onRemove?: (this: ElementNode, el: ElementNode) => void;
onDestroy?: (this: ElementNode, el: ElementNode) => Promise<void> | void;
onLayout?: (this: ElementNode, target: ElementNode) => void;
```

- `onCreate`: the node was created and rendered.
- `onRender`: the node was rendered, after creation and when it changes parent.
- `onRemove`: the node was removed from its parent.
- `onDestroy`: the node is about to be destroyed. See
  [Destroy animations](/flow/ondestroy.md).
- `onLayout`: flex layout ran on this node. See [Layout](/flow/layout.md).

## Backend events

The backend node reports loading and visibility. Listen with `onEvent`.

```tsx
<view
  width={200}
  height={200}
  src={props.image}
  onEvent={{
    loaded: (element, payload) => {
      console.log('loaded', element.id, payload);
    },
    failed: (element, payload) => {
      console.log('failed', element.id, payload);
    },
  }}
/>
```

- `loaded`: the node's texture or text loaded.
- `failed`: it failed to load.
- `freed`: its texture was freed.
- `inViewport`: the node entered the viewport.
- `outOfViewport`: the node left the viewport.

The WebGL backend only emits the two viewport events in a build with the
`__emitBoundsEvents__` flag set to `true`. It is `false` by default.

## Focus and key events

See [Focus and keys](/essentials/focus.md).

## Custom events with `emit`

`emit` sends an event up the tree from a node.

```tsx
import type { ElementNode } from '@solid-multiplatform/platform';

let tile!: ElementNode;

function onSelected(source: ElementNode, payload: { id: string }) {
  console.log(source.id, payload.id);
  return true;
}

<view onSelected={onSelected}>
  <view ref={tile} id="tile" />
</view>;

tile.emit('selected', { id: 'movie-1' });
```

How it works:

1. `emit('selected', ...args)` looks for an `onSelected` function, starting on
   the node itself.
2. The handler is called with the emitting node first, then your arguments.
3. If the handler returns `true`, the event stops and `emit` returns `true`.
4. Otherwise it continues to the parent, up to the root.
