# Desktop

Target name: `desktop`. The feature matrix splits it into `desktop-linux`, `desktop-windows` and `desktop-macos`.

## Status: tested on Linux; preview on Windows and macOS

The desktop target runs a Solid Multiplatform component app in a native runtime written in Rust that embeds Hermes and draws the scene with WebGL through SDL3. **No Node.js runs the app.** Node is a build tool: it bundles the entry and, by calling the runtime, compiles Hermes bytecode. The executable that opens the window contains the JavaScript engine and the scene renderer; the app's code is the bytecode. The generated entry is `startApp(desktopHost(), App, options)`, and the host supplies router history.

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

## Window chrome

The window's title bar is chosen once, at startup, and cannot change while the app runs (the runtime creates the window before the app's code runs, so it cannot be a `desktopHost()` option):

```json
{
  "desktop": { "titleBar": "custom" }
}
```

- `native` (the default) keeps the window system's decorations. The scene renders no controls and no drag regions.
- `custom` creates a borderless window whose scene draws its own chrome: `<TitleBar>` (with platform minimize/maximize/close), `<WindowDragRegion>` and `<WindowNoDrag>` from `@solid-multiplatform/platform/primitives`.
- `hidden` creates the same borderless window without any automatic chrome; an app that mounts its own `<TitleBar>` gets drag regions and insets all the same.

An explicit flag wins over the packaged setting: `solid-desktop --title-bar=native|custom|hidden app.hbc`, which is what `solid-platform run desktop --title-bar=…` passes; packaging writes the same setting to `resources/app.json`, which the runtime reads before SDL starts; `--diagnostics` prints the mode the next run would ask for, the video driver, and that a running app reports the hit test. In the app, `useHost().chrome` is the `WindowChrome` the design defines (`mode`, `hitTestInstalled`, event-driven `state()`, `minimize`, `toggleMaximized`, `setFullscreen`, `requestClose`, `showSystemMenu`); a mounted `<TitleBar>` publishes its height as `insets.systemBars.top` and `insets.safeArea.top`, so `<Screen>` content moves below it. Render the bar beside `<Screen>`, not inside it, or the inset is counted twice.

How dragging works: the primitives measure their laid-out rectangles and publish them in one batch per layout turn; the runtime converts them to window coordinates with the inverse of the window's scale factor, keeps them in an immutable snapshot, and the SDL hit-test callback only reads that snapshot (no JavaScript, no allocation, no polling). Resize edges (~7 scene units, larger corners) win over the bar's drag rectangle; the deepest region wins after that, with interactive nodes (buttons, fields, links — anything with `onEnter` or `onMouseClick`) claiming their press over a drag region that encloses them. If the borderless window or its hit test is refused before the first frame, the runtime recreates a native window and reports `native`; it never leaves a borderless window without the scene's chrome.

What stays preview or later:

- **Windows**: the hit test maps to `HTCAPTION`/`HT*`, so move, resize, snap and the title-bar double-click stay OS-owned; a snap-layout flyout on a custom maximize button is not provided. Built in CI; no window is opened there, and DWM snap, multi-monitor DPI and RDP are unverified.
- **macOS**: SDL on Cocoa ignores the `RESIZE_*` hit-test results and a borderless window has no traffic lights; real macOS chrome waits for an AppKit phase (`handoff/title-bar-design.md`).
- **Wayland**: `xdg-decoration` lets the compositor decorate a borderless window, so double chrome is possible; the runtime keeps the scene bar and reports the requested mode.
- Tiling window managers may ignore maximize; the controls follow events, never a local guess. Double-click on a drag area to maximize works only where the OS owns it (Windows); elsewhere it is not implemented, and the framework reports nothing it does not do.

## Internationalization

Hermes on Linux has no `Intl`. The runtime supplies it from ICU4X (`packages/host-desktop/native/src/intl.rs`), with the data compiled into the executable, and a thin spec-shaped layer (`packages/host-desktop/src/web/intl.ts`) installs it beside the other web globals. It is defined only when the engine has none, builds no formatter until an app asks for one, and caches instances by their serialized locale and options.

