# Showcase

The kitchen-sink app of Solid Multiplatform: every UI primitive and every device service on one scene, and the probe that reports what works on a target.

- **Home**: a grid of the sections below. Arrows move, Enter or a click opens, Back returns to the tile it left.
- **UI gallery**: layout, text, images, effects, states, transitions, Row/Column/Grid, a virtual list of 1,000 rows, dialogs (modal, alert, drawer, date picker) and controls (checkbox, radio, select, menu, toast, tooltip, text field).
- **Services**: one row per service in the registry. A row without a provider reads `unavailable`; Enter runs the others and shows `ok`, `denied`, `failed: <reason>` or `unverified`.
- **Diagnostics**: target, capabilities, installed services, backend, viewport and the frames drawn in the last two seconds.

Nothing is scheduled while a screen is idle: no clocks, spinners or polling. The frame counter listens to the renderer's own `frameTick` and is read in a key handler.

## Run it

From `apps/showcase`, after `corepack pnpm install` and `corepack pnpm build` in the repository root:

```sh
corepack pnpm build           # dist/web; serve it with any static file server
corepack pnpm build:desktop   # dist/desktop, for the native runtime
../../packages/host-desktop/native/target/release/solid-desktop --script dist/desktop/app.js
```

The browser TV builds (`build:tizen`, `build:webos`) are the same bundle on `tvHost(webHost)`; CI checks them in desktop Chromium, not on a television. The desktop build runs on the native Rust + Hermes runtime.

## Adaptive layout

One scene, three window classes, from `src/layout.ts`: **phone** (at most 500 wide), **desktop window** (501 to 1600) and **television** (above 1600, including the 1920-wide TV). The viewport signal is reactive, so resizing the desktop window re-lays the scene without a reload.

- **Television and desktop** keep the 10-foot geometry the scene has always had: 32-unit margins, a 34-unit title at y 18, content at y 76, cards 280 by 110. The Roku visual suite compares 1920 by 1080 pixels and the mouse walk clicks at 1280, so neither may move.
- **Phone**: 16-unit margins, a 26-unit title at y 10, content at y 60, full-width cards. The home grid becomes one full-width card per row (a stacked list, reached with Up and Down as before), buttons fill the column unless they asked for less, and the `Row, Column, Grid` gallery reflows its grid to as many 132-wide cells as fit.
- The desktop runtime opens a 1280 by 720 window (`packages/host-desktop/native/src/main.rs`), which is the desktop class. Resize it to phone proportions to see the mobile layout; the automated test does the same in Chromium by changing the Playwright viewport at 1280, 420 and back.
- `Diagnostics` shows the class the viewport resolves to.

## Frame-rate meter

Press **F** (or **f**) to open a small overlay in the top-right corner, and F again to close it. It is off by default and is not part of the idle scene.

- It shows instantaneous FPS (from the last frame's delta), the average over the last second, the last frame's time, p50 and p99 frame times over that window, and the renderer's draw-op and quad counts from its last update when the backend reports them.
- It samples only inside the renderer's own `frameTick` event: it adds no timer, no animation frame and no polling. The listener is attached when the overlay mounts and removed when it unmounts, so closed it costs nothing.
- The readout is republished at most once every three frames. Because a publish needs three frames, the one frame a publish itself induces cannot publish in turn: with the overlay open on an idle screen, the scene still settles to zero frames (the e2e test asserts two seconds without a frame, both open and closed). Opened on a screen nobody touches, it says `measuring` rather than inventing a rate; move and it fills in.
- `FPSCounter` is the overlay. `setupFPS` and `TelemetryCounter` remain for the renderer's opt-in `fpsUpdate` telemetry, which does run a sampler timer while `fpsUpdateInterval` is above 0; the showcase does not use them.

## Probe mode

Started with the `probe` launch parameter, the app runs every service probe that is safe unattended, then three UI assertions (arrow keys move focus, the virtual list scrolls and stays a window, a modal traps focus and Back closes it), and reports one JSON document: the target, the backend, the capabilities, the installed services, each probe's `ok`/`denied`/`failed`/`unavailable`/`unverified` result, and the UI assertions.

- Web, Tizen and webOS: `?probe=1`. The result is `window.__showcaseResult` and one `SHOWCASE_RESULT <json>` console line.
- Desktop: `--probe` after `--` on the command line; the same console line.

`unverified` means nothing in the app could check the service (it needs a person, a permission prompt or another application); it is never reported as `ok`. Unattended, a probe opens nothing and prompts for nothing. `src/launch.ts` reads the parameter from whatever the host was started with, so each entry passes it along.

## The automated test

`corepack pnpm --filter showcase test` builds the web bundle and drives it in Playwright: the home, controls, dialogs and services screens with a real keyboard and mouse, checking the ARIA mirror names the focused control (Select, Menu, Alert and DatePicker are opened, operated and closed with the keyboard only, and focus returns to the button that opened each); `?probe=1` with every service and UI assertion; and two seconds without an animation frame on home and on every section once it has settled. It also resizes the page to phone width (420), checks the home list is one column and navigable there, widens it again, and opens and closes the frame meter with F while asserting the page idles both open and closed. `tests/layout.test.mjs` checks the breakpoints and the geometry they preserve (`node --test`, run by `pnpm test`). `test:chromium`, `test:firefox` and `test:webkit` run one engine; `SHOWCASE_SCREENSHOTS=<dir>` keeps pictures of the steps.

Known gaps are shown as they are: bold text draws nothing (one font weight), a Toast's action answers a pointer only, and a click that reaches no node leaves the browser's focus on the page body until the next focus move.
