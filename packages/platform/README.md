# @solid-multiplatform/platform

The Solid JSX binding, flex layout, focus, UI primitives, device services, hosts and the `solid-platform` CLI of [Solid Multiplatform](https://github.com/solid-multiplatform/platform).

## The app surface

An application is one component, written against the `/app` subpath: `Screen`, `Text`, `Button`, `List`, `TextField`, `Row`, `Column`, `Grid`, the virtual lists, overlays, Solid's reactivity and the host hooks (`usePlugins`, `useHost`, `loadService`, …). [The app API](../../docs/app-api.md) lists all of it.

## The host contract

Each target is one `HostDefinition`, and an app is started with `startApp(host, App, options)`. The CLI generates every target's entry; an entry looks like this:

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const App = () => (
  <view width={1920} height={1080} color={0x101820ff}>
    <text x={90} y={70} fontSize={54}>
      Hello
    </text>
  </view>
);

startApp(webHost({ root: 'app' }), App, {
  renderer: { appWidth: 1920, appHeight: 1080 },
});
```

Compile JSX with Solid in universal mode and `jsxImportSource: '@solid-multiplatform/platform'`. An app created with `solid-platform init` is configured that way.

## Subpaths

- The package root: `createRenderer`, `Config`, `ElementNode`, `loadFonts`, `activeElement` and Solid's control flow.
- `/app`: the one import an application needs (above). `/app/entry`: what a generated entry calls to start an `src/app.tsx` component with the project's settings; app code never imports it.
- `/primitives`: `Row`, `Column`, `Grid`, virtual and lazy lists and more. `/primitives/router`: the router bindings.
- `/host`: `startApp` and the `HostDefinition` contract. `/host/web` and `/host/dom`: the hosts that implement it. `/roku`, `/android`, `/android-tv`, `/ios`, `/apple-tv`, `/browser-tv`: per-target host code.
- `/services`: the service registry. `/services/web`: the browser providers. Each SDK module has its own subpath, for example `/device`, `/media`, `/geolocation`, `/theme`.
- `/focusManager`, `/shaders`, `/devtools`.

## The CLI

`solid-platform` (in `cli/`) creates and builds apps: `init`, `build`, `dev`, `run`, `package`, `doctor`, `devices`, `logs`, `screenshot`, `add`, `plugin new`, `check`, `explain`. In a generated app it is the `platform` script: `corepack pnpm platform --help`. [Getting started](../../docs/getting-started.md) walks through it.

## Status

Pre-1.0. What is tested on which target is in the [feature matrix](../../docs/features.md); the documentation is in [docs/](../../docs/README.md).

Some names from the project's earlier life are still in the code and will be renamed before 1.0: the `SOLIDTV_DOM_RENDERING` and `SOLIDTV_DISABLE_SHADERS` build defines, the `@solidtv/source` import condition and `ElementNode.lng`.

[Source records](PROVENANCE.md)
