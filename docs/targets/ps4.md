# PlayStation 4

Target name: `ps4`.

The PS4 runs the app in its web browser as a hosted web app. There is no
package format and no packaging step: the build output in `targets/ps4/dist`
is what the console loads. The input is a mouse pointer and left click, so the
whole interaction model is the pointer: movement focuses, a click selects.

## What it is built from

- Backend: WebGL by default. `build ps4 --legacy` builds the Canvas 2D
  variant for an engine without WebGL 2: it resolves the `canvas` package
  condition and compiles with `@vitejs/plugin-legacy`. The normal build emits
  ES2017 syntax, which the console browser accepts.
- Host: `ps4Host(webHost)` from
  `@solid-multiplatform/platform/browser-tv/input`. It is the browser TV host
  with `bindPS4`: the same fixed 1920×1080 stage fitted in the window
  (`bindTVViewport`), and a pointer source feeding the framework's one scene
  pointer.
- Capabilities: `{ inputs: ['mouse'] }`. No keyboard, remote or gamepad is
  declared, so `hasKeyboard()` is false and apps hide keyboard shortcuts and
  remote-only affordances.
- Services and history: the web providers and `window.history`, as on every
  browser target.

## Input contract

- **Pointer move → focus.** Moving the mouse focuses the front-most pointer
  target under it, through the scene's hover focus. The scene's hit test does
  the work; a move allocates nothing beyond it.
- **Left click → Select.** A click activates the target under the pointer the
  way a remote's Select does: it focuses the node and presses Enter, so a node
  with `onEnter` activates even when it has no `onMouseClick`.
- **Click on empty space.** A click that lands on no target presses Enter on
  the focused node. This is the console's Select when the pointer is over the
  background.
- **Back.** A browser Back key (`BrowserBack`, `GoBack`, or key code 166/461)
  has its default cancelled and is delivered down the focus path as Escape.
  Backspace and Escape are also cancelled so the webview never navigates. These
  keys are a fallback only: capabilities still declare no keyboard, and the
  page is not a text editor.
- **Idle.** Nothing runs while the pointer is still. There are no timers,
  listeners that poll, or frame callbacks. The test asserts no scheduled
  callback in two settled seconds.

## Build

```sh
corepack pnpm build ps4           # targets/ps4/dist (ES2017, WebGL)
corepack pnpm build ps4 --legacy  # targets/ps4/dist-legacy (Canvas 2D)
```

`init --targets ps4` writes `targets/ps4` as a Vite project and the generated
`work/main.ts` starts the app through `ps4Host(...)`. Serve `targets/ps4/dist`
from the page the console browser opens.

## What is not supported

- No keyboard entry, no on-screen keyboard, no remote or gamepad keys. The
  declared input kind is `mouse` alone.
- No automatic Canvas 2D fallback when a WebGL context is lost. `--legacy` is
  a separate Canvas build, chosen before the app starts.
- No packaging, signing or install step: the console loads the hosted bundle.
- No test has run on PS4 hardware. `tests/webgl/ps4-host.test.tsx` runs the
  host in desktop Chromium, Firefox and WebKit, and
  `tests/host/ps4-input.test.tsx` covers the empty-space Select fallback in
  jsdom. Pointer behaviour on a physical console is unmeasured; the feature
  matrix keeps those cells `tested` for the engines only.
