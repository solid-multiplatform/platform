# iOS and tvOS

Target names: `ios`, `apple-tv`.

## What it is built from

- Backend: the WebGL backend on a native canvas surface.
- Host: a NativeScript app. `nativeHost({ form: 'ios' | 'tvOS' })` from `hosts/nativescript` is a `HostDefinition`: the generated entry is `startApp(nativeHost(...), App, options)`. The host supplies `keys` and `text`; there is no fake `document`. Router history is kept in memory by the host. Accessibility semantics are absent on native, not stubbed.
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
- The same build is launched a second time with a services probe. It checks every installed service through the registry and fails on a service that does not work: 22 passed on iOS and 14 on tvOS. `simctl openurl` delivery and, on tvOS, a live colour-scheme change are reported as warnings and stay unverified.
- `unit` job: `tests/apple-providers.test.mjs` and `tests/apple-signing.test.mjs`, in Node with fakes. `tests/host/native-host.test.ts` checks that `nativeHost` forwards an established history and creates one when the bootstrap supplies none.

The feature matrix marks these simulator checks `tested`: they are CI runs on the target. `device` is reserved for recorded runs outside CI, whose evidence is kept under `handoff/`; there are no Apple runs of that kind.

What this does not cover:

- No test checks what the scene draws in the simulator. The launch test proves the app starts and the plugin bridge works; the services probe checks the services, not the picture.
- Physical Apple devices are not verified by this project.
- Accessibility semantics are absent on iOS and tvOS; `UIAccessibility` is not implemented.
- Push notifications are not verified end to end.

`apple-artifacts.yml` builds simulator packages when started by hand. It is not part of the tests.
