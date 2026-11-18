# Solid Multiplatform Renderer

One package contains three drawing backends. Import the entry your host uses. Applications normally import UI components from [platform](../platform).

| Entry under `@solid-multiplatform/renderer` | Use                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/webgl`                                    | v2 scene renderer and SDF text on a browser or native WebGL surface. The package root exposes the same API.                                                            |
| `/canvas`                                   | v1 scene renderer, Canvas 2D engine and Canvas text. Pass `CanvasRenderer` as `renderEngine` and `[CanvasTextRenderer]` as `fontEngines`.                              |
| `/roku`                                     | Native Roku SceneGraph renderer. Supply the root group to `new SceneGraphRenderer(settings, root, hostCallbacks)`. Install the optional Roku SDK peers on this target. |
| `/dom`                                      | DOM backend for unit tests in jsdom. Not a production renderer.                                                                                                        |
| `/contracts`                                | The scene contract every backend satisfies: `SceneRenderer`, `SceneNode`, `SceneTextNode`, and the `RenderState` values.                                               |
| `/conformance`                              | `sceneConformance(harness)`: behaviour cases that run against any backend under any test runner.                                                                       |

From the repository root run `corepack pnpm install`, then `npm run build` and `npm test` in this directory. Run `npm pack` for a standalone archive. WebGL and Canvas have different node and texture implementations. Keep those inside the backend and use them through the framework’s scene operations.

## Adding a backend

A backend is a directory here whose renderer and node types satisfy the scene contract.

1. Implement `SceneRenderer`, `SceneNode` and `SceneTextNode` from `contracts.ts`. The platform holds your node object and writes its properties directly, so keep property writes cheap.
2. Add `<backend>/contract.check.ts` with the three `Satisfies<...>` lines the other backends have. The package does not compile until they hold.
3. Run `sceneConformance` against it (see `packages/platform/tests/conformance-dom.test.ts` and `packages/platform/tests/webgl/conformance-*.test.tsx`). Give the harness a `scheduled()` counter: an idle scene must schedule no frame and no timer.
4. Export it as a subpath in `package.json`.

Device startup and the Solid JSX binding belong in platform. Hosts that already supply a WebGL surface reuse the WebGL backend.

[Source revisions and notices](PROVENANCE.md)
