# States

A state is a named set of style overrides. A button can be focused, disabled or
active, and look different in each. State names start with `$` and live in the
style object.

```tsx
import type { NodeStyles } from '@solid-multiplatform/platform';

const button: NodeStyles = {
  width: 386,
  height: 136,
  color: 0x546160ff,
  alpha: 0.8,
  scale: 1,
  $focus: {
    color: 0x58807dff,
    scale: 1.1,
    alpha: 1,
  },
  $disabled: {
    color: 0x333333ff,
  },
};

<view autofocus style={button} />;
```

The focus manager adds `$focus` to the focused element and removes it when
focus leaves. When a state is removed, each prop it changed goes back to the
value in the base style.

> Give every prop a state changes a value in the base style too. Without one
> there is nothing to go back to. Example: `clipping: false` next to
> `$focus: { clipping: true }`.

## Setting states

Declaratively, with a string, an array or an object:

```tsx
<view style={button} states="$active" />
<view style={button} states={['$active', '$happy']} />
<view style={button} states={{ $active: true, $disabled: isDisabled() }} />
```

Imperatively, through a ref:

```tsx
import type { ElementNode } from '@solid-multiplatform/platform';

let node!: ElementNode;

function toggle() {
  node.states.add('$disabled');
  node.states.has('$disabled'); // true
  node.states.remove('$disabled');
  node.states.toggle('$active');
  node.states.toggle('$active', false); // force off
}

<view ref={node} style={button} />;
```

`is(name)` is `has(name)` for the exact name.

## States read the style object

A state takes its values from the style object, and removing it restores the
base style's value. A prop you set in JSX is not remembered. If `$focus`
changes `color` and you wrote `<view color={...} style={button} />`, the JSX
color is lost the first time focus leaves.

Put such values in `theme` instead.

## `theme`

```tsx
<view style={button} theme={{ color: 0xff0000ff }} />
```

`theme` props are applied when the element is created. When a state is removed,
the element looks in `theme` first and in `style` second for the value to
restore. Use it for per-instance values that states must respect.

## `stateOrder`

When several states are active, later ones override earlier ones.
`Config.stateOrder` sets the order.

```ts
import { Config } from '@solid-multiplatform/platform';

Config.stateOrder = ['$disabled', '$active', '$focus'];
```

- States in the list win over states that are not in it.
- Inside the list, a later entry wins over an earlier one. Here `$focus` beats
  `$active`, which beats `$disabled`.

Override the order for one element with the `stateOrder` prop:

```tsx
<view style={button} stateOrder={['$active', '$focus']} />
```

## `forwardStates`

`forwardStates` copies the parent's states to its children. Use it when a
child must restyle together with its parent.

```tsx
import type {
  NodeProps,
  NodeStyles,
  TextStyles,
} from '@solid-multiplatform/platform';

const container: NodeStyles = {
  width: 386,
  height: 136,
  color: 0x000000ff,
  alpha: 0.3,
  scale: 1,
  transition: {
    scale: { duration: 300, easing: 'ease-in' },
    alpha: { duration: 300, easing: 'ease-in' },
  },
  $focus: {
    color: 0x58807dff,
    scale: 1.2,
    alpha: 1,
  },
};

const label: TextStyles = {
  fontSize: 32,
  x: 24,
  y: 48,
  color: 0xf6f6f9ff,
  $focus: {
    color: 0xffffffff,
  },
};

function Button(props: NodeProps & { label: string }) {
  return (
    <view {...props} forwardStates style={container}>
      <text style={label}>{props.label}</text>
    </view>
  );
}
```

## The focus state name

`Config.focusStateKey` names the state the focus manager adds. The default is
`'$focus'`.
