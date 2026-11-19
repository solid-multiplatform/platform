# Destroy animations

`onDestroy` runs when an element is about to be destroyed. If it returns a
promise, the element stays on screen until the promise resolves. That gives you
time to animate it out.

`onDestroy` is called only on the top node being removed, not on its children.
The top node is, for example, the direct child of a `<Show>` or a page.

## Example

```tsx
import { Show, type ElementNode } from '@solid-multiplatform/platform';

function animateIn(node: ElementNode) {
  node.alpha = 0;
  node.y = -100;
  node
    .animate({ y: 0, alpha: 1 }, { duration: 500, easing: 'ease-in-out' })
    .start();
}

function animateOut(node: ElementNode) {
  return node
    .animate({ y: 200, alpha: 0 }, { duration: 500, easing: 'ease-in-out' })
    .start()
    .waitUntilStopped();
}

<Show when={hero()} keyed>
  {(content) => (
    <view
      autofocus
      width={1920}
      height={600}
      src={content.backdrop}
      onCreate={animateIn}
      onDestroy={animateOut}
    />
  )}
</Show>;
```

## How it works

- `keyed` makes `<Show>` destroy the old element and create a new one whenever
  `hero()` changes.
- The old element's `onDestroy` calls `animateOut`. It returns the promise from
  `waitUntilStopped()`, so the element is destroyed when the animation ends.
- The new element's `onCreate` calls `animateIn`.

Both elements exist while the exit animation runs. Keep exit animations short.
