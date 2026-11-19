# @solid-multiplatform/renderer

The scene contract of [Solid Multiplatform](https://github.com/solid-multiplatform/platform) and the drawing backends that satisfy it. Applications normally import their UI from [platform](../platform); a host imports the backend it draws with.

## Subpaths

- `/contracts`: the scene contract every backend satisfies: `SceneRenderer`, `SceneNode`, `SceneTextNode` and the `RenderState` values.
- `/webgl`: the WebGL scene renderer with SDF text, on a browser or native WebGL surface. The package root exposes the same API.
- `/canvas`: the Canvas 2D renderer and Canvas text. Pass `CanvasRenderer` as `renderEngine` and `[CanvasTextRenderer]` as `fontEngines`, as `useCanvas()` in the platform package does.
- `/roku`: the Roku SceneGraph renderer. Give the root group to `new SceneGraphRenderer(settings, root, hostCallbacks)`. Install the optional Roku SDK peers on this target.
- `/dom`: a DOM backend for unit tests in jsdom. Not a production renderer.
- `/conformance`: `sceneConformance(harness)`, behaviour cases that run against any backend under any test runner.
- Also `/shaders`, `/webgl/shaders`, `/canvas/shaders`, `/utils`, `/inspector`, `/platform`: shader sources and WebGL-side helpers.

## What a backend must implement

A backend is a directory here whose renderer and node types satisfy the scene contract. The platform package holds your node object and writes its properties directly, so property writes must be cheap.

1. Implement `SceneRenderer`, `SceneNode` and `SceneTextNode` from `contracts.ts`.
2. Add `<backend>/contract.check.ts` with the three `Satisfies<...>` lines the other backends have. The package does not compile until they hold.
3. Run `sceneConformance` against it (see `packages/platform/tests/conformance-dom.test.ts` and `packages/platform/tests/webgl/conformance-*.test.tsx`). Give the harness a `scheduled()` counter: an idle scene must schedule no frame and no timer.
4. Export it as a subpath in `package.json`.

WebGL and Canvas have different node and texture implementations. Keep those inside the backend and use them through the scene contract.

## Install and develop

The package is published with the platform release; a generated app receives it vendored from `solid-platform init`. To work on it here, from the repository root run `corepack pnpm install`, then in this directory:

```sh
npm run build
npm test
```

The step-by-step guide to adding a backend is [docs/add-a-backend.md](../../docs/add-a-backend.md). Device start-up and the Solid JSX binding belong in platform. Hosts that already supply a WebGL surface reuse the WebGL backend.

[Source revisions and notices](PROVENANCE.md)