- `Intl.PluralRules`: `select`, `resolvedOptions`.
- `Intl.NumberFormat`: decimal, currency, percent and unit styles, grouping, fraction digits, `formatToParts`.
- `Intl.DateTimeFormat`: date and time styles or individual fields, `formatToParts`, and time zones from the system's IANA database (`TZ` is applied for the call and restored).
- `Intl.RelativeTimeFormat`, `Intl.ListFormat`: `format`, `formatToParts`, `resolvedOptions`.
- `Intl.Collator`: sorting only (`compare`), no options.
- `Intl.getCanonicalLocales`; invalid language tags throw `RangeError`.

`encodings` and `numberingSystem` are the locale's defaults; compact notation, significant digits, non-default hour cycles and `Intl.DisplayNames` are not implemented (the SDK already treats display names as optional). `style: "unit"` appends a short unit symbol from a small table. Every CLDR locale is compiled in, so no data file ships and adding a locale is not a build step. The formatters cost about 2 MB of the executable.

## How it is tested

- `packages/host-desktop/native/tests/run.sh` runs the runtime's own scripts (timers, decodes, errors, fatal start, bytecode) headless, then the two tests that need a window. `SOLID_DESKTOP_HEADLESS_ONLY=1` skips the window tests, which is what the macOS and Windows CI jobs do.
- `packages/host-desktop/tests/run.sh` is the full host suite on Linux: Rust tests, the platform adapter, the web-standard globals, the real scene against Chromium, an app through the host (input, text fields, services, idle, closing), the scene's window chrome (`tests/chrome`: a borderless window whose bar drags and whose edges resize under a real window manager, the fallbacks, the insets, and an idle run), a packaged app moved and run from its archive, accessibility over AT-SPI and the session services.
- `packages/platform/tests/cli/desktop-smoke.sh` packs the platform and the host, generates an app, installs the host, builds bytecode, and runs it under `xvfb-run` with the runtime's `--first-frame-exit`: the runtime prints `first frame presented` and ends, so no window is left open. It skips with one line when `xvfb-run` or a built runtime is absent.
- `packages/platform/tests/cli/projects-smoke.sh` builds the desktop target of the generated app when a runtime is available (build only, no window).
- `.github/workflows/desktop-runtime.yml` builds Hermes, the runtime and the static-SDL release archives on Linux, macOS arm64 and Windows x64. Linux runs the full host suite on a virtual display; macOS and Windows run the headless subset. The tag-triggered `release` job attaches `solid-desktop-linux-x64.tar.gz`, `solid-desktop-darwin-arm64.tar.gz` and `solid-desktop-win32-x64.tar.gz` to the GitHub release.
- `packages/platform/tests/cli/unit/{add-desktop,desktop-target}.test.mjs` test runtime/asset resolution with a faked fetch and filesystem, and the desktop command dispatch.

On Linux the host suite covers the generated entry through `startApp(desktopHost())`: keys and focus (including real X events through xdotool), pointers and the wheel, text fields, the services (`settings`, `lifecycle`, `links`, `request`, `clipboard`, `share`/`haptics` only as absent, `deviceInfo`, `battery`, `memory`, `keepAwake`, `openExternal`, `locale`, `colorScheme`, `keyEvents`, `download`, `filePicker`, `fileSystem`), notifications and connectivity on a test bus, the idle rule, packaging, and the AccessKit tree over AT-SPI. `connectivity` and `notifications` need a stand-in on the test bus; `secureStorage` is not tested because the app must pass a keyring module.

What this does not cover:

- macOS and Windows open no window in CI; drawing, input and the package of an app on those systems are unverified.
- macOS x86_64 (Intel) is not built in CI; only arm64 is. The Rust and C++ are architecture-neutral, but no job proves the Intel build.
- Windows on a hosted runner has no GPU, so the WGL/EGL ES path is only checked by compilation there.
- `system.info().osVersion` is absent on Windows.
- The GitHub release download path in `add desktop none` is unit-tested through a fake fetch, not against the live GitHub API.
- No AppImage is produced.

The feature matrix marks the Linux cells `tested`; the Windows and macOS cells remain `preview`.
