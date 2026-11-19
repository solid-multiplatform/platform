# borderBox

`borderBox` is a Solid directive. It draws a border around an element while
the element has focus.

```tsx
import { borderBox } from '@solid-multiplatform/platform/primitives';

// Keeps the import: directives are referenced only through `use:`.
void borderBox;

export const Cards = () => (
  <view>
    <view use:borderBox={true} width={300} height={170} autofocus />
    <view
      use:borderBox={{ borderSpace: 10 }}
      x={340}
      width={300}
      height={170}
    />
    <view
      use:borderBox={{ border: { color: 0xff0000ff, width: 4 } }}
      x={680}
      width={300}
      height={170}
    />
  </view>
);
```

A directive works only on `<view>` and `<text>`, not on components.

## Value

The directive takes `true`, or the props of the border node:

- `borderSpace` (`number`, default `6`): space between the element and the
  border.
- Any `<view>` prop, such as `border` or `borderRadius`.

The defaults are in the exported `BorderBoxStyle`: `borderSpace: 6`,
`borderRadius: 20`, `border: { color: 0xffffff, width: 2 }` and an `alpha`
transition of 100 ms.

## Behavior

When the element gains focus, a border node is created as its child, sized to
the element plus `borderSpace` on each side. When focus leaves, the border
fades out and is removed. Nothing exists while the element is not focused.
