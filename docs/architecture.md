# Architecture

Solid Multiplatform runs one SolidJS scene on many targets. The scene is not DOM. Solid's universal renderer creates `ElementNode` objects, and each `ElementNode` drives one node of a drawing backend.

## Packages

The repository is a pnpm workspace with three packages. They are versioned together.

- `@solid-multiplatform/renderer` (`packages/renderer`): the scene contract (`contracts.ts`) and the drawing backends that satisfy it: `webgl/`, `canvas/` (Canvas 2D), `roku/` (SceneGraph) and `dom/` (a test backend for jsdom). `conformance/` holds the behaviour cases every backend must pass.
- `@solid-multiplatform/platform` (`packages/platform`): everything an app imports. `src/core` has `ElementNode`, flex layout and focus. `src/primitives` has `Row`, `Column`, virtual lists and the router bindings. `src/sdk` has the device services. `src/host.ts` is the host contract; hosts are in `src/hosts` and `hosts/`. `cli/` is the `solid-platform` CLI.
- `@solid-multiplatform/video` (`packages/video`): optional playback adapters. The other two packages do not depend on it.

The layout is mid-restructure. Hosts and the CLI still live inside the platform package.

## The three contracts

A target is the combination of a backend, a host and a CLI target. Each has a contract.

### 1. The scene contract

`@solid-multiplatform/renderer/contracts` declares what the platform may use of a backend:

- `SceneRenderer`: `root`, `createNode`, `createTextNode`, `createShader`, `createTexture`, `loadFont`, `on`, `requestRender`, `destroy`, and the optional `reprocessUpdates`, `resize`, `pause`, `resume`, `memoryInfo`.
- `SceneNode`: writable props (`x`, `y`, `w`, `h`, `alpha`, `color`, `scale`, `rotation`, `zIndex`, `clipping`, `src`, `shader`, `parent` and more), `absX`/`absY`, `renderState`, `insertBefore`, `animate`, `animateProp`, events and `destroy`.
- `SceneTextNode`: a `SceneNode` plus the text props (`text`, `fontFamily`, `fontSize`, `contain`, `maxLines` and more).
- `RenderState`: the one constant table.

The contract is types plus that table. The platform holds the backend's node object and writes its properties directly, so the contract adds no call and no allocation to a frame.

Two checks keep a backend honest:

- Each backend has a `contract.check.ts` that fails to compile unless its renderer and node types satisfy the contract.
- `sceneConformance(harness)` from `@solid-multiplatform/renderer/conformance` returns behaviour cases. CI runs them on the DOM backend in jsdom and on WebGL, Canvas and the Roku backend (on a fake of the Roku SDK) in Chromium.

Core and primitives may use only what the contract declares. A difference between backends is fixed in the backend, never by branching in core.

### 2. The host contract

`@solid-multiplatform/platform/host` declares what a platform supplies so a scene can run on it:

```tsx
import { startApp } from '@solid-multiplatform/platform/host';
import { webHost } from '@solid-multiplatform/platform/host/web';

const App = () => <view width={1920} height={1080} color={0x101820ff} />;

startApp(webHost({ root: 'app' }), App, {
  renderer: { appWidth: 1920, appHeight: 1080 },
});
```

A `HostDefinition` has a `target`, optional `capabilities`, and `launch(run)`. The host starts the platform and calls `run` with a `HostContext` once a drawing surface exists. The context carries the `surface`, `createRenderer(settings)`, the `keys` event target, and optionally `loadFonts`, `pointer`, `text` and `native`.

`startApp(host, app, options)` then does the same thing on every host: it declares the target's capabilities, builds the renderer, loads fonts, wires keys to focus and renders. Nothing in it runs per frame. It returns the host's disposer when the host has one.

On `main` two hosts implement the contract: `webHost` (`src/hosts/web.ts`, also used for browser TVs through its `target` option) and `domHost` (`src/hosts/dom.ts`, the jsdom test host). The other targets still start through their own entry points: `runAndroidTV`, `runAndroid`, `runIOS` and `runAppleTV` from the `/android-tv`, `/android`, `/ios` and `/apple-tv` subpaths, and the Roku preset. See [Add a host](/add-a-host.md).

### 3. The CLI target

The CLI does not use `HostDefinition` yet. Its contract with an app today is a function:

- The app's `src/app.tsx` exports `mount(plugins, fontRoot, pointer, host)` and returns a disposer.
- On every build the CLI writes `targets/<target>/work/main.ts`. It exports `mount(host)`, which installs services (browser targets), binds the viewport and input, attaches the target's plugins and calls the app's `mount`.
- Browser targets call `mount()` when the page loads. Native targets import `work/main` from their own entry (`targets/<target>/app/app.ts`) and call `mount(host)` when the device host is ready.

A CLI target is therefore a directory under `targets/` with its own `package.json` and build script, plus the branch of `cli/build.mjs` that generates its `work` directory. The list of targets is `available` in `cli/files.mjs`.

## From JSX to a backend node

Take `<view x={40} color={0x253040ff} />`.

1. The Solid compiler runs in universal mode with `moduleName: '@solid-multiplatform/platform'`. It emits calls to `createElement`, `setProp` and `insertNode` from `src/render.ts`.
2. `createElement('view')` returns a new `ElementNode` (`src/solidOpts.ts`). No backend node exists yet. `ElementNode.lng` is a plain object that collects the props.
3. `setProp` assigns `node.x = 40`. Before the node is rendered, the value is stored in that pending object.
4. `insertNode` attaches the element to its parent. When the parent is already rendered, the element renders: it calls `createNode(props)` on the `SceneRenderer` (`createTextNode` for `<text>`) and replaces `lng` with the backend's node.
5. From then on a prop write goes straight to the backend node: `lng.x = 40`. If the element has a `transition` for that prop, the write becomes `lng.animateProp('x', 40, settings)`.
6. Inserts and removals queue one post-mutation pass per tick. It runs in this order: destroy removed nodes, recompute flex layout for dirty subtrees, apply focus. Layout writes `x`, `y`, `w` and `h` on the backend nodes.

`ElementNode.lng` is a legacy name. It is the backend node, typed by the scene contract. It will be renamed before 1.0.

## The frame loop and the idle rule

The first rule of the project is TV performance: zero missed frames, and nothing scheduled while a scene is idle.

- A backend draws only when something changed. `requestRender()` schedules a frame. When a frame ends with nothing left to draw, the renderer emits `idle`.
- An idle scene has no timer, no polling and no animation-frame callback. The conformance suite checks this: when the harness supplies a `scheduled()` counter, the case "an idle scene schedules nothing" fails if the count moves. `packages/renderer/tests/canvas-idle-loop.test.mjs` checks the Canvas frame loop one wake source at a time.
- Services follow the same rule. Installing a provider constructs nothing and subscribes to nothing until an app first uses that service. See [Services](/services.md).
- Feature code is opt-in. If a feature needs a listener or a timer, the app turns it on, and it stops when the app disposes it.

See [Performance](/performance.md) for how to measure.

## Legacy names

These names are in the code on `main` and the docs use them as they are. They will be renamed before 1.0.

- The build defines `SOLIDTV_DOM_RENDERING` and `SOLIDTV_DISABLE_SHADERS`.
- The `@solidtv/source` import condition, which resolves package subpaths to TypeScript sources in this repository's tests and dev builds.
- `ElementNode.lng`, the backend node.
