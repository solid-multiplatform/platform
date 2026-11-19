# Desktop runtime

One executable for Linux, Windows and macOS: the Hermes JavaScript engine, an SDL3 window and a GL surface for the scene. There is no Node.js and no browser in it.

It runs an app: `solid-desktop app.js` opens a window and draws a Solid scene with the WebGL backend of `@solid-multiplatform/renderer`, unchanged, inside Hermes. Linux is the only system it has been built and tested on.

## What it does

| Question                       | Result                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a Rust host embed Hermes?  | Yes. Hermes (branch `static_h`) links statically; the only C++ is about 100 lines that create the VM and call two entry points Hermes declares in C++. Everything else goes through Hermes' own Node-API implementation, which is plain C.                                                                                                                                                     |
| Does the renderer run in it?   | Yes, as written. The context is OpenGL ES 3 on every system, so the renderer's WebGL 1 shaders compile without rewriting. The shared fixture (panel, boxes, MSDF text) matches Chromium's WebGL at every probed pixel; text cells differ by at most one level out of 255.                                                                                                                      |
| Size                           | 10.6 MB stripped on Linux x64, with the JavaScript compiler, the PNG, JPEG and WebP decoders, the HTTPS client (rustls, about 1.9 MB of it), and accessibility, notifications and connectivity (3.1 MB together, most of it the D-Bus client they share); 7.5 MB without those three (`--no-default-features`). SDL3 is a shared library in these; linked in it adds 2.6 MB ("Packaged apps"). |
| Start-up                       | From bytecode the fixture's first frame is presented 61 ms after `main()` starts, from source 130 ms: compiling 650 KB of JavaScript takes about 70 ms, minified or not. 49 ms of either is the window and a software GL context on the test display; without a window it is 2 ms.                                                                                                             |
| Idle behaviour                 | The loop blocks until the system, a timer or a worker has something for it. Two seconds of the settled fixture: 1 wakeup (the timer that ended the test), 0 frames, 0 presents. See "Idle" below for the one wake SDL itself adds.                                                                                                                                                             |
| A frame                        | Redrawing the fixture costs 0.07 ms of JavaScript and GL calls. A call through the binding costs about 45 ns.                                                                                                                                                                                                                                                                                  |
| Language level                 | Classes with private fields, promises, async functions and `WeakRef` run as written. `Intl` is absent; `URL`, `TextDecoder`, `fetch` and the like are supplied by the host package (`../src/web`).                                                                                                                                                                                             |
| Is an interpreter fast enough? | On a stand-in for per-frame scene work (transform update and quad batching), Hermes takes 0.26 ms for 2,000 nodes and 1.06 ms for 8,000. V8 with its JIT takes 0.02 and 0.08 ms; V8 without a JIT, which is what iOS and tvOS run, takes 0.41 and 1.63 ms.                                                                                                                                     |

The numbers are from `tests/measure.mjs` in the package above, on a virtual display with Mesa's software rasterizer.

Node-API matters beyond the host's own functions: Hermes can load Node-API addons (`hermes_napi_load_module`), so a native plugin for the desktop target is an ordinary Node-API library in any language, without Node.

## Build

Needs Rust, a C++17 compiler, CMake, Ninja and SDL3 development files.

```sh
git clone --depth 1 --branch static_h https://github.com/facebook/hermes
cmake -S hermes -B hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DHERMES_ENABLE_INTL=OFF
ninja -C hermes-build hermesvm hermesNapi

HERMES_SRC=$PWD/hermes HERMES_BUILD=$PWD/hermes-build cargo build --release
bash tests/run.sh
```

`build.rs` compiles the glue, and Hermes' one-file bytecode compiler entry point, with the flags of a default Release configuration of Hermes; they decide the layout of VM classes, so a differently configured Hermes needs them changed there.

## Run

```sh
solid-desktop app.js              # source, or bytecode: it tells by the file
solid-desktop --script app.js myapp://open/7   # the same, with the app's arguments
solid-desktop --headless job.js   # no window, no GL
solid-desktop --first-frame-exit app.hbc  # prints that a frame was presented, then ends
solid-desktop --compile app.js app.hbc
solid-desktop --version
solid-desktop --diagnostics       # the SDL in it, linked how, with which video drivers
```

An app is one script. `../cli/bundle.mjs` makes it from an entry module (Node and esbuild at build time only) and, with `--bytecode`, compiles it with this executable. Assets are files next to the script: a relative path an app loads (`fonts/a.png`) is read from the script's directory, wherever that is. `../src` is the module the entry imports: the renderer's platform adapter over what this runtime provides.

What follows the script on the command line is the app's (`__solid.args`); the `links` service gives an app the first of them that is a URL.

## Packaged apps

Without a script named, the runtime runs `../resources/app.hbc` (or `app.js`) beside the directory its own executable is in, found through the system with links followed. That is the layout `../cli/package.mjs` writes (`packageDesktop()` in `../cli/index.mjs`):

