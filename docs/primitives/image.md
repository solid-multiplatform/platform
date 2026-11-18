# Image

`Image` shows a placeholder while an image loads and a fallback when it fails.
It costs more than a plain node. When you need neither, use
`<view src={url} />`.

```tsx
import { Image } from '@solid-multiplatform/platform/primitives';

export const Poster = () => (
  <Image
    src="https://example.com/poster.png"
    placeholder="./assets/placeholder.png"
    fallback="./assets/fallback.png"
    fit="contain"
    width={185}
    height={278}
  />
);
```

## Props

`Image` accepts every `<view>` prop, plus:

- `src` (`string`, required): the image to show.
- `placeholder` (`string`): shown while `src` loads.
- `fallback` (`string`): shown when `src` fails to load.
- `fit` (`'cover' | 'contain'`): how the image fits the node. Without it the
  renderer's default applies.

## Behavior

- The placeholder is shown first, when there is one.
- When `src` loads, it replaces the placeholder.
- When `src` fails and there is a `fallback`, the fallback is shown. Without a
  fallback the placeholder stays.
- When `src` or `placeholder` changes, the component starts again from the
  placeholder. A slow earlier load never replaces a newer one.
