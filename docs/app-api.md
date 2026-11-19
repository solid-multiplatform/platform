# The app API

Everything an app is written with comes from one import: `@solid-multiplatform/platform/app`. It only re-exports, so a name you do not import costs nothing in the bundle. The fine-grained subpaths (`/primitives`, `/theme`, `/services` and the rest) stay available.

An app is a component, default-exported from `src/app.tsx`. There is no `mount` function, and no host, plugin or font parameter: the CLI generates each target's entry around the component.

```tsx
import { Button, Screen, Text } from '@solid-multiplatform/platform/app';

export default function App() {
  return (
    <Screen>
      <Text size="title">Hello</Text>
      <Button onPress={() => console.log('pressed')}>Press me</Button>
    </Screen>
  );
}
```

## Settings

Fonts, the design size and the theme come from the `app` section of `solid-platform.config.json`:

```json
{
  "name": "living-room",
  "targets": ["web", "tizen", "roku"],
  "app": {
    "fonts": [
      {
        "family": "Lato",
        "atlas": "Lato-Regular.msdf",
        "file": "Lato-Regular.ttf"
      }
    ],
    "designSize": { "width": 1920, "height": 1080 },
    "theme": "dark"
  }
}
```

- `fonts`: the fonts to load; the first family is the default. `atlas` names an MSDF atlas in `assets/fonts` without its extension. `file` names a font file in `targets/roku/fonts`, because Roku draws text from font files. When `fonts` is left out, every atlas in `assets/fonts` is loaded (on Roku, every font file in `targets/roku/fonts`), and the family is the file name up to its first hyphen or dot.
- `designSize`: the coordinate space of the app's TV screens. `Screen` scales it to the device on TV targets (`roku`, `tizen`, `webos`, `vizio`, `android-tv`, `apple-tv`). Phones, desktop windows and the web keep the viewport's own units.
- `theme`: `system` (the default) follows the device's light or dark appearance; `light` and `dark` fix it.

`init` writes `designSize` and `theme`. The CLI rejects an unknown key or a wrong value and names it.

An optional `options` export of `src/app.tsx` overrides the config in code. It also takes what `startApp` takes: `keyMap`, `pointer` and `renderer`.

```tsx
import {
  defineTheme,
  type AppSettings,
} from '@solid-multiplatform/platform/app';

export const options: AppSettings = {
  theme: defineTheme({ colors: { primary: 0xe11d48ff, focus: 0xe11d48ff } }),
  keyMap: { Back: ['Escape', 'Backspace'] },
};
```

An app written before this API, which exports `mount` (and `App` and `appOptions` for browser targets) and has no default export, keeps building: its entry is generated as before.

## Components

### Screen

The root of a screen. It fills the viewport with the theme's background, keeps its children inside the safe area, lays them out as a column and moves focus between them with up and down. The geometry is computed when the viewport changes, never per frame.