```
<name>/bin/<name>           this executable
<name>/resources/app.hbc    the app, with its assets beside it
<name>/<appId>.desktop      the launcher entry (Exec=<name> %U, the URL scheme)
<name>/<appId>.png          the icon
<name>/README.txt           how to install it and what it needs
<name>-<version>-linux-x64.tar.gz
```

The directory runs from wherever it is put: nothing in it names a path, and the bytecode records the script as `app.js`. No AppImage is made: that needs `appimagetool` or `mksquashfs` and an AppImage runtime, which would have to be downloaded at build time.

`cargo build --release --features static-sdl` compiles SDL from source (the `sdl3-src` crate, with CMake) into the executable, with the X11 and Wayland drivers and without the parts nothing here calls: 13.3 MB stripped instead of 10.6 MB (10.2 instead of 7.5 without the default features), and nothing of SDL to install where the app runs. CI builds this one, runs a package of it and keeps it as the prebuilt runtime. SDL then opens the system's libX11, libwayland and libEGL when it starts, as the shared library does. Without the feature a package's `README.txt` lists SDL 3 as a requirement.

`../cli/index.mjs` exports `doctorDesktop`, `buildDesktop`, `runDesktop` and `packageDesktop` for the platform's CLI. They find the runtime through `SOLID_DESKTOP_RUNTIME`, then `../prebuilt/<platform>-<arch>/solid-desktop` (CI's artifact), then a build from source when `HERMES_SRC`, `HERMES_BUILD` and cargo are there; so an app developer with a prebuilt runtime needs no compiler.

A script that throws while it starts ends the process with status 1. Later errors (in a timer, a frame, a callback, or a promise rejection nothing handled) are written to standard error with their stack and the loop goes on.

## What JavaScript gets

- `setTimeout`, `setInterval` and their `clear` functions, `requestAnimationFrame`, `cancelAnimationFrame`, `queueMicrotask`, `performance.now`, `console` (`log`, `info`, `debug`, `warn`, `error`) and `print`. Timers set during a turn of the loop run in a later turn, so a chain of zero-delay timers cannot keep the loop from input and frames.
- `__solid.gl`: a WebGL-shaped context. What is bound, and what throws by name because it is not, is the table in `src/gl/table.rs`.
- `__solid.input.listen`: every event of a turn of the loop in one call (keys, text and composition, mouse, touch, pen, wheel, focus, resize and scale, close, theme, locale, drops). The events and the merging of moves are described in `src/input.rs`; the key names and codes in `src/keys.rs`.
- `__solid.text`: the system's text input and input method (`start`, `stop`, `area`), and where user-perceived characters begin (`graphemes`).
- `__solid.window`: its size in layout units and pixels with the display's scale, `setSize`, `setTitle`, its state, the system theme, and the screen saver. `__solid.clipboard`: `read` and `write`.
- `__solid.system`: the machine (`info`, `power`, `locales`) and `openURL`. `__solid.store` and `__solid.fs`: an app's settings file and its own directories, confined (`src/storage.rs`). `__solid.dialog`: the system's file dialogs. `__solid.http`: HTTP(S) requests on worker threads (`src/http.rs`).
- `__solid.readFile`, `readText` and `decodeImage`: files and images, read and decoded on worker threads.
- `__solid.a11y`: the scene's semantics for assistive technology (see "Accessibility").
- `__solid.notifications`: the desktop's notification service on the session bus (`org.freedesktop.Notifications`): `available()` asks the bus whether anything provides it, which the host does once as it starts so that `notifications` is absent where nothing does; `show` makes the call on a worker thread. Titles and bodies only: what the user does with a notification is not reported, because nothing listens on the bus. The `notifications` cargo feature, on by default, Linux only; 0.3 MB beside accessibility, whose D-Bus client it shares.
- `__solid.network`: NetworkManager on the system bus: `available()` (is it running: asked once as the host starts, so that `connectivity` is absent where it is not), `state()` and `watch(callback)`. `watch` starts one thread that sleeps on the bus until NetworkManager's `StateChanged` signal; nothing asks again. Online means NetworkManager's "connected, internet reachable" (state 70). The `connectivity` cargo feature, on by default, Linux only; 0.2 MB.
- `__solid.appDir`, `args`, `exit` and `stats` (the loop's counters, for tests). With `SOLID_DESKTOP_TEST` set, `__solid.test` puts made-up input on SDL's queue (`src/testing.rs`).

`__solid` is the host module's interface, not an app's: apps use the platform's APIs, which `../src` implements over it (`desktopHost()`, the services, and the web-standard globals Hermes lacks).

## Input, scale and the screen saver

Input is event-driven: SDL's events are gathered while the loop drains them and reach JavaScript in one call per turn; a turn without events calls nothing. Sizes and pointer positions are in layout units, of which `scale` (the display's scale) make a pixel; the window asks for a high-density drawing buffer.

