# Android and Android TV

Target names: `android` (phones and tablets), `android-tv`.

## What it is built from

- Backend: the WebGL backend on a native GL surface. The scene is not a WebView.
- Host: a NativeScript app. `nativeHost({ form: 'phone' | 'tv' })` from `hosts/nativescript` is a `HostDefinition`: the generated entry is `startApp(nativeHost(...), App, options)`. The host supplies `keys` through its `KeyBridge` and `text` through the device editor; there is no fake `document`. `runAndroidTV` creates the scene canvas as a **SurfaceView** by default; pass `{ surface: 'texture-view' }` for the old path. Accessibility semantics are absent on native, not stubbed.
- Services: `mobileServices(namespace, extensions)` from `@solid-multiplatform/platform/services/native` returns the providers for the app to install. `androidPermission(name)` is in `@solid-multiplatform/platform/permissions/android`.
- CLI target: `targets/android-tv` or `targets/android`, a NativeScript project. Plugins are Gradle modules: `plugin new <name> --android-kind kotlin|sidecar|service|jni`.

## Build

```sh
corepack pnpm build android-tv
```

This runs `ns build android`. The debug APK is at `targets/android-tv/platforms/android/app/build/outputs/apk/debug/app-debug.apk`. You need JDK 21 and the Android SDK; CI installs `platforms;android-36`, `build-tools;36.0.0`, `ndk;28.2.13676358` and `cmake;3.22.1`. `dev` is not available: install the APK with `adb`.

## Refresh rate and frame pacing

The WebGL renderer draws on every vsync when `targetFPS` is 0 (the default); it caps only when an app sets one. On Android the frame comes from NativeScript core's `requestAnimationFrame` (`animation-frame/index.js`), which forwards to `Choreographer.postFrameCallback` (or the runtime's `__postFrameCallback`, also a `Choreographer` callback). The canvas plugin's own GL loop presents through `AChoreographer_postFrameCallback` in `libcanvasnative.so`. Nothing in the host or the renderer posts at a fixed 16.67 ms, and the loop arms a frame only while something needs one.

What is 60 Hz is the **display mode**. Android keeps a window in the display's default mode until the app asks for another: on a 120 Hz panel the window stays at 60 Hz and every vsync is 16.67 ms. The fix is a request, not a different callback:

- `bindAndroidCanvas` calls `bindDisplayRefreshRate` (`hosts/android-tv/refresh-rate.mjs`), which reads the default display's modes and, when one is above 60 Hz, sets `WindowManager.LayoutParams.preferredRefreshRate`, `Window.setFrameRate(rate, FRAME_RATE_COMPATIBILITY_DEFAULT)` (API 30) and `Surface.setFrameRate` on the canvas SurfaceView. It repeats the request after a display-mode change. A panel whose highest mode is 60 Hz (every Android TV measured) is left alone.
- The `display` service (`src/sdk/display.ts`) reports `getMode().getRefreshRate()` and every supported rate, and notifies through `DisplayManager.DisplayListener`. `preferDisplayRefreshRate(rate | 'highest')` is the same request for apps that need it at runtime.
- The uncapped loop takes its wake-frame nominal from `Platform.framePeriod()` (`AndroidPlatform` returns `1000 / refresh rate`), and follows a mode switch through `Platform.onFramePeriodChange`; frame deltas after that are the real vsync deltas, so an uncapped 120 Hz scene steps 8.33 ms. Idle is unchanged: no animation frame is requested, and the only timer is the one-shot idle maintenance timer.

Measured on an API 36 phone emulator (`viptv-design-phone`, headless, SwiftShader), one 5 s linear animation and 3 s of idle, frame timestamps taken by wrapping the global `requestAnimationFrame` the loop calls:

| Guest vsync | Frames in 5 s | p50 delta | min / max        | Idle frames |
| ----------- | ------------- | --------- | ---------------- | ----------- |
| 60 Hz       | 301           | 16.67 ms  | 16.67 / 16.67 ms | 0           |
| 120 Hz      | 571           | 8.33 ms   | 8.33 / 16.67 ms  | 0           |

The 120 Hz row used the emulator's `-vsync-rate 120`, which makes the guest display report and run at 120 Hz (`presDeadline 8333333`). The emulator exposes a single display mode, so a real 60 → 120 mode switch on a multi-mode panel was not reproduced here; the request path is covered by the service and loop unit tests.

## How it is tested

- `android` job (`android.yml`): `tests/cli/android-smoke.sh` creates an `android-tv` app with `init`, adds the video package and one plugin of each Android kind, builds it twice, and inspects the APK: the plugin metadata, the video layout resource, and JNI and sidecar libraries for three ABIs. CI passes no emulator serial, so the script stops there. The app is not launched in CI.
- The same script, given an emulator serial, installs the APK, starts it and checks the results of the Kotlin, JNI, service and sidecar plugins and of native playback with captions. That part runs only when you run it yourself.
- `android-services` job (`android.yml`): runs `node tests/native-device/android-probe.mjs verify --form phone` on an API 35 emulator. It is `continue-on-error`, so it does not fail the workflow yet.
- `unit` job: `tests/native/*.test.mjs` test the host's GL context options, key mapping, scaling, rotation and HTTP buffering in Node with fakes. `tests/host/native-host.test.ts` checks that `nativeHost` forwards an established history and creates one when the bootstrap supplies none.
- Router history is supplied by the host and kept in memory; an unhandled Back goes one entry back before it leaves the app.

No test builds the `android` (phone) target. No CI job draws a scene on Android.

## Device procedures

`node packages/platform/tests/native-device/android-probe.mjs verify --serial <emulator> --form phone|tv` installs the probe app, runs every default service, checks each from outside the app with `adb`, restores what it changed and removes the probe. The runs recorded on 2026-11-18 used an API 36 phone emulator and an API 36 TV emulator: 35 rows each, none failed, twice. Their JSON and text tables are under `handoff/android-device/` and are the evidence for the `device` cells in the [feature matrix](/features.md). The same directory holds screenshots of a freshly generated starter on both emulators, with its button counting three presses.

`packages/platform/tests/performance` holds the Android TV frame-timing procedure. It needs a physical TV and is described in [Performance](/performance.md). `node packages/platform/tests/cli/android-tv-device-check.mjs` reads a device's model and focus state when `ANDROID_SERIAL` is set.

## Not verified

- `keyEvents` on Android TV: the ArrowDown shortcut did not fire on the TV emulator. It stays `preview`, and so does `keyEvents` on the phone.
- `camera`, `filePicker` and `biometrics` are written but not device-verified. `request` has no provider because the runtime's `fetch` has no time bound.
- Accessibility semantics are absent on Android and Android TV; `AccessibilityNodeProvider` is not implemented.
- The Android TV frame gate is **not met in the strict sense**. The lost-frame defect is fixed: with the SurfaceView default, three 10-minute mixed passes on a physical TV rendered no frame the compositor failed to latch. A few late latches (6, 6 and 1 two-refresh intervals, clustered at trace start or just after the gallery transition) remain, and the canvas plugin's native frame callback still wakes the main thread 60 times a second while the scene is idle. See [Performance](/performance.md).
