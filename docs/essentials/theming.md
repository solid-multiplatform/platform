# Theming

A `style` object is applied once, when the element is created. It is meant to
be shared between instances, so you do not swap it to change theme. There are
three ways to theme instead.

## Design tokens with `ThemeProvider`

`@solid-multiplatform/platform/theme` has a `Theme` type with colors, spacing,
radii, type sizes and motion durations. `useTheme()` returns the current one.

```tsx
import { ThemeProvider, useTheme } from '@solid-multiplatform/platform/theme';

function Title(props: { text: string }) {
  const theme = useTheme();
  return (
    <text
      x={theme.spacing(6)}
      y={theme.spacing(4)}
      fontSize={theme.typography.title}
      color={theme.colors.text}
    >
      {props.text}
    </text>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Title text="Home" />
    </ThemeProvider>
  );
}
```

- Without a `theme` prop, `ThemeProvider` follows the host's color scheme and
  high-contrast preference. The built-in themes are `lightTheme`, `darkTheme`,
  `highContrastLightTheme` and `highContrastDarkTheme`.
- Pass `theme` (a `Theme` or an accessor of one) to use your own.
- `useColorScheme()` returns `'light'` or `'dark'`. `setColorScheme(scheme)`
  sets it.
- `useTheme()` works without a provider and returns the platform default.

Because the props read `useTheme()` in JSX, they update when the theme changes.

## Spreading props

Pick a set of props and spread it.

```tsx
const dark = { color: 0x000000ff };
const light = { color: 0xffffffff };

<view width={400} height={200} {...(props.mode === 'dark' ? dark : light)} />;
```

## States

Put each theme in a state and switch the state. See
[States](/essentials/states.md).

```tsx
import type { NodeStyles } from '@solid-multiplatform/platform';

const panel: NodeStyles = {
  width: 400,
  height: 200,
  color: 0xffffffff,
  $dark: { color: 0x000000ff },
};

<view style={panel} states={{ $dark: props.mode === 'dark' }} />;
```
