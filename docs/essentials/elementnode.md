# ElementNode

Every `<view>` and `<text>` in your JSX becomes an `ElementNode`. It holds your
props, runs flex layout, states and transitions, and forwards values to the
backend's node.

```tsx
import type { ElementNode } from '@solid-multiplatform/platform';

let container!: ElementNode;

<view ref={container} width={300} height={100}>
  <view width={100} height={100} color={0xff0000ff} />
  <view x={100} width={100} height={100} color={0x00ff00ff} />
  <view x={200} width={100} height={100} color={0x0000ffff} />
</view>;
```

Solid's `ref` gives you the `ElementNode`. You can set props on it directly.

```ts
container.width = 500;
container.color = 0x000000ff;
container.x = 100;
```

Children are `ElementNode`s too.

```ts
import { isElementNode } from '@solid-multiplatform/platform';

for (const child of container.children) {
  if (isElementNode(child)) {
    child.x += 100;
    child.animate({ alpha: 1, scale: 1.1 }, { duration: 500 }).start();
  }
}
```

## Useful members

- `children`: the child nodes.
- `parent`: the parent `ElementNode`.
- `states`: the node's states. See [States](/essentials/states.md).
- `setFocus()`: gives the node focus. See [Focus](/essentials/focus.md).
- `animate(props, settings)`, `chain(props, settings)`, `start()`: see
  [Transitions](/essentials/transitions.md).
- `emit(event, ...args)`: see [Events](/essentials/events.md).
- `updateLayout()`: runs flex layout again. See [Layout](/flow/layout.md).
- `getChildById(id)` and `searchChildrenById(id)`: find a child by its `id`.
- `rendered`: `true` once the backend node exists.
- `lng`: the backend's node once rendered.

## `lng`

`ElementNode.lng` is the backend's node, typed by the scene contract
(`SceneNode` in `@solid-multiplatform/renderer/contracts`). Before the node is
rendered it is a plain object of the props to create it with.

Writing to `lng` skips states and transitions. Use it only for that purpose,
and only with members the scene contract declares.

`lng` is a legacy name. It will be renamed before 1.0.

## Handling keys yourself

`Row` and `Column` move focus between children for you. This is what they do,
written by hand.

```tsx
import { isElementNode, type ElementNode } from '@solid-multiplatform/platform';

function move(container: ElementNode, offset: number): boolean {
  const next = (container.selected ?? 0) + offset;
  const child = container.children[next];
  if (!isElementNode(child)) return false;
  container.selected = next;
  child.setFocus();
  return true;
}

const block = {
  width: 100,
  height: 100,
  alpha: 0.3,
  $focus: { alpha: 1 },
  transition: { alpha: true },
} as const;

<view
  width={300}
  height={100}
  selected={0}
  onLeft={(event, container) => move(container, -1)}
  onRight={(event, container) => move(container, 1)}
>
  <view style={block} color={0xff0000ff} autofocus />
  <view style={block} x={100} color={0x00ff00ff} />
  <view style={block} x={200} color={0x0000ffff} />
</view>;
```

A key handler receives the key event, then the element the handler is on, then
the focused element. Return `true` to stop the key from bubbling to the parent.

When a block gains focus it gets the `$focus` state, and `alpha` animates from
0.3 to 1.
