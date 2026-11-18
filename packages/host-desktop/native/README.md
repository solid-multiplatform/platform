# Desktop runtime

One executable for Linux, Windows and macOS: the Hermes JavaScript engine, an SDL3 window and a GL surface for the scene. There is no Node.js and no browser in it.

It runs an app: `solid-desktop app.js` opens a window and draws a Solid scene with the WebGL backend of `@solid-multiplatform/renderer`, unchanged, inside Hermes. Linux is the only system it has been built and tested on, and it does not take input yet.

## What it does

| Question                       | Result                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a Rust host embed Hermes?  | Yes. Hermes (branch `static_h`) links statically; the only C++ is about 100 lines that create the VM and call two entry points Hermes declares in C++. Everything else goes through Hermes' own Node-API implementation, which is plain C.                                         |
| Does the renderer run in it?   | Yes, as written. The context is OpenGL ES 3 on every system, so the renderer's WebGL 1 shaders compile without rewriting. The shared fixture (panel, boxes, MSDF text) matches Chromium's WebGL at every probed pixel; text cells differ by at most one level out of 255.          |
| Size                           | 5.2 MB stripped on Linux x64, with the JavaScript compiler and the PNG, JPEG and WebP decoders. SDL3 is still linked dynamically here.                                                                                                                                             |
| Start-up                       | From bytecode the fixture's first frame is presented 61 ms after `main()` starts, from source 130 ms: compiling 650 KB of JavaScript takes about 70 ms, minified or not. 49 ms of either is the window and a software GL context on the test display; without a window it is 2 ms. |
| Idle behaviour                 | The loop blocks until the system, a timer or a worker has something for it. Two seconds of the settled fixture: 1 wakeup (the timer that ended the test), 0 frames, 0 presents. See "Idle" below for the one wake SDL itself adds.                                                 |
| A frame                        | Redrawing the fixture costs 0.07 ms of JavaScript and GL calls. A call through the binding costs about 45 ns.                                                                                                                                                                      |
| Language level                 | Classes with private fields, promises, async functions and `WeakRef` run as written. `Intl`, `URL`, `TextDecoder` and `fetch` are absent.                                                                                                                                          |
| Is an interpreter fast enough? | On a stand-in for per-frame scene work (transform update and quad batching), Hermes takes 0.26 ms for 2,000 nodes and 1.06 ms for 8,000. V8 with its JIT takes 0.02 and 0.08 ms; V8 without a JIT, which is what iOS and tvOS run, takes 0.41 and 1.63 ms.                         |

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
solid-desktop --headless job.js   # no window, no GL
solid-desktop --compile app.js app.hbc
```

An app is one script. `../cli/bundle.mjs` makes it from an entry module (Node and esbuild at build time only) and, with `--bytecode`, compiles it with this executable. Assets are files next to the script. `../src` is the module the entry imports: the renderer's platform adapter over what this runtime provides.

A script that throws while it starts ends the process with status 1. Later errors (in a timer, a frame, a callback, or a promise rejection nothing handled) are written to standard error with their stack and the loop goes on.

## What JavaScript gets

- `setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`, `performance.now`, `console` (`log`, `info`, `debug`, `warn`, `error`) and `print`.
- `__solid.gl`: a WebGL-shaped context. What is bound, and what throws by name because it is not, is the table in `src/gl/table.rs`.
- `__solid.readFile`, `readText` and `decodeImage`: files and images, read and decoded on worker threads.
- `__solid.window`: its size, `setSize`, and a listener for `resize` and `expose`.
- `__solid.appDir`, `exit` and `stats` (the loop's counters, for tests).

`__solid` is the host module's interface, not an app's.

## Idle

Nothing in the runtime polls. The loop waits in `SDL_WaitEvent`, with a timeout only while a timer or a paced frame is due; worker threads wait on their queue; a finished job wakes the loop with an SDL event. A run without a window uses no SDL at all and waits on a condition variable, because SDL's wait polls every millisecond when it has no window to wait on.

One wake remains that is not the runtime's: an SDL built with D-Bus support, as distributions build it, returns from its wait every three seconds to pump D-Bus (`DBUS_POLL_INTERVAL_NS` in SDL's `SDL_events.c`). It runs no JavaScript and does not reach the loop's counters, but the process does wake. It goes away with a statically linked SDL built without D-Bus, or when SDL waits on the D-Bus socket instead.

Frames are paced by the buffer swap when it waits for the display, and by the clock otherwise (a frame that drew nothing, a driver without vertical sync), so a chain of animation frames never spins.

## Layout

- `src/glue.cpp`: creates the Hermes VM, runs source or bytecode, compiles, drains promise jobs.
- `src/napi.rs`: the Node-API functions the host uses.
- `src/runtime.rs`: the event loop, timers, animation frames and the window's events.
- `src/worker.rs`: the thread pool for work that must not run on the JavaScript thread.
- `src/gl/`: the GL context and binding. `table.rs` is the binding as one table, `bind.rs` the macro that generates code from it, `calls.rs` the calls that need more than argument conversion.
- `src/images.rs`, `src/files.rs`: image decoding and file reading.
- `src/console.rs`, `src/prelude.js`: output, `console`, and the report of unhandled rejections.
- `tests/`: scripts the runtime runs to test itself. The tests of a real scene are in the package above (`../tests`).

## Not done yet

Input events and text input, network `fetch`, the web-standard globals (`URL`, `TextDecoder`), `Intl`, losing and recreating the GL context (`renderer.destroy()` leaves its GL objects until the process exits), high-density displays, accessibility, tray and menus, dialogs, packaging, static SDL3, Windows and macOS builds, and CI prebuilds of Hermes.
