# Desktop

Target name: `desktop`. The feature matrix splits it into `desktop-linux`, `desktop-windows` and `desktop-macos`.

## Status: preview

The desktop target runs a Solid Multiplatform component app in a native runtime written in Rust that embeds Hermes and draws the scene with WebGL through SDL3. **No Node.js runs the app.** Node is a build tool: it bundles the entry and, by calling the runtime, compiles Hermes bytecode. The executable that opens the window contains the JavaScript engine and the scene renderer; the app's code is the bytecode.

Linux is the only system verified end to end, with a window and the real scene. macOS arm64 and Windows x64 (MSVC) build and run the runtime's headless tests in CI (`.github/workflows/desktop-runtime.yml`, jobs `macos` and `windows`). No CI job opens a window on those systems, so drawing there is `preview`.

## Platforms

|                           | Linux x64                                              | macOS arm64                                            | Windows x64                                                           |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Build                     | `cargo build --release --locked` (SDL from the system) | `--features static-sdl`: SDL built from source (Cocoa) | `--features static-sdl`: SDL built from source (Win32, WGL, D3D, EGL) |
| Window and scene          | tested in the host suite                               | needs an OpenGL ES driver (below)                      | needs an OpenGL ES driver (below)                                     |
| Headless (`--headless`)   | tested                                                 | tested in CI                                           | tested in CI                                                          |
| Accessibility (AccessKit) | AT-SPI over D-Bus                                      | not implemented (`__solid.a11y` absent)                | not implemented (`__solid.a11y` absent)                               |
| Notifications             | D-Bus `org.freedesktop.Notifications`                  | not implemented (service absent)                       | not implemented (service absent)                                      |
| Connectivity              | NetworkManager over D-Bus                              | not implemented (service absent)                       | not implemented (service absent)                                      |
| `system.info().osVersion` | distribution and kernel                                | `SystemVersion.plist`                                  | absent (no Windows version API is linked)                             |

The scene's GL surface is OpenGL ES 3 on every system, so the WebGL shaders compile as written. macOS has no OpenGL ES implementation of its own: SDL's Cocoa backend reaches ES through EGL, which macOS does not ship. A window therefore needs an EGL implementation SDL can load (ANGLE), pointed at with `SDL_VIDEO_EGL_DRIVER`; without one the runtime exits with a message saying so, and `--headless` works. On Windows, SDL uses the driver's EGL implementation if one is installed, and otherwise the WGL ES profile (`WGL_EXT_create_context_es2_profile`), which many drivers offer; this is not verified on a hosted runner, which has no GPU.

macOS binaries are ad-hoc signed by the linker; no developer certificate is involved. Windows builds use the console subsystem, so a packaged app shows a console window when started; this is not hidden yet.

## Add it to an app

```sh
solid-platform init my-app --targets desktop
cd my-app
solid-platform add desktop <solid-multiplatform-host-desktop-<version>.tgz>
corepack pnpm install
corepack pnpm build desktop
corepack pnpm platform run desktop
```

`add desktop` installs `@solid-multiplatform/host-desktop` from a release archive (a local `.tgz` or an `https://` URL) and writes a `file:` dependency into `package.json`, as `add video` does.

With no archive it fetches only the runtime: `solid-platform add desktop none` downloads `solid-desktop-<platform>-<arch>.tar.gz` from the latest GitHub release and puts `solid-desktop` (or `solid-desktop.exe` on Windows) at `node_modules/@solid-multiplatform/host-desktop/prebuilt/<platform>-<arch>/`, where the host's CLI looks for it. `SOLID_DESKTOP_RUNTIME` takes precedence over everything and is used as given.

The `<platform>-<arch>` is Node's name for the system, which is also the release asset's: `linux-x64`, `darwin-arm64`, `win32-x64`. The archive holds the executable at its root. It is a `.tar.gz` on every platform; Windows 10 (1803 and later) ships the `tar.exe` that `add desktop none` uses.

