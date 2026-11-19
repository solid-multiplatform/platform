# Migrating from the old names

Solid Multiplatform grew out of the project published as `@lightningtv/solid` and later as `@solidtv/solid` ("SolidTV"). This page lists what changed for an app that used either. It is a rename plus a short list of removals.

## Packages

- `@lightningtv/solid` or `@solidtv/solid` becomes `@solid-multiplatform/platform`.
- `@lightningjs/renderer`, `@lightningtv/renderer` or `@solidtv/renderer` becomes `@solid-multiplatform/renderer`.

The platform package names the exact renderer version it was built and tested with as a peer dependency. Install that version, not the newest one.

## Imports

The subpaths an app is likely to use kept their names:

- `@solid-multiplatform/platform`
- `@solid-multiplatform/platform/primitives`
- `@solid-multiplatform/platform/primitives/router`
- `@solid-multiplatform/platform/devtools`
- `@solid-multiplatform/platform/shaders`
- `@solid-multiplatform/platform/jsx-runtime`

```ts
// before
import { Config } from '@solidtv/solid';
import { Row, Column } from '@solidtv/solid/primitives';

// after
import { Config } from '@solid-multiplatform/platform';
import { Row, Column } from '@solid-multiplatform/platform/primitives';
```

## Build configuration

- `vite-plugin-solid`: set `solid.generate` to `'universal'` and `solid.moduleName` to `'@solid-multiplatform/platform'`.
- `resolve.dedupe`: `'solid-js'`, `'@solid-multiplatform/platform'`, `'@solid-multiplatform/renderer'`.
- `tsconfig.json`: set `jsxImportSource` to `'@solid-multiplatform/platform'`.

An app created with `solid-platform init` has all of this already. See [Getting started](/getting-started.md).

## Names that did not change yet

These still carry the old project's name on `main`. Use them as they are. They will be renamed before 1.0.

- The build defines `SOLIDTV_DOM_RENDERING` and `SOLIDTV_DISABLE_SHADERS`. The older `LIGHTNING_*` defines are not read.
- The `@solidtv/source` import condition.
- `ElementNode.lng`, the backend node behind an element.

## Removed or changed

- `render` is not exported from the package root. Call `createRenderer()` and use the `render` it returns, or use `startApp` from `@solid-multiplatform/platform/host`. See [Starting an app](/essentials/render.md).
- The renderer settings `renderEngine` and `fontEngines` are ignored, with a console warning. The WebGL backend has one engine and SDF text. The Canvas 2D backend is a separate entry (`useCanvas()` from `@solid-multiplatform/platform/browser-tv/canvas`).
- `renderer.stage.shManager.registerShaderType(...)` still works through an alias that warns. Call `renderer.registerShaderType(...)`.
- There is one flex engine. The `VITE_USE_NEW_FLEX` switch is gone.
- `HashRouter`, `KeepAlive` and `KeepAliveRoute` are exported from `@solid-multiplatform/platform/primitives/router`, not from the package root.
- `<View>` and `<Text>` still work but are deprecated. Use the `<view>` and `<text>` intrinsic elements.
- `LazyUp` was removed. Use `LazyRow` and `LazyColumn`.

## What is new

- Targets beyond browser TVs, a CLI and a project layout: [Getting started](/getting-started.md) and [Targets](/targets/README.md).
- Device services behind one registry: [Services](/services.md).
- A typed contract between the platform and its drawing backends: [Architecture](/architecture.md).
