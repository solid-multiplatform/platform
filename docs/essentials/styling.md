# Styling

There is no CSS. You style a node with props. Set them in JSX, in a `style`
object, or on the node through a ref.

```tsx
import { createSignal } from 'solid-js';
import type { ElementNode, NodeStyles } from '@solid-multiplatform/platform';

const column: NodeStyles = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flexStart',
  width: 1760,
  height: 500,
  gap: 50,
  x: 80,
  y: 200,
  color: 0x00000000,
};

let node!: ElementNode;
const [alpha, setAlpha] = createSignal(1);

function shift() {
  node.x = 200;
}

<view ref={node} alpha={alpha()} y={90} style={column} />;
```

## How `style` works

- `style` is read once, when the element is created. Changing the object later
  does nothing.
- A prop set in JSX wins over the same prop in `style`. Here `y` is 90.
- After creation, change props with signals in JSX or through the ref.
- Keys that start with `$` are [states](/essentials/states.md).

Because `style` is read-only, define style objects outside components and share
them between instances.

`combineStyles(a, b)` from `@solid-multiplatform/platform` merges two style
objects. Props in `a` win. Use it when a component takes a `style` prop and has
defaults of its own. The merge is shallow: a state in `a` replaces the whole
state in `b`.

```tsx
import {
  combineStyles,
  type NodeProps,
  type NodeStyles,
} from '@solid-multiplatform/platform';

const defaults: NodeStyles = { width: 400, height: 200, color: 0x253040ff };

function Card(props: NodeProps) {
  return <view {...props} style={combineStyles(props.style, defaults)} />;
}
```

## Patterns to avoid

Do not build style objects in the render path. Each one is a new allocation per
instance, and the element ignores a second `style` anyway.

```tsx
// Avoid: a new object for every instance.
<view {...props} style={{ ...styles }} />
<view {...props} style={{ ...otherStyles, ...styles }} />

// Do: one shared object, made once at module level.
const combined = { ...otherStyles, ...styles };
<view {...props} style={combined} />

// Do: a single prop goes in JSX, not in a copied style.
<view {...props} style={styles} width={props.width} />
```

## Colors

Colors are numbers in `0xRRGGBBAA` form. `0xff0000ff` is opaque red.

- `hexColor('#c0ffee')` from `@solid-multiplatform/platform` converts a string
  at run time. It accepts `#RRGGBB`, `#RRGGBBAA`, `0x...` and bare hex. A
  6-digit value gets `ff` alpha.
- `hexColorTransform` from `@solid-multiplatform/platform/devtools` is a Vite
  plugin that rewrites `'#RRGGBB'` and `'#RRGGBBAA'` string literals to numbers
  at build time.
- A `<view>` with no `color` and no `src` is transparent. If you set its `src`
  later, set `color` to `0xffffffff` too.

## Node props

Position and size:

- `x`, `y`: position relative to the parent. Default `0`.
- `width`, `height`: size in pixels. `w` and `h` are the same props.
- `right`, `bottom`: distance from the parent's right or bottom edge. They set
  `mountX` or `mountY` to 1.
- `center`, `centerX`, `centerY`: center the node in its parent.
- `mount`, `mountX`, `mountY`: which point of the node sits at `x`, `y`. `0` is
  top-left, `0.5` the center, `1` bottom-right. Default `0`.
- `zIndex`: stacking order.

A `<view>` without a width or height takes the parent's size minus its own `x`
or `y`. A `<text>` needs neither.

Appearance:

- `alpha`: opacity from 0 to 1. Default `1`.
- `hidden`: `true` sets `alpha` to 0.
- `color`, and `colorTop`, `colorBottom`, `colorLeft`, `colorRight`, `colorTl`,
  `colorTr`, `colorBl`, `colorBr` for edge and corner gradients.
- `clipping`: do not draw children outside the node's bounds.
- `src`, `texture`, `textureOptions`, `autosize`: see
  [Images](/essentials/images.md).
- `border`, `borderRadius`, `shadow`, `linearGradient`, `radialGradient`,
  `shader`, `effects`: see [Effects](/essentials/effects.md).

Transform:

- `scale`, `scaleX`, `scaleY`: default `1`.
- `rotation`: in radians.
- `pivot`, `pivotX`, `pivotY`: the point scale and rotation turn around.
  Default `0.5`, the center.

Layout, for flex containers and their items: see
[Layout](/flow/layout.md).

Behaviour:

- `states`, `stateOrder`, `forwardStates`, `theme`: see
  [States](/essentials/states.md).
- `transition`, `animationSettings`, `onAnimation`: see
  [Transitions](/essentials/transitions.md).
- `autofocus`, `forwardFocus`, `skipFocus`, `throttleInput`, key and focus
  handlers: see [Focus and keys](/essentials/focus.md).
- `onCreate`, `onRender`, `onRemove`, `onDestroy`, `onLayout`, `onEvent`: see
  [Events](/essentials/events.md).

Text props are listed in [Text](/essentials/text.md).
