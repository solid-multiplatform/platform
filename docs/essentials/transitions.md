# Transitions and animations

A transition animates a prop when its value changes. You name the props that
animate in `transition`.

```tsx
import { createEffect, on } from 'solid-js';
import { activeElement, type ElementNode } from '@solid-multiplatform/platform';

let ring!: ElementNode;

createEffect(
  on(
    activeElement,
    (element) => {
      if (element) ring.x = element.x;
    },
    { defer: true },
  ),
);

<view
  ref={ring}
  width={312}
  height={8}
  color={0x31609bff}
  transition={{ x: true, scale: { duration: 1500, easing: 'ease-in-out' } }}
/>;
```

- `true` uses the element's `animationSettings`, or the backend's defaults when
  it has none.
- An object is the settings for that prop.
- `transition={true}` animates every animatable prop.

`transition` works in a style object too, and states use it:

```ts
const button = {
  scale: 1,
  alpha: 0.8,
  transition: {
    scale: { duration: 200, easing: 'ease-out' },
    alpha: { duration: 200, easing: 'ease-out' },
  },
  $focus: { scale: 1.1, alpha: 1 },
} as const;
```

## Animation settings

```ts
import { Config } from '@solid-multiplatform/platform';

Config.animationSettings = {
  duration: 250,
  delay: 0,
  easing: 'ease-in-out',
};
```

The settings are `duration`, `delay`, `easing`, `loop`, `repeat`, `repeatDelay`
and `stopMethod` (`'reverse'` or `false`). Times are in ms. `easing` is a name
or a function from progress to eased progress.

Set `animationSettings` on one element to change its defaults.

## Animating directly

`animate(props, settings)` returns a controller. Nothing moves until you call
`start()`.

```tsx
import { onMount } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';

let tile!: ElementNode;

onMount(() => {
  tile.animate({ alpha: 1, scale: 1.1 }, { duration: 500 }).start();
});

<view ref={tile} width={312} height={132} alpha={0} color={0x253040ff} />;
```

The controller has `start()`, `stop()`, `pause()`, `restore()`, a `state`, and
`waitUntilStopped()`, which returns a promise.

The node must be rendered. Calling `animate` earlier does nothing.

Chain animations with `chain`, then `start` on the node:

```ts
tile
  .chain({ x: 50, y: 100 }, { duration: 100 })
  .chain({ x: 250, y: 200 }, { duration: 200 })
  .chain({ x: 50, y: 100 }) // uses { duration: 200 }
  .start();
```

A `chain` call without settings reuses the settings of the one before it.

## Turning transitions off

`Config.animationsEnabled = false` turns every transition off. Values change at
once. It does not stop direct `animate` calls.

`Config.animationsEnabled` also reads as `false` while the user's
reduced-motion preference is on.

To skip transitions while a page first renders:

```ts
import { onMount } from 'solid-js';
import { Config } from '@solid-multiplatform/platform';

Config.animationsEnabled = false;
onMount(() => {
  Config.animationsEnabled = true;
});
```

To set one value without its transition, write to the backend node:

```ts
tile.lng.alpha = 0.5;
```

`lng` is a legacy name and will be renamed before 1.0.

## `onAnimation`

`onAnimation` reports transitions on an element. It has two events.

```tsx
<view
  width={312}
  height={132}
  transition={{ alpha: true }}
  onAnimation={{
    animating(name, endValue) {
      console.log(name, 'started, going to', endValue);
    },
    stopped(name, endValue) {
      console.log(name, 'finished at', endValue);
    },
  }}
/>
```

- `animating`: a transition started.
- `stopped`: the transition's duration plus delay has passed.

In both, `this` is the `ElementNode`, `name` is the prop and `endValue` its
target. `stopped` is driven by a timer, so only set it where you need it.
