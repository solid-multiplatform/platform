# Solid Multiplatform

Build one Solid JSX scene and let a host supply drawing, input and device lifecycle. This repository owns the universal JSX binding, layout, focus, UI primitives and device startup. The [renderer repository](https://github.com/solid-multiplatform/renderer) owns WebGL, Canvas 2D and Roku SceneGraph.

| Target                                           | Host           | Graphics and verification                                                                                                                                                        |
| ------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser TVs, including Tizen, LG webOS and Vizio | `/browser-tv`  | v2 WebGL, or opt into v1 Canvas 2D with `useCanvas()` from `/browser-tv/canvas`. Chromium tests exercise both. Vendor device qualification is pending.                           |
| Roku OS 16+                                      | `/roku/preset` | Native SceneGraph 2.0. The standalone [Roku example](examples/roku) builds a developer ZIP and checks its dependency graph.                                                      |
| Android TV                                       | `/android-tv`  | NativeScript V8 and native WebGL. The [Android example](examples/android-tv) builds a debug APK.                                                                                 |
| Apple TV                                         | `/apple-tv`    | NativeScript tvOS and native WebGL. The [Apple TV example](examples/apple-tv) targets the simulator in macOS CI. Its pinned Canvas SVG dependency has a tvOS compatibility shim. |
| Desktop and standalone iOS                       | Future host    | Reuse the platform JSX runtime and implement the native surface, input, and lifecycle bindings. Engine choice belongs to that host.                                              |

## Build and consume

Use Node 24 and the pinned pnpm version through Corepack.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
node --test tests/native/*.test.mjs
corepack pnpm exec playwright install chromium
corepack pnpm test:webgl
```

The framework has a peer dependency on `@solid-multiplatform/renderer`. For development the lockfile installs a verified renderer tarball from `vendor/`. A fresh clone builds independently. To update that input, run `npm ci && npm pack` in the renderer checkout, replace the development tarball and refresh the framework and example lockfiles. Each device project has its own install. Build the framework first, then run `corepack pnpm install --frozen-lockfile` and `corepack pnpm build` in the example directory. Android needs JDK 21 and the Android SDK. tvOS needs Xcode and the tvOS platform. On Linux, Android developers who need the original EGL multisampling fix can run `bash scripts/build-canvas-native.sh` inside the Android fixture before building. It uses the pinned Canvas source, Cargo lockfile and NDK 28.2.13676358. Install the Rust targets for the selected ABIs first.

## Application and host boundaries

Compile app JSX in Solid universal mode with `moduleName: '@solid-multiplatform/platform'`. Import layout and navigation primitives from `@solid-multiplatform/platform/primitives`. The [shared fixture](examples/shared/app.tsx) uses the same component, focus, reactive text, reorder and disposal logic across targets.

A host binds its native root or graphics surface and input before mounting the app. Apple TV and Android TV accept a loader returning a module with `mount()`. The host binds pause and resume to device lifecycle. Roku's preset takes a shared entry, app title, optional assets directory and manifest fields. Keep shared JSX under the entry's directory. The preset resolves one Solid runtime for both the Roku SDK and app and supplies the native components, font assets and SDK JSX transforms.

For a new device with native WebGL, adapt the renderer platform's surface creation, asset loading, present and clock methods. Register the surface before importing the app, then bind native input and lifecycle. For a different graphics model, add a backend in the renderer repository and install it with `setRendererFactory` before `createRenderer`. The factory receives the settings and root and returns a structural `HostRenderer`. The default web path remains available to existing applications. Run the shared fixture against the backend and add a device package smoke build.

The existing Roku video code is preserved under [references/roku-video](references/roku-video). It illustrates native playback and caption needs for a future extension. [Source records](PROVENANCE.md)
