# Android and Android TV

Target names: `android` (phones and tablets), `android-tv`.

## What it is built from

- Backend: the WebGL backend on a native GL surface. The scene is not a WebView.
- Host: a NativeScript app. `runAndroidTV(loadApp, { surface })` from `@solid-multiplatform/platform/android-tv` and `runAndroid(loadApp)` from `@solid-multiplatform/platform/android` create the surface, bind input and the device lifecycle, and call the `mount` of the module your loader returns. Pass `{ surface: 'surface-view' }` to `runAndroidTV` for a dedicated SurfaceView; the default is a TextureView. These hosts do not implement `HostDefinition` yet.
- Services: `mobileServices(namespace, extensions)` from `@solid-multiplatform/platform/services/native` returns the providers for the app to install. `androidPermission(name)` is in `@solid-multiplatform/platform/permissions/android`.
- CLI target: `targets/android-tv` or `targets/android`, a NativeScript project. Plugins are Gradle modules: `plugin new <name> --android-kind kotlin|sidecar|service|jni`.

## Build

```sh
corepack pnpm build android-tv
```

This runs `ns build android`. The debug APK is at `targets/android-tv/platforms/android/app/build/outputs/apk/debug/app-debug.apk`. You need JDK 21 and the Android SDK; CI installs `platforms;android-36`, `build-tools;36.0.0`, `ndk;28.2.13676358` and `cmake;3.22.1`. `dev` is not available: install the APK with `adb`.

## How it is tested

- `android` job (`android.yml`): `tests/cli/android-smoke.sh` creates an `android-tv` app with `init`, adds the video package and one plugin of each Android kind, builds it twice, and inspects the APK: the plugin metadata, the video layout resource, and JNI and sidecar libraries for three ABIs. CI passes no emulator serial, so the script stops there. The app is not launched in CI.
- The same script, given an emulator serial, installs the APK, starts it and checks the results of the Kotlin, JNI, service and sidecar plugins and of native playback with captions. That part runs only when you run it yourself.
- `unit` job: `tests/native/*.test.mjs` test the host's GL context options, key mapping, scaling, rotation and HTTP buffering in Node with fakes.

No test builds the `android` (phone) target. No CI job draws a scene on Android.

## Device procedures

`packages/platform/tests/performance` holds the Android TV frame-timing procedure. It needs a physical TV and is described in [Performance](/performance.md). `node packages/platform/tests/cli/android-tv-device-check.mjs` reads a device's model and focus state when `ANDROID_SERIAL` is set.

## In progress

Native Android service providers are in an open pull request. Until it merges, most services on Android are `preview` or `unavailable`; see the [feature matrix](/features.md).
