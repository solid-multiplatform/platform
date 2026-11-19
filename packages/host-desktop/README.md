# @solid-multiplatform/host-desktop

The desktop target of [Solid Multiplatform](https://github.com/solid-multiplatform/platform): a host definition for the platform package and, in `native/`, the native runtime it runs on. The runtime is one executable per platform — the Hermes JavaScript engine, an SDL3 window and an OpenGL ES surface for the scene. There is no Node.js and no browser in it; Node is a build tool only.

The scene is drawn by the WebGL backend of [`@solid-multiplatform/renderer`](../renderer), unchanged, inside Hermes. `src/` is the host: `startApp(desktopHost(), App, options)` from `@solid-multiplatform/platform/host` starts an app, and the module installs the web-standard globals the engine lacks (`URL`, `TextDecoder`, `fetch`, and `Intl` from ICU4X on Linux). `cli/` bundles an entry module and compiles it to Hermes bytecode; `cli/index.mjs` exports `doctorDesktop`, `buildDesktop`, `runDesktop` and `packageDesktop` for the `solid-platform` CLI.

## Install it into an app

```sh
node packages/platform/cli/main.mjs init ../my-app --targets desktop   # from a checkout
cd ../my-app
corepack pnpm platform add desktop <release.tgz>   # or an https:// URL
corepack pnpm install
corepack pnpm build desktop
corepack pnpm platform run desktop
```

`add desktop` installs this package from a release archive and fetches the native runtime (`solid-desktop-<platform>-<arch>.tar.gz`) from the GitHub release into the package's `prebuilt/<platform>-<arch>/`; `add desktop none` fetches the runtime only, into a host package that is already installed. `SOLID_DESKTOP_RUNTIME` names a runtime directly and wins over both.

## Build the runtime from source

Needs Rust, a C++17 compiler, CMake and Ninja, and either SDL3 development files or `--features static-sdl` (which compiles the SDL3 release bundled with the `sdl3-sys` crate). macOS and Windows always need `--features static-sdl`.

From `native/`:

```sh
git clone --depth 1 --branch static_h https://github.com/facebook/hermes
cmake -S hermes -B hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DHERMES_ENABLE_INTL=OFF
ninja -C hermes-build hermesvm hermesNapi

HERMES_SRC=$PWD/hermes HERMES_BUILD=$PWD/hermes-build cargo build --release
bash tests/run.sh          # the runtime's own scripts
```

The full host suite is `bash tests/run.sh` in the package above it; it needs a built runtime. `build.rs` compiles the glue with the flags of a default Release configuration of Hermes; a differently configured Hermes needs them changed there. The runtime's flags: `solid-desktop app.js` (source or bytecode, `--script` for arguments, `--headless`, `--compile`, `--first-frame-exit`, `--version`, `--diagnostics`).

## Platforms and size

|                                             | Linux x64            | macOS arm64                              | Windows x64                              |
| ------------------------------------------- | -------------------- | ---------------------------------------- | ---------------------------------------- |
| Tested                                      | fully, with a window | headless tests in CI; drawing is preview | headless tests in CI; drawing is preview |
| Accessibility                               | AT-SPI over D-Bus    | absent                                   | absent                                   |
| Notifications, connectivity, secure storage | D-Bus services       | absent                                   | absent                                   |

The executable is about 10.6 MB stripped on Linux x64 (13.3 MB with SDL linked in), and presents the fixture's first frame 61 ms after start from bytecode. The loop blocks while idle: no timers, no polling, and nothing scheduled while a scene is settled.

Known limits: a window on macOS needs an EGL implementation (ANGLE) named by `SDL_VIDEO_EGL_DRIVER`; gamepads are not delivered; HTTP response bodies are buffered whole, with no streams, and HTTPS trusts Mozilla's roots compiled in, not the system's store; packaging an app (not the runtime) for macOS and Windows is not implemented.

The runtime's design, measurements and internal layout are in [native/README.md](native/README.md); how the target is built and tested is in [docs/targets/desktop.md](../../docs/targets/desktop.md).
