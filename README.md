# Solid Multiplatform

Build one Solid JSX scene and let a host supply drawing, input and device lifecycle. This repository owns the universal JSX binding, layout, focus, UI primitives and device startup. The [renderer repository](https://github.com/solid-multiplatform/renderer) owns WebGL, Canvas 2D and Roku SceneGraph.

| Target                                           | Host           | Graphics and verification                                                                                                                                                        |
| ------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser TVs, including Tizen, LG webOS and Vizio | `/browser-tv`  | v2 WebGL, or opt into v1 Canvas 2D with `useCanvas()` from `/browser-tv/canvas`. Chromium tests exercise both. Vendor device qualification is pending.                           |
| Roku OS 16+                                      | `/roku/preset` | Native SceneGraph 2.0. The standalone [Roku example](examples/roku) builds a developer ZIP and checks its dependency graph.                                                      |
| Android TV                                       | `/android-tv`  | NativeScript V8 and native WebGL. The [Android example](examples/android-tv) builds a debug APK.                                                                                 |
| Apple TV                                         | `/apple-tv`    | NativeScript tvOS and native WebGL. The [Apple TV example](examples/apple-tv) targets the simulator in macOS CI. Its pinned Canvas SVG dependency has a tvOS compatibility shim. |
| iOS                                              | `/ios`         | NativeScript canvas host with app-owned Swift commands.                                                                                                                          |
| Desktop GUI                                      | Future host    | Reuse the platform JSX runtime and implement the native surface, input, and lifecycle bindings. Engine choice belongs to that host.                                              |

## Start an app or plugin

After the framework install below, use the built-in CLI to scaffold an independent project. It vendors the two current package archives so the new app can be checked out and built before the first npm release.

```sh
node cli/main.mjs init ../living-room --targets web,roku,android-tv,apple-tv,ios,desktop
cd ../living-room
corepack pnpm install
corepack pnpm platform plugin new preview --android-kind sidecar
corepack pnpm build web
corepack pnpm dev desktop
```

Each plugin lives in `plugins/<name>`. The starter's shared UI receives the selected target's named command modules. Extend the typed `Plugin` contract in `src/app.tsx` as the app's commands evolve. Use `--targets` on `plugin new` for plugins that exist only on some devices. The CLI reads the manifests when building and registers the matching implementation. Edit the plugin sources and rebuild. Generated files in `targets/<target>/work` are disposable.

| Target              | Generated plugin                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web and browser TVs | A JavaScript module consumed by the Vite app.                                                                                                                                                                                                                                    |
| Roku                | A SceneGraph Task, BrighterScript source compiled with `bsc`, and a typed request/response binding.                                                                                                                                                                              |
| Android TV          | An app-local Gradle library with Kotlin commands. Choose `--android-kind kotlin`, `sidecar`, `service`, or `jni`. The sidecar returns offscreen pixels from an NDK executable. The service demonstrates a user-started, bounded foreground job. JNI calls an NDK shared library. |
| iOS and Apple TV    | One Swift `NSObject` subclass shared by the two Apple bindings. Its `@objc` method is called through NativeScript.                                                                                                                                                               |
| Desktop             | A Node command host runs an app-bundled executable built from C. `dev desktop` runs each selected plugin. A desktop GUI renderer is a separate integration.                                                                                                                      |

The Apple pattern follows the native command method in [Tauri's Swift template](https://github.com/tauri-apps/tauri/blob/22185acc06ca5d11b29276afa6a162fb1dee1475/crates/tauri-cli/templates/plugin/ios-spm/Sources/ExamplePlugin.swift) and uses [NativeScript's Swift metadata bridge](https://docs.nativescript.org/guide/native-code/ios). The [Android fixture](examples/android-tv/README.md) shows where Kotlin, executable code, and future native surface integrations fit. Service templates use Android's short-service lifecycle. Longer-running work needs a service type appropriate to the app's workload.

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