SDL turns the screen saver off for any program with a window. The runtime sets `SDL_HINT_VIDEO_ALLOW_SCREENSAVER` so that it stays allowed until an app asks otherwise (`keepAwake`).

Gamepads are not delivered. Nothing initialises SDL's joystick subsystem, and `SDL_HINT_AUTO_UPDATE_JOYSTICKS` and `SDL_HINT_AUTO_UPDATE_SENSORS` are set to 0 so that SDL never polls for them from its event wait (with a joystick open it would wake every few milliseconds).

## Accessibility

On Linux the runtime tells assistive technology (a screen reader, a switch device) what the scene means, through AccessKit's AT-SPI adapter over D-Bus. The host's semantics sink (`../src/semantics.ts`; `context.semantics` of `launchDesktop`) numbers the nodes an app registers and hands their fields to `__solid.a11y`: role, label, description, value, bounds, the checked, selected, expanded and disabled states, a heading's level, a range's minimum, maximum and value, and which of `focus` and `activate` the node has. The window is the root; a node hangs from the parent it was registered under.

- Nothing starts until an app registers a node: then the adapter's thread connects to the session bus and waits there for accessibility to be switched on. It does not poll, and with no session bus it ends.
- No tree is built until assistive technology is running. From then on a turn's changes go out as one update, in a microtask; a turn without changes sends nothing.
- What the technology asks of a node (focus it, do its default action) is delivered to the app's `focus()` and `activate()` on the JavaScript thread. A disabled node offers neither.
- The window's position, size and keyboard focus are passed on from the system's events. Under Wayland a window cannot know where it is, so screen coordinates are relative to it there.

A node's `bounds()` is read when it is registered or updated: a node that moves without either (a scroll, an animation) keeps its old place until its owner updates it. Windows and macOS have no adapter yet, and `context.semantics` is absent there, as it is in a run without a window.

It is the `accessibility` cargo feature, on by default; it adds 2.6 MB, most of it the D-Bus client. `tests/a11y/run.mjs` in the package above is its test: it plays the assistive technology on a session bus of its own, reads the tree from the accessibility bus and asks for actions.

## Idle

Nothing in the runtime polls. The loop waits in `SDL_WaitEvent`, with a timeout only while a timer or a paced frame is due; worker threads wait on their queue; a finished job wakes the loop with an SDL event. A run without a window uses no SDL at all and waits on a condition variable, because SDL's wait polls every millisecond when it has no window to wait on.

One wake remains that is not the runtime's: an SDL built with D-Bus support, as distributions build it, returns from its wait every three seconds to pump D-Bus (`DBUS_POLL_INTERVAL_NS` in SDL's `SDL_events.c`). It runs no JavaScript and does not reach the loop's counters, but the process does wake. It goes away with a statically linked SDL built without D-Bus, or when SDL waits on the D-Bus socket instead.

Frames are paced by the buffer swap when it waits for the display, and by the clock otherwise (a frame that drew nothing, a driver without vertical sync), so a chain of animation frames never spins.

## Layout

- `src/glue.cpp`: creates the Hermes VM, runs source or bytecode, compiles, drains promise jobs.
- `src/napi.rs`: the Node-API functions the host uses.
- `src/runtime.rs`: the event loop, timers and animation frames.
- `src/input.rs`, `src/keys.rs`, `src/window.rs`: input, key names, the window and clipboard.
- `src/system.rs`, `src/storage.rs`, `src/dialog.rs`, `src/http.rs`: what the services are made of.
- `src/a11y.rs`: the scene's semantics for assistive technology.
- `src/notify.rs`, `src/network.rs`: notifications; connectivity.
- `src/testing.rs`: made-up input for tests.
- `src/worker.rs`: the thread pools for work that must not run on the JavaScript thread (decodes; files; requests). Every thread blocks until it has work.
- `src/gl/`: the GL context and binding. `table.rs` is the binding as one table, `bind.rs` the macro that generates code from it, `calls.rs` the calls that need more than argument conversion.
- `src/images.rs`, `src/files.rs`: image decoding and file reading.
- `src/console.rs`, `src/prelude.js`: output, `console`, and the report of unhandled rejections.
- `tests/`: scripts the runtime runs to test itself. The tests of a real scene are in the package above (`../tests`).

## Not done yet

`Intl` (Hermes has no backend for it on Linux at this commit; one over ICU4X is measured but not wired in), gamepads, secure storage, notifications' actions, notifications and connectivity on Windows and macOS (and connectivity on a Linux without NetworkManager), tray and menus, accessibility on Windows and macOS, losing and recreating the GL context (`renderer.destroy()` leaves its GL objects until the process exits), an AppImage, packaging for Windows and macOS and builds for them, handing a link to an instance that is already running. HTTPS trusts Mozilla's roots compiled in, not the system's store. Response bodies are buffered whole; there are no streams.
