# Android TV native extensions

This fixture uses an app-owned Kotlin command to run a bundled native executable while Solid continues rendering on the UI thread. It runs once at startup and returns 256 bytes of offscreen RGBA pixels to TypeScript. The shared UI is the same fixture the other hosts mount.

## Follow one call

1. [The Android entry](app/app.ts) starts the shared UI, calls `renderNativePreview()`, and cancels the request on suspend or disposal.
2. [The TypeScript binding](app/preview.android.ts) exposes a promise and a cancel method. NativeScript binds the Kotlin class in the app's namespace directly.
3. [PreviewCommand.kt](App_Resources/Android/src/main/java/dev/solidmultiplatform/fixture/PreviewCommand.kt) starts the app's fixed executable with `ProcessBuilder` on a worker thread. It reads a bounded frame from the pipe, enforces a deadline and delivers the result on Android's main thread. Each request owns its process.
4. [The executable](native/preview.c) produces a deterministic 8 × 8 checkerboard. [Gradle](App_Resources/Android/app.gradle) builds position-independent Android executables for ARMv7, ARM64 and x86-64. The APK stores each under its ABI's native-library directory as `libsolid_preview.so`. Kotlin launches the installed copy from `applicationInfo.nativeLibraryDir`. The build requests legacy JNI packaging so Android extracts a file the OS can launch. This increases installed disk usage. [Android executable-code restrictions](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)

To add an app command, put its Kotlin implementation in the app's Android source tree and expose the operation through a typed Android binding. Pass that binding to shared components that use it. The example's Base64 encoding makes the tiny test frame inspectable in logs. For continuous rendering, keep frames in native buffers and pass control messages or surface handles over the bridge.

A native region would have its own Android view in the host layout. Kotlin would own the surface lifetime and its position relative to the main canvas. An NDK renderer can acquire the surface as an `ANativeWindow` and release it on teardown. That integration is reserved for a future renderer. Work that must continue once the user leaves the application has a different Android lifecycle and needs its own service design. [Android SurfaceView](https://developer.android.com/reference/android/view/SurfaceView) · [NDK native windows](https://developer.android.com/ndk/reference/group/a-native-window) · [Android foreground services](https://developer.android.com/develop/background-work/services/fgs)

## Build and verify

Build the framework first, then install this project's dependencies with `corepack pnpm install --frozen-lockfile`. The Android build uses JDK 21, SDK 36 and NDK 28.2.13676358. Run `corepack pnpm build` to produce the debug APK.

Install the APK on a test emulator, launch `dev.solidmultiplatform.fixture`, and run `python3 scripts/check-preview.py EMULATOR_SERIAL`. The check compares every returned byte to the expected RGBA frame.
