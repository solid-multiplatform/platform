# Desktop runtime

One executable for Linux, Windows and macOS: the Hermes JavaScript engine, an SDL3 window and a GL surface for the scene. There is no Node.js and no browser in it.

This is the spike that decided the approach. It runs scripts, timers, animation frames and a first GL frame; it does not run an app yet.

## What the spike showed

| Question                       | Result                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a Rust host embed Hermes?  | Yes. Hermes (branch `static_h`) links statically; the only C++ is 60 lines that create the VM. Everything else goes through Hermes' own Node-API implementation, which is plain C.                                                                         |
| Size                           | 4.3 MB stripped on Linux x64, with the JavaScript compiler included. SDL3 is still linked dynamically here.                                                                                                                                                |
| Language level                 | Classes with private fields, promises and `WeakRef` run as written. `Intl` is absent in this build and timers are the host's job.                                                                                                                          |
| Idle behaviour                 | The loop blocks in `SDL_WaitEvent`. Two seconds of an idle scene: 1 wakeup (the timer that ended the test), 0 frames.                                                                                                                                      |
| First frame                    | An OpenGL ES 3 context through SDL; the test reads the pixel back from the back buffer.                                                                                                                                                                    |
| Is an interpreter fast enough? | On a stand-in for per-frame scene work (transform update and quad batching), Hermes takes 0.26 ms for 2,000 nodes and 1.06 ms for 8,000. V8 with its JIT takes 0.02 and 0.08 ms; V8 without a JIT, which is what iOS and tvOS run, takes 0.41 and 1.63 ms. |

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

`build.rs` compiles the glue with the flags of a default Release configuration of Hermes; they decide the layout of VM classes, so a differently configured Hermes needs them changed there.

## Layout

- `src/glue.cpp`: creates and destroys the Hermes VM, runs a script, drains promise jobs.
- `src/napi.rs`: the Node-API functions the host uses.
- `src/runtime.rs`: the event loop, timers and animation frames.
- `src/gl.rs`: the GL context and the first few WebGL-named calls.
- `tests/`: scripts the runtime runs to test itself.

## Not done yet

The WebGL-shaped binding the renderer needs, input events, text input, image decoding, the web-standard globals (`fetch`, `URL`, `TextDecoder`), `Intl`, accessibility, tray and menus, dialogs, packaging, static SDL3, Windows and macOS builds, and CI prebuilds of Hermes.
