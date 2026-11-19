# Add a renderer backend

A backend draws the scene. You need a new one only when a platform has a graphics model the existing backends cannot use. A platform that gives you a WebGL context or a 2D canvas reuses `webgl/` or `canvas/` and needs only a [host](/add-a-host.md).

Backends live in `packages/renderer`, one directory each: `webgl/`, `canvas/`, `roku/`, `dom/`.

## The contract

`packages/renderer/contracts.ts`, exported as `@solid-multiplatform/renderer/contracts`. Implement three types:

- `SceneRenderer`: `root`, `createNode`, `createTextNode`, `createShader`, `createTexture`, `loadFont`, `on`, `requestRender`, `destroy`. Optional: `reprocessUpdates`, `resize`, `pause`, `resume`, `memoryInfo`.
- `SceneNode`: the writable props of `SceneNodeProps`, read-only `absX`, `absY` and `renderState`, and `insertBefore`, `animate`, `animateProp`, `on`, `once`, `off`, `destroy`.
- `SceneTextNode`: a `SceneNode` with the props of `SceneTextLayoutProps`.

Things the contract asks of you that are easy to miss:

- The platform holds your node object and writes its properties directly, many per frame. Keep property writes cheap.
- `mount`, `pivot` and `scale` are shorthands: writing one sets both axes.
- `insertBefore(child, before)` appends when `before` is null and moves a child that is already attached, also from another parent.
- `createShader(kind, props)` returns `null` when you have no shader of that kind. The kinds every backend should understand are in `SceneEffectKind`: `rounded`, `roundedWithBorder`, `roundedWithShadow`, `roundedWithBorderWithShadow`, `linearGradient`, `radialGradient`.
- `on('idle', ...)` must fire when a frame ends with nothing left to draw. The platform runs its task queue from it.
- `requestRender()` schedules a frame. Draw only when something changed.

## Steps

1. Create `packages/renderer/<backend>/` and implement the three types.
2. Add `<backend>/contract.check.ts` with the three `Satisfies<...>` lines the other backends have. The package does not compile until they hold:

   ```ts
   import type {
     SceneNode,
     SceneRenderer,
     SceneTextNode,
   } from '../contracts.js';
   import type { MyNode, MyRenderer, MyTextNode } from './index.js';

   type Satisfies<Contract, _Backend extends Contract> = true;
   export type Node = Satisfies<SceneNode, MyNode>;
   export type TextNode = Satisfies<SceneTextNode, MyTextNode>;
   export type Renderer = Satisfies<
     SceneRenderer<MyNode, MyTextNode>,
     MyRenderer
   >;
   ```

3. Run the conformance suite against it (next section).
4. Export the backend as a subpath in `packages/renderer/package.json`.
5. Give a host a `createRenderer` that constructs it. See [Add a host](/add-a-host.md).

## The conformance suite

`sceneConformance(harness)` from `@solid-multiplatform/renderer/conformance` returns a list of cases. They use no test-runner API, so the same list runs under Vitest, `node:test` or Jest:

```ts
import { test } from 'vitest';
import { sceneConformance } from '@solid-multiplatform/renderer/conformance';
import type { SceneNode } from '@solid-multiplatform/renderer/contracts';
import { RendererMain } from '@solid-multiplatform/renderer';
import { scheduled, settle, target } from './conformance-harness';

for (const c of sceneConformance({
  create: () => new RendererMain({ appWidth: 1920, appHeight: 1080 }, target()),
  settle,
  childrenOf: (node) => (node as unknown as { children: SceneNode[] }).children,
  scheduled,
}))
  test('WebGL backend: ' + c.name, c.run);
```

That is `packages/platform/tests/webgl/conformance-webgl.test.tsx`. The harness has four members:

- `create()`: a fresh renderer with an empty root.
- `settle()`: resolves once the backend has applied pending updates, that is, after a frame.
- `childrenOf(node)`: the node's children in paint order. The contract has no child list, so each backend reads its own.
- `scheduled()`, optional: how many frame and timer callbacks have been requested so far. `tests/webgl/conformance-harness.ts` counts them by wrapping `requestAnimationFrame` and `setTimeout`.

The cases check that:

- a node reads back the props it was created with, and a prop write reads back;
- the `mount`, `pivot` and `scale` shorthands set both axes;
- children paint in creation order, and `insertBefore` appends, inserts, moves and takes a child from another parent;
- a destroyed node leaves its parent;
- `absX` and `absY` add every ancestor offset;
- `renderState` is one of the `RenderState` values;
- `animate` returns a controller that runs to its target, and `animateProp` starts at once and lands on its target;
- a text node reads back its text props;
- a `rounded` shader is created and attaches to a node;
- listeners can be added and removed;
- with `scheduled()`: an idle scene schedules nothing.

Give the harness a `scheduled()` counter. Without it the idle rule is not checked for your backend.

## Where the suite runs today

- DOM backend: `packages/platform/tests/conformance-dom.test.ts`, in jsdom, CI job `unit`.
- WebGL: `packages/platform/tests/webgl/conformance-webgl.test.tsx`, headless Chromium, CI job `browser`.
- Canvas 2D: `packages/platform/tests/webgl/conformance-canvas.test.tsx`, same job.
- Roku SceneGraph: `packages/platform/tests/webgl/conformance-roku.test.tsx`, same job. It runs the backend on an in-browser fake of the Roku SDK, not on a device.

The same job runs the shared app fixture on each backend (`fixture-*.test.tsx`) and compares Canvas and WebGL pixels (`tests/visual/run.mjs`).

Passing the suite is necessary, not sufficient. It checks the behaviour the platform relies on. It does not check what your backend draws. Add pixel or device tests of your own before you call the backend `tested` in the [feature matrix](/features.md).
