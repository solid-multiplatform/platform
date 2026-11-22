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

Every target, Roku included, starts the default export through `startApp` on its host. An app written before this API, which exports `mount` (and `App` and `appOptions` for browser targets) and has no default export, keeps building: its entry is generated as before.

## Components

### Screen

The root of a screen. It fills the viewport with the theme's background, keeps its children inside the safe area and above the software keyboard (`useViewport().keyboardInset`), lays them out as a column and moves focus between them with up and down. The geometry is computed when the viewport changes, never per frame.

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

### TextField and SearchField

A labelled field drawn in the scene. Focus it and press Enter (or click it) and the host's own editor takes over: the system keyboard, IME and autofill; every change calls `onChange`. There is no `Controls` wrapper and no bounds to compute — the host editor comes from the app context. `SearchField` is a `TextField` that asks for the search keyboard and defaults its placeholder to the label.

```tsx
import {
  SearchField,
  TextField,
  createSignal,
} from '@solid-multiplatform/platform/app';

export function SignIn() {
  const [name, setName] = createSignal('');
  const [code, setCode] = createSignal('');
  return (
    <>
      <TextField label="Name" value={name()} onChange={setName} autofocus />
      <TextField label="Password" password value={code()} onChange={setCode} />
      <SearchField label="Search" onSubmit={runSearch} />
    </>
  );
}
```

