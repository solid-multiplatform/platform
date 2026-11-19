# Showcase

The kitchen-sink app of Solid Multiplatform: every UI primitive and every
device service on one scene, and the probe that says what works on a target.

## What is in it

- **Home**: a grid of the sections below. Arrows move, Enter or a click opens,
  Back returns to the tile it left.
- **UI gallery**: Layout, Text, Images, Effects, States, Transitions,
  Row/Column/Grid, a virtual list of 1,000 rows, Dialogs (Modal, Alert, Drawer,
  DatePicker) and Controls (Checkbox, Radio, Select, Menu, Toast, Tooltip,
  TextField).
- **Services**: one row per service in the registry, generated from
  `src/services/table.ts`. A row without a provider reads `unavailable`; Enter
  runs the others and shows `ok`, `denied`, `failed: <reason>` or `unverified`.
- **Diagnostics**: target, capabilities, installed services, backend, viewport
  and the frames drawn in the last two seconds.

Nothing is scheduled while a screen is idle: no clocks, spinners or polling.
The frame counter listens to the renderer's own `frameTick` and is read in a
key handler.

## Layout of the source

| Path                     | What                                                           |
| ------------------------ | -------------------------------------------------------------- |
| `src/App.tsx`            | Routes (`createNavigation`), Back handling, theme              |
| `src/routes.ts`          | The sections: the home grid and the router read this           |
| `src/screens/`           | One file per screen; `gallery.tsx` holds the static demos      |
| `src/services/table.ts`  | The service table: name, SDK call, how it is judged, the probe |
| `src/services/run.ts`    | Runs a row; maps errors to `denied`, `failed`, `unavailable`   |
| `src/probe/`             | Probe mode: result type, UI assertions, the keys they press    |
| `src/launch.ts`          | Launch parameters, host-neutral                                |
| `src/env.ts`             | What a host entry hands the app                                |
| `src/main.web.tsx`       | The browser entry: the only file that touches the DOM          |
| `tests/showcase.e2e.mjs` | Playwright Chromium against the built bundle                   |

## Probe mode

Started with the `probe` launch parameter, the app runs every service probe
that is safe unattended, then three UI assertions (arrow keys move focus, the
virtual list scrolls and stays a window, a modal traps focus and Back closes
it), and reports one JSON document:

```json
{
  "target": "web",
  "backend": "webgl",
  "capabilities": { "target": "web", "inputs": ["keyboard", "mouse", "touch"] },
  "installedServices": ["audio", "battery"],
  "services": {
    "battery": { "status": "ok", "detail": "level=1 charging=true" }
  },
  "ui": { "modalTrapsFocus": { "status": "ok", "detail": "…" } }
}
```

`unverified` means nothing in the app could check the service (it needs a
person, a permission prompt or another application); it is never reported as
`ok`. Unattended, a probe opens nothing and prompts for nothing.

`src/launch.ts` reads the parameter from a query string, a deep link, an
argument vector or a record, so each host passes what it was started with.
A host entry supplies `report(result)`. The UI assertions press their keys
through the focus manager's `pressKey` (`src/probe/keys.ts`), so they need
nothing from the host.

## Targets

| Target | Build                             | Start probe mode | Where the result goes                                                   |
| ------ | --------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| Web    | `pnpm build` (`dist/web`)         | `?probe=1`       | `window.__showcaseResult`, and `console.log('SHOWCASE_RESULT ' + json)` |
| Tizen  | `pnpm build:tizen` (`dist/tizen`) | `?probe=1`       | the same two; the bundle is not packaged as a `.wgt` here               |
| webOS  | `pnpm build:webos` (`dist/webos`) | `?probe=1`       | the same two; the bundle is not packaged as an `.ipk` here              |

The browser TVs use the same bundle on `tvHost(webHost)`. Their builds are
checked in desktop Chromium only (`pnpm test:tizen`, `pnpm test:webos`): that
shows the bundle starts and probes on the TV host, not that it runs on a
television.

Roku, Android, iOS, tvOS and desktop have no entry yet. Each needs an entry
file like `main.web.tsx` that starts `App` on its host and supplies `launch`
and `report`. The intended reporters, none of which exists yet:
a console marker line on Roku, logcat or a file on Android, stdout on desktop.

The web build mirrors what `solid-platform build web` generates
(`cli/templates/web/vite.config.mjs`) in its own `vite.config.mjs`: the CLI
builds only projects laid out by `solid-platform init`.

## Commands

From the repository root, after `corepack pnpm install` and
`corepack pnpm build`:

```sh
corepack pnpm --filter showcase check   # tsc --noEmit
corepack pnpm --filter showcase build   # dist/web
corepack pnpm --filter showcase test    # build, then Playwright Chromium
```

The test needs Playwright's Chromium, the one the platform package's WebGL
tests use (`pnpm exec playwright install chromium` in `packages/platform`).
It drives the home, controls, dialogs and services screens with a real
keyboard and mouse and checks the ARIA mirror names the focused control
(Select, Menu, Alert and DatePicker are opened, operated and closed with the
keyboard only, and focus must return to the button that opened each); loads
`?probe=1`
and checks every service and UI assertion; and requires two seconds without an
animation frame on home and on every section, once each has settled.
`SHOWCASE_SCREENSHOTS=<dir>` keeps pictures of the steps.

## Known gaps, shown as they are

- Bold text draws nothing: the font the framework ships has one weight.
- A column places its rows once its text lines have been measured, a frame or
  more after the screen mounts. A click in that moment does nothing (it used
  to activate the column's last row); the test sends five such clicks.
- A Toast's action answers a pointer only: a toast never takes focus.
- A click that reaches no node leaves the browser's focus on the page body
  until the next focus move; the scene's focus does not move.