The build tool for the target is the desktop host's own CLI (`@solid-multiplatform/host-desktop/cli`). It bundles `src/app.tsx` through the Solid universal renderer and the WebGL backend, then compiles the result to `targets/desktop/work/bundle/app.hbc`.

## Commands

- `solid-platform build desktop` writes `targets/desktop/work/bundle/app.hbc` and copies the app's fonts beside it.
- `solid-platform run desktop` builds, then starts the app in the runtime.
- `solid-platform dev desktop` builds and opens the app.
- `solid-platform package desktop` makes a relocatable Linux directory and `.tar.gz`: the runtime as `bin/<name>`, the bytecode and assets under `resources/`, and a `.desktop` launcher entry. Packaging an app for macOS or Windows is not implemented; the runtime itself is released for all three.
- `solid-platform plugins run desktop` bundles the plugin fixture and runs it **headless** in the runtime; it opens no window.
- `solid-platform add desktop …` installs the host and its runtime (above).

The runtime binary resolves as: `SOLID_DESKTOP_RUNTIME`, then the host package's `prebuilt/<platform>-<arch>/solid-desktop[.exe]`, then a source build when `HERMES_SRC`, `HERMES_BUILD` and `cargo` are available. That fallback adds `--features static-sdl` on macOS and Windows, so SDL is compiled from the crate's bundled source; a manual `cargo build` there needs the same feature or an SDL3 installation the `sdl3-sys` crate can find.

Screen variants ending in `.linux`, `.windows`, `.macos` or `.desktop` are selected by the OS the build runs on.

## How it is tested

- `packages/host-desktop/native/tests/run.sh` runs the runtime's own scripts (timers, decodes, errors, fatal start, bytecode) headless, then the two tests that need a window. `SOLID_DESKTOP_HEADLESS_ONLY=1` skips the window tests, which is what the macOS and Windows CI jobs do.
- `packages/host-desktop/tests/run.sh` is the full host suite on Linux: Rust tests, the platform adapter, the web-standard globals, the real scene against Chromium, an app through the host (input, text fields, services, idle, closing), a packaged app moved and run from its archive, accessibility over AT-SPI and the session services.
- `packages/platform/tests/cli/desktop-smoke.sh` packs the platform and the host, generates an app, installs the host, builds bytecode, and runs it under `xvfb-run` with the runtime's `--first-frame-exit`: the runtime prints `first frame presented` and ends, so no window is left open. It skips with one line when `xvfb-run` or a built runtime is absent.
- `packages/platform/tests/cli/projects-smoke.sh` builds the desktop target of the generated app when a runtime is available (build only, no window).
- `.github/workflows/desktop-runtime.yml` builds Hermes, the runtime and the static-SDL release archives on Linux, macOS arm64 and Windows x64. Linux runs the full host suite on a virtual display; macOS and Windows run the headless subset. The tag-triggered `release` job attaches `solid-desktop-linux-x64.tar.gz`, `solid-desktop-darwin-arm64.tar.gz` and `solid-desktop-win32-x64.tar.gz` to the GitHub release.
- `packages/platform/tests/cli/unit/{add-desktop,desktop-target}.test.mjs` test runtime/asset resolution with a faked fetch and filesystem, and the desktop command dispatch.

What this does not cover:

- macOS and Windows open no window in CI; drawing, input and the package of an app on those systems are unverified.
- macOS x86_64 (Intel) is not built in CI; only arm64 is. The Rust and C++ are architecture-neutral, but no job proves the Intel build.
- Windows on a hosted runner has no GPU, so the WGL/EGL ES path is only checked by compilation there.
- `system.info().osVersion` is absent on Windows.
- The GitHub release download path in `add desktop none` is unit-tested through a fake fetch, not against the live GitHub API.
- No AppImage is produced.

Treat desktop as `preview`; the feature matrix splits it by OS.
