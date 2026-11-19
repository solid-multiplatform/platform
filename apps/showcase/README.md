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

## Probe mode

Started with the `probe` launch parameter, the app runs every service probe that is safe unattended, then three UI assertions (arrow keys move focus, the virtual list scrolls and stays a window, a modal traps focus and Back closes it), and reports one JSON document: the target, the backend, the capabilities, the installed services, each probe's `ok`/`denied`/`failed`/`unavailable`/`unverified` result, and the UI assertions.

- Web, Tizen and webOS: `?probe=1`. The result is `window.__showcaseResult` and one `SHOWCASE_RESULT <json>` console line.
- Desktop: `--probe` after `--` on the command line; the same console line.

`unverified` means nothing in the app could check the service (it needs a person, a permission prompt or another application); it is never reported as `ok`. Unattended, a probe opens nothing and prompts for nothing. `src/launch.ts` reads the parameter from whatever the host was started with, so each entry passes it along.

## The automated test

`corepack pnpm --filter showcase test` builds the web bundle and drives it in Playwright: the home, controls, dialogs and services screens with a real keyboard and mouse, checking the ARIA mirror names the focused control (Select, Menu, Alert and DatePicker are opened, operated and closed with the keyboard only, and focus returns to the button that opened each); `?probe=1` with every service and UI assertion; and two seconds without an animation frame on home and on every section once it has settled. `test:chromium`, `test:firefox` and `test:webkit` run one engine; `SHOWCASE_SCREENSHOTS=<dir>` keeps pictures of the steps.

Known gaps are shown as they are: bold text draws nothing (one font weight), a Toast's action answers a pointer only, and a click that reaches no node leaves the browser's focus on the page body until the next focus move.
