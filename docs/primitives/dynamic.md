# Dynamic

`Dynamic` renders the component you pass in `component` and gives it the
remaining props. Use it when the component to render is chosen at run time.

Solid's own `Dynamic` comes from `solid-js/web` and creates DOM elements. Use
the one from `@solid-multiplatform/platform`.

```tsx
import { For } from 'solid-js';
import { Dynamic } from '@solid-multiplatform/platform';
import { Row } from '@solid-multiplatform/platform/primitives';

const Poster = (props: { title: string }) => (
  <view width={200} height={300} color="#264653ff">
    <text>{props.title}</text>
  </view>
);

const Hero = (props: { title: string }) => (
  <view width={600} height={300} color="#2a9d8fff">
    <text>{props.title}</text>
  </view>
);

const byType = { poster: Poster, hero: Hero };

export const Rail = (props: {
  type: keyof typeof byType;
  titles: string[];
}) => (
  <Row autofocus>
    <For each={props.titles}>
      {(title) => <Dynamic component={byType[props.type]} title={title} />}
    </For>
  </Row>
);
```

## Props

- `component`: a component function, or the name of an intrinsic element
  (`'view'` or `'text'`). When it is `undefined` or `null`, nothing is
  rendered.

Every other prop is passed to the component.
