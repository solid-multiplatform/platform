# Images

Give any `<view>` a `src`, a width and a height.

```tsx
<view width={200} height={200} src={imageUrl} />
```

A node with a `src` that you set later must also have a visible `color`. A
`<view>` without a `src` at creation is transparent, so set
`color={0xffffffff}` when the image arrives.

## Size

The backend scales the image to the node's width and height. If you do not know
the image's size, set `autosize`. The node then takes the texture's own
dimensions once it loads.

`autosize` does only that. It does not size a container to its children; use
flex for that. It does nothing on `<text>`.

Keep source images as small as you can. If you draw an image at 200 by 200
pixels, the file should be that size or smaller. Large textures cost memory and
upload time on TVs.

## `textureOptions`

- `preload` (`boolean`): load the texture before the node is drawn.
- `preventCleanup` (`boolean`): never free the texture while unused.
- `flipX`, `flipY` (`boolean`): flip the image.
- `resizeMode`: how the image fits the node.
  - `{ type: 'cover' }` scales and crops to fill. Optional `clipX` and `clipY`
    (0 to 1) set the crop origin.
  - `{ type: 'contain' }` scales to fit without cropping.

```tsx
<view
  src={props.image}
  width={300}
  height={200}
  textureOptions={{ resizeMode: { type: 'contain' } }}
/>
```

## Loading and failure

Images load asynchronously and can fail. Use `onEvent` to react.

```tsx
import type { ElementNode, NodeProps } from '@solid-multiplatform/platform';

const fallback = './images/fallback.png';

const onEvent = {
  loaded: (node: ElementNode) => {
    node.color = 0xffffffff;
  },
  failed: (node: ElementNode) => {
    node.src = fallback;
  },
};

function Thumbnail(props: NodeProps) {
  return (
    <view
      width={200}
      height={200}
      // Placeholder color while the image loads.
      color={0xff573366}
      {...props}
      onEvent={onEvent}
    />
  );
}
```

## Tinting

`color` multiplies the image. Use the edge colors for a fade.

```tsx
<view
  width={200}
  height={200}
  src={imageUrl}
  colorTop={0xffffffff}
  colorBottom={0x000000ff}
/>
```

## Related

The `Image` primitive from `@solid-multiplatform/platform/primitives` wraps
these patterns.