- `padding` (default `theme.spacing(8)`): space between the safe area and the content.
- `gap` (default `theme.spacing(6)`): space between children.
- `designSize` (default: the config's, on TV targets): lay the children out in this coordinate space and scale it to the viewport.
- `fit` (default `extend`): what to do when the viewport's aspect ratio differs from the design's.

It also takes the props of `Column`.

With a design size, the scale is the smaller of `viewport width / design width` and `viewport height / design height`:

- `fit="extend"` fills the viewport. The design space grows along the spare axis: a 1920 by 1080 design on a 4:3 screen becomes 1920 by 1440. Lay out with flex and `Spacer` and nothing is cut off.
- `fit="contain"` keeps the design size exactly and centres it. The bars are the theme's background colour.

```tsx
import { Screen, Spacer, Text } from '@solid-multiplatform/platform/app';

export function Player() {
  return (
    <Screen designSize={{ width: 1920, height: 1080 }} fit="contain">
      <Text size="headline">Now playing</Text>
      <Spacer />
      <Text muted>Press Back to leave</Text>
    </Screen>
  );
}
```

A design size suits screens of one shape. A TV layout scaled onto a phone is too small to read: leave the design size to TV targets, as the config does, or give the phone its own file (`app.mobile.tsx`).

### Text

Text in the theme's type scale and colour. `size` is `headline`, `title`, `body` (the default), `label`, or a number; `muted` draws in the secondary colour. It takes the props of `<text>`.

```tsx
<Text size="title">Settings</Text>
<Text muted>Version 1.2.0</Text>
<Text size={18} color={0xffd166ff}>Custom</Text>
```

### Button

A button drawn in the scene. Its width follows its label; its height is one line of the theme's body text plus padding. Enter on a remote or keyboard, a pointer click and a tap all call `onPress`. It shows the theme's focus, hover and pressed colours, and assistive technology reads it as a button named by its label.

```tsx
<Button onPress={() => setCount(count() + 1)}>{`Pressed ${count()} times`}</Button>
<Button onPress={save} disabled={!dirty()}>Save</Button>
```

The label is text. A disabled button is dimmed, skipped by focus and not activated.

### List

One focusable item per entry: arrow keys move focus, the list scrolls to keep the focused item in view, and `onSelect` receives the item that was activated by Enter, a click or a tap. `direction` is `column` (the default) or `row`. It takes the props of `Column` and `Row`.

```tsx
import { Button, List, Screen } from '@solid-multiplatform/platform/app';

export function Channels(props: {
  names: string[];
  onOpen: (name: string) => void;
}) {
  return (
    <Screen>
      <List direction="row" each={props.names} onSelect={props.onOpen}>
        {(name) => <Button>{name}</Button>}
      </List>
    </Screen>
  );
}
```

For thousands of items use `VirtualRow`, `VirtualColumn` or `VirtualGrid`: see [VirtualRow and VirtualColumn](/primitives/virtual.md).

### Spacer, Row and Column

`Row` and `Column` are flex containers that move focus between their children; they take `gap` and `padding`. `Spacer` takes the free space of the container it is in.

```tsx
<Row gap={16}>
  <Button onPress={back}>Back</Button>
  <Spacer />
  <Button onPress={next}>Next</Button>
</Row>
```

### Also exported

- Control flow and reactivity from Solid: `For`, `Index`, `Show`, `Switch`, `Match`, `ErrorBoundary`, `createSignal`, `createMemo`, `createEffect`, `onMount`, `onCleanup`.
- Layout and media: `Grid`, `VirtualRow`, `VirtualColumn`, `VirtualGrid`, `Image`, `Visible`. See the [primitives pages](/primitives/row_column.md).
- Overlays: `Modal`, `Sheet`, `Alert`, `Toast`, `AppErrorBoundary`.
- Routing: `HashRouter` and `KeepAliveRoute`; `Route` and `useNavigate` come from `@solidjs/router`. See [Router](/primitives/router.md).

## Hooks

- `useHost()`: `{ target, capabilities, native }`, the target's name, what the host can do, and its native root.
- `usePlugins<T>()`: the project's plugins built for this target, by name.
- `usePlugin<T>(name)`: one plugin, or `undefined` when it is not built for this target.
- `useViewport()`: the viewport's `width`, `height`, `scale`, `safeArea` and `keyboardInset`. Reactive.
- `useBreakpoint()`: `compact`, `medium` or `expanded`, from the viewport's width. Reactive.
- `useTheme()`: the current theme's tokens.
- `useColorScheme()`: an accessor of `light` or `dark`, following the device while the caller is mounted.
- `useLocale()`: an accessor of the app's locale.
- `useConnectivity()`: an accessor of whether the device is online; `undefined` when the host cannot tell.
- `useLifecycle()`: an accessor of whether the app is in the foreground; `undefined` when the host cannot tell.
- `useBattery()`: an accessor of `{ level, charging }`, read once when the caller mounts; `undefined` without a battery.

The service hooks subscribe while the calling component is mounted and unsubscribe when it goes. None of them throws on a host without the service. `useColorScheme` from `/app` returns an accessor; the export of the same name from the package root is the accessor itself.

```tsx
import {
  Screen,
  Show,
  Text,
  useConnectivity,
  useHost,
  usePlugin,
} from '@solid-multiplatform/platform/app';

export function Status() {
  const host = useHost();
  const online = useConnectivity();
  const greeting = usePlugin<{ run(): Promise<string> }>('greeting');
  return (
    <Screen>
      <Text>{`Running on ${host.target}`}</Text>
      <Show when={online() === false}>
        <Text muted>Offline</Text>
      </Show>
      <Show when={greeting}>
        <Text muted>The greeting plugin is built for this target</Text>
      </Show>
    </Screen>
  );
}
```

## Services

One-shot calls are functions. A host that lacks the service rejects the call, so ask first with `available`:

```tsx
import { Button, available, share } from '@solid-multiplatform/platform/app';

export function ShareButton(props: { url: string }) {
  return (
    <Button
      disabled={!available('share')}
      onPress={() => void share({ url: props.url })}
    >
      Share
    </Button>
  );
}
```

Exported from `/app`: `share`, `readClipboard`, `writeClipboard`, `openExternal`, `deviceInfo`, `keepAwake`, `impact`, `loadService`, and `setupI18n` with `t` for translated strings. Every other service has its own subpath: see [Services](/services.md).

## Theme

`Screen`, `Text` and `Button` read the theme of [Theming](/essentials/theming.md): colours, the 4-point `spacing` scale, the `typography` sizes and the focus colour. `defineTheme` makes a theme from the dark one (or a base you pass) and your changes:

```tsx
import { ThemeProvider, defineTheme } from '@solid-multiplatform/platform/app';

const brand = defineTheme({
  colors: { background: 0x101014ff, primary: 0xe11d48ff, focus: 0xe11d48ff },
  typography: { title: 40 },
});
```

Export it as `options.theme` for the whole app, or wrap part of a screen in `<ThemeProvider theme={brand}>`. A `Button` reads its colours when it is created: it does not follow a theme that changes while it is on screen.

## Target variants

One adaptive screen is the default. When a target needs a different layout, add a file with the target's or family's suffix next to the shared one: `app.roku.tsx`, `app.tv.tsx`, `app.mobile.tsx`, `app.desktop.tsx`. The CLI picks one file per module before it builds; `solid-platform explain roku app` shows which. See [Getting started](/getting-started.md#target-variants).

## What is verified where

- Components, hooks and the entry: unit tests on the DOM backend (`packages/platform/tests/app-surface.test.tsx`, `tests/host/app-entry.test.tsx`, `tests/cli/unit/app-entry.test.mjs`).
- The starter end to end in Chromium, with a real pointer, the keyboard and the accessibility tree: the `web` build, and the `tizen` (WebGL and Canvas 2D), `webos` and `vizio` builds (`tests/cli/projects-smoke.sh`).
- The generated entry is built, and not run, for `roku` (`projects-smoke.sh`) and `android-tv` (`android-smoke.sh`).
- Not covered by an automated test: the entry on `desktop`, `android`, `ios` and `apple-tv`, and the components on any device.
