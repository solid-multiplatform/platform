# Components

There are two intrinsic elements: `<view>` and `<text>`. They need no import.
You never write DOM elements, CSS classes or `style={{}}` objects with CSS.

Everything else is a normal Solid component. Read the
[Solid documentation](https://docs.solidjs.com/) for signals, effects, stores
and control flow. All of it applies here.

## A Counter component

```tsx
import { createSignal, type Component } from 'solid-js';
import type { NodeProps, NodeStyles } from '@solid-multiplatform/platform';

interface CounterProps extends NodeProps {
  count: number;
}

const container: NodeStyles = {
  width: 300,
  height: 80,
  color: 0x253040ff,
};

const Counter: Component<CounterProps> = (props) => {
  return (
    <view {...props} style={container}>
      <text x={20} y={20} fontSize={32}>
        {String(props.count)}
      </text>
    </view>
  );
};

function App() {
  const [count, setCount] = createSignal(4);
  return (
    <Counter
      autofocus
      count={count()}
      onEnter={() => {
        setCount((value) => value + 1);
        return true;
      }}
    />
  );
}
```

`NodeProps` is the prop type of `<view>`. `TextProps` is the prop type of
`<text>`. Extend them so callers can pass position, size, focus and key props
through to your root element.

Keep style objects outside the component so every instance shares one object.
See [Styling](/essentials/styling.md).

## Control flow

`For`, `Show`, `Switch`, `Match`, `Index`, `Suspense`, `SuspenseList` and
`ErrorBoundary` are re-exported from `@solid-multiplatform/platform`. They are
the Solid components.

```tsx
import { For } from '@solid-multiplatform/platform';

<For each={names}>{(name) => <text>{name}</text>}</For>;
```

## Dynamic

`Dynamic` renders a component chosen at run time.

```tsx
import { Dynamic } from '@solid-multiplatform/platform';

<Dynamic component={props.large ? LargeTile : SmallTile} title="News" />;
```

## `View` and `Text`

The uppercase `View` and `Text` components are deprecated. Use `<view>` and
`<text>`.
