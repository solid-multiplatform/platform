# Showing and hiding

## `<Show>`

Solid's [`<Show>`](https://docs.solidjs.com/reference/components/show) creates
its children when the condition is true and destroys them when it is false.
Use it when the nodes should not exist at all.

```tsx
import { Show } from '@solid-multiplatform/platform';

<Show when={details()}>
  <text>{details()!.title}</text>
</Show>;
```

Creating and destroying nodes costs time. For something you toggle often, hide
it instead.

## `hidden`

`hidden` keeps the node and stops showing it. It sets `alpha` to 0 when true
and to 1 when false.

```tsx
<view hidden={!open()} width={400} height={200} color={0x253040ff} />
```

Because it writes `alpha`, do not combine `hidden` with an `alpha` of your own
on the same node. A hidden node still takes part in flex layout and can still
hold focus, so move focus away before you hide it.

## `alpha`

Set `alpha` yourself when you want a transition:

```tsx
<view
  alpha={open() ? 1 : 0}
  transition={{ alpha: true }}
  width={400}
  height={200}
  color={0x253040ff}
/>
```