- `label`: drawn above the field and given to assistive technology.
- `placeholder`: shown muted while the value is empty.
- `value` and `onChange`: controlled value; leave `value` out to let the field keep its own.
- `password`: draws bullets and asks for a password keyboard.
- `numeric`: asks for a numeric keyboard (the host's one-time-code layout).
- `multiline`, `autofocus`, `disabled`, `width`, `height`, `onSubmit` and `purpose` are also taken.

On a host without an editor the field still draws its label, placeholder and value; pressing Enter does nothing. The host editor is the `text` of `HostContext`, so a web build shows a real input and Roku opens its native keyboard dialog.

### Switch, Slider and ActivityIndicator

`ToggleSwitch` is Apple's switch (`Switch` from the primitives entry, renamed here because Solid already exports its conditional `Switch`): the whole labelled row is one focus/touch target and the knob slides when toggled. `Slider` is a controlled track with a round knob; drag it or use Left/Right/Home/End. `ActivityIndicator` is the eight-spoke spinner; it animates only while `animating` and follows Reduce Motion.

```tsx
import {
  ActivityIndicator,
  Slider,
  ToggleSwitch,
} from '@solid-multiplatform/platform/app';

<ToggleSwitch label="Crossfade" checked={crossfade()} onChange={setCrossfade} />
<Slider label="Volume" value={volume()} min={0} max={100} step={5} onChange={setVolume} />
<ActivityIndicator label="Loading tracks" />
```

### ActionSheet

Apple's action sheet for a set of related choices: a dimmed parent, a card of choices (a destructive one in red), and a separate Cancel button. Tapping outside or Back cancels.

### PageControl

One dot per page, the current one filled. Each dot has a 44-unit hit target; the control is skipped by focus unless an app wraps it.

```tsx
import { PageControl } from '@solid-multiplatform/platform/app';

<PageControl count={images().length} index={page()} onChange={setPage} />;
```

```tsx
import { ActionSheet } from '@solid-multiplatform/platform/app';

<ActionSheet
  visible={open()}
  title="Track actions"
  actions={[
    { label: 'Play next', onPress: playNext },
    { label: 'Delete', style: 'destructive', onPress: remove },
  ]}
  onRequestClose={() => setOpen(false)}
/>;
```

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
- Back and screen state: `createScreenHistory` captures each screen's data
  and its focused element's key path, then restores both after Back or
  Forward. Add `focusKey` to containers and `itemKey` to lists; focus follows
  the card, never its index. See [Screen history and keyed focus](/essentials/screen-history.md).

## Scrolling

`Row` and `Column` scroll with the focus keys by default: `scroll="auto"`,
`"edge"`, `"always"`, `"center"`, `"bounded"` or `"none"`. On a pointer-touch
host — mobile, web touch, or the PS4's pointer remote — pass `scroll="touch"`
to add direct manipulation: drag, fling, rubber band and, on a horizontal
rail, snapping to one item plus the gap:

```tsx
// Before: a rail moved only with Left/Right, and hand-written pointer code.
<view width={640} height={200} clipping>
  <Row gap={16}>
    <For each={cards}>{(card) => <Card card={card} />}</For>
  </Row>
</view>

// After: the same rail also drags, flings and snaps; keys still work.
<view width={640} height={200} clipping>
  <Row gap={16} scroll="touch">
    <For each={cards}>{(card) => <Card card={card} />}</For>
  </Row>
</view>
```

A vertical `Column` scrolls continuously; a horizontal `Row` snaps to
`item + gap`. A nested horizontal `Row` inside a vertical `Column` works
without per-screen code: after a 10-unit slop the gesture locks to its
dominant axis and stays locked, so the rail takes horizontal drags and the
page takes vertical ones. Two nested scrollers with the same orientation are
ambiguous and discouraged, as Apple's guidance says; the innermost one wins.

Focus navigation keeps working on the same view. Moving focus reveals the
item only as far as needed, without jumping it to the start. A television — a
remote or browser TV, where focus movement is the model — ignores
`scroll="touch"` and keeps its focus-driven scrolling; the same is true of
`VirtualRow`, `VirtualColumn` and `VirtualGrid`, which need offset-driven
windowing before touch scrolling can be added. Desktop wheel and keyboard
scrolling are unchanged: wheel events still step focus or reach an app
handler, and the arrow keys keep their page/line semantics.

The engine is `createScrollEngine` in `@solid-multiplatform/platform/scroll`.
Its model and constants, kept in one module with no new dependency:

| Part             | Value / rule                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --------- | --------- | --- |
| Release velocity | UIPanGestureRecognizer's chain: per-event finite differences, blended `0.2·current + 0.8·previous`, then `0.75·previous + 0.25·latest` at release. A drag that stops flings nowhere. |
| Deceleration     | `UIScrollViewDecelerationRateNormal`: velocity keeps `0.998` per millisecond. UIKit projects down to the 0.01 units/ms floor: `(                                                     | v   | - 0.01) / | ln(0.998) | `.  |
| Minimum fling    | Below `0.25` units/ms a release does not decelerate, as on iOS.                                                                                                                      |
| Rubber band      | `f(x, d, c) = (x · d · c) / (d + c · x)` with `c = 0.55` and `d` the viewport length; content never goes more than one viewport past an edge.                                        |
| Bounce           | The overshoot contracts at `0.99` per millisecond with the carried velocity (`_getBouncingDecelerationOffset`), settling within 0.5 units of the bound.                              |
| Snap             | A fling decays at the rate that lands exactly on the nearest slot (the content end is a slot too); a slow release glides into it at `0.98` per millisecond.                          |
| Axis lock        | Horizontal or vertical, decided once the gesture passes 10 scene units; ties go horizontal.                                                                                          |
| Idle             | `requestAnimationFrame` only during a fling, bounce or settle; a drag follows pointer events. A resting scroller schedules nothing.                                                  |

Sources: Apple's [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views)
(page-by-page only where it fits; show partial content at the edge; no
same-orientation nesting; scroll automatically only as far as needed),
[Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures),
[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
(short, purposeful motion that can be cancelled) and the
[UIScrollView](https://developer.apple.com/documentation/uikit/uiscrollview)
reference (`decelerationRate`, bouncing). The instruction-level constants
come from the mobile demo's researched scroller
(`archive/mobile-demo/src/scroller.ts`, whose README records its sources);
`src/sdk/scroll.ts` keeps the same constants.

## Hooks

- `useHost()`: `{ target, capabilities, native }`, the target's name, what the host can do, and its native root.
- `usePlugins<T>()`: the project's plugins built for this target, by name.
- `usePlugin<T>(name)`: one plugin, or `undefined` when it is not built for this target.
- `useViewport()`: the viewport's `width`, `height`, `scale`, `safeArea` and `keyboardInset`. Reactive.
- `useBreakpoint()`: `compact`, `medium` or `expanded`, from the viewport's width. Reactive.
- `useTheme()`: the current theme's tokens.
- `useColorScheme()`: an accessor of `light` or `dark`, following the device while the caller is mounted. Import `deviceColorScheme` for the raw reactive accessor, without binding the host service.
- `useLocale()`: an accessor of the app's locale.
- `useConnectivity()`: an accessor of whether the device is online; `undefined` when the host cannot tell.
- `useLifecycle()`: an accessor of whether the app is in the foreground; `undefined` when the host cannot tell.
- `useBattery()`: an accessor of `{ level, charging }`, kept current by a host that reports changes and read once on a host that only answers on request; `undefined` without a battery.

The service hooks subscribe while the calling component is mounted and unsubscribe when it goes. None of them throws on a host without the service. `useColorScheme` from `/app` returns an accessor; the export of the same name from the package root is the accessor itself. The `/app` alias for that raw accessor is `deviceColorScheme`, so the two cannot be confused.

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

- Components, hooks and the entry: unit tests on the DOM backend (`packages/platform/tests/app-surface.test.tsx`, `tests/app-textfield.test.tsx`, `tests/host/app-entry.test.tsx`, `tests/cli/unit/app-entry.test.mjs`).
- The starter end to end in Chromium, with a real pointer, the keyboard and the accessibility tree: the `web` build, and the `tizen` (WebGL and Canvas 2D), `webos` and `vizio` builds (`tests/cli/projects-smoke.sh`).
- The generated entry is built, and not run, for `roku` (`projects-smoke.sh`) and `android-tv` (`android-smoke.sh`).
- Not covered by an automated test: the entry on `desktop`, `android`, `ios` and `apple-tv`, and the components on any device.
