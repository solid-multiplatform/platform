# createBlurredImage

`createBlurredImage` loads an image, blurs it and returns the result as a data
URL in a Solid resource.

It draws on a 2D canvas created with `document`, so it works only on hosts
that have a DOM canvas: the web and browser TV targets.

```tsx
import {
  createBlurredImage,
  Image,
} from '@solid-multiplatform/platform/primitives';

export const Backdrop = (props: { url: string }) => {
  const blurred = createBlurredImage(() => props.url, { radius: 15 });

  return <Image src={blurred() ?? props.url} width={1920} height={1080} />;
};
```

The first argument is an accessor. When it returns `null` or `undefined`,
nothing is loaded. The resource is `undefined` until the blur is done.

## Options

- `radius` (`number`, default `10`): blur radius in pixels.
- `crossOrigin` (`'anonymous' | 'use-credentials' | ''`, default
  `'anonymous'`): CORS mode for loading the image.
- `resolution` (`number`, default `1`): scale of the output image.

The image must be served with CORS headers. Without them the canvas cannot be
read and the resource fails.
