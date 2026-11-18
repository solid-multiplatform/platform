# Solid Multiplatform Renderer

One package contains three drawing backends. Import the entry your host uses. Applications normally import UI components from [platform](../platform).

| Entry under `@solid-multiplatform/renderer` | Use |
| --- | --- |
| `/webgl` | v2 scene renderer and SDF text on a browser or native WebGL surface. The package root exposes the same API. |
| `/canvas` | v1 scene renderer, Canvas 2D engine and Canvas text. Pass `CanvasRenderer` as `renderEngine` and `[CanvasTextRenderer]` as `fontEngines`. |
| `/roku` | Native Roku SceneGraph renderer. Supply the root group to `new SceneGraphRenderer(settings, root, hostCallbacks)`. Install the optional Roku SDK peers on this target. |
| `/contracts` | Type-only interface for a device renderer. |

From the repository root run `corepack pnpm install`, then `npm run build` and `npm test` in this directory. Run `npm pack` for a standalone archive. WebGL and Canvas have different node and texture implementations. Keep those inside the backend and use them through the framework’s scene operations.

For a new native graphics API, implement the operations in `HostRenderer`, wire its native root and publish an isolated subpath here. The device startup and Solid JSX binding belong in platform. Hosts that already supply WebGL can reuse the existing backend.

[Source revisions and notices](PROVENANCE.md)
