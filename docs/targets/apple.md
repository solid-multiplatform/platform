# iOS and tvOS

Target names: `ios`, `apple-tv`.

## What it is built from

- Backend: the WebGL backend on a native canvas surface.
- Host: a NativeScript app. `runIOS(loadApp)` from `@solid-multiplatform/platform/ios` and `runAppleTV(loadApp)` from `@solid-multiplatform/platform/apple-tv` create the surface, bind input and the lifecycle, and call the `mount` of the module your loader returns. These hosts do not implement `HostDefinition` yet.
- Services: `mobileServices(namespace, extensions)` from `@solid-multiplatform/platform/services/native`.
- CLI target: `targets/ios` or `targets/apple-tv`, a NativeScript project. A plugin is one Swift class shared by both targets; the build copies plugin Swift sources into `work/swift`.

## Build

```sh
corepack pnpm build ios        # ns build ios --emulator
corepack pnpm build apple-tv   # ns build tvos --emulator
```

The CLI builds for the simulator. You need macOS and Xcode; CI uses Xcode 26.3 on `macos-15`. `dev` is not available: install the app with `xcrun simctl`.

Building for a physical iPhone or Apple TV needs your own signing identity and is outside what the CLI does today.

## How it is tested

- `apple` job (`test.yml`), once per target: `tests/cli/apple-smoke.sh` creates an app with `init`, adds a plugin and the video package, builds it, installs it in the newest available simulator, launches it and waits for the Swift plugin command to return its result through NativeScript.
- `unit` job: `tests/apple-providers.test.mjs` and `tests/apple-signing.test.mjs`, in Node with fakes.

What this does not cover:

- No test checks what the scene draws in the simulator. The launch test proves the app starts and the plugin bridge works.
- Physical Apple devices are not verified by this project.
- Push notifications are not verified end to end.

`apple-artifacts.yml` builds simulator packages when started by hand. It is not part of the tests.
