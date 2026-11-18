# Effects

Effects are props that become a shader on the backend node: rounded corners,
borders, shadows and gradients. You set them in JSX or in a style object.

Not every backend draws every effect. Check the [feature matrix](/features.md)
for the target you care about.

## Border, radius and shadow

`borderRadius`, `border` and `shadow` combine into one shader.

```tsx
const card = {
  width: 400,
  height: 240,
  color: 0x253040ff,
  borderRadius: 30,
  border: { width: 10, color: 0x000000ff },
  shadow: { color: 0x00000080, x: 0, y: 8, blur: 24, spread: 0 },
} as const;

<view style={card} />;
```

- `borderRadius`: one number, or an array with one radius per corner.
  `rounded` is an alias.
- `border`: `{ width, color, gap, align }`. `width` is a number or
  `[top, right, bottom, left]`. `align` is `'inside'`, `'outside'` or
  `'center'`.
- `borderTop`, `borderRight`, `borderBottom`, `borderLeft`: a border on one
  side, `{ width, color }`.
- `shadow`: `{ color, x, y, blur, spread }`.

You can pass the same props together through `effects`:

```tsx
<view
  width={400}
  height={240}
  color={0x253040ff}
  effects={{
    rounded: 30,
    border: { w: 4, color: 0xffffffff },
  }}
/>
```

`effects` reads `rounded`, `borderRadius`, `border`, the four side borders and
`shadow`. It does not read gradients. Set those with their own props. Inside
`effects` the border thickness is typed as `w`; the standalone `border` prop
takes `width`.

## Gradients

`linearGradient` and `radialGradient` are props of their own. Each one sets the
node's shader, so a gradient replaces a border, radius or shadow on the same
node. Put the gradient on a child if you need both.

```tsx
import { deg2Rad } from '@solid-multiplatform/platform';

<view
  width={300}
  height={300}
  linearGradient={{
    angle: deg2Rad(225),
    stops: [0.1, 0.5],
    colors: [0xff0000ff, 0x00000000],
  }}
/>;
```

```tsx
<view
  width={300}
  height={300}
  radialGradient={{
    pivot: [0.5, 0.5],
    w: 300,
    h: 300,
    stops: [0.1, 0.5],
    colors: [0xff0000ff, 0x00000000],
  }}
/>
```

Use as many stops and colors as you like.

For a simple two-color fade you do not need a shader. Use the corner and edge
colors: `colorTop`, `colorBottom`, `colorLeft`, `colorRight`, `colorTl`,
`colorTr`, `colorBl`, `colorBr`.

## A shader by name

`shader` takes a shader the backend made, or a `[type, props]` pair.

```tsx
<view width={300} height={100} shader={['rounded', { radius: 6 }]} />
```

The built-in types are `rounded`, `shadow`, `roundedWithBorder`,
`roundedWithShadow`, `roundedWithBorderWithShadow`, `holePunch`,
`linearGradient` and `radialGradient`. Their prop types are exported from
`@solid-multiplatform/platform/shaders`.

## Turning shaders off

Build with the `SOLIDTV_DISABLE_SHADERS` define set to `true` to drop effect
handling. `SOLIDTV_DISABLE_SHADERS` is a legacy name and will be renamed
before 1.0.
