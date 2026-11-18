# CLAUDE.md

Guidance for working in this repository.

## What this is

Solid Multiplatform: one SolidJS (universal renderer) scene on Roku, browser TVs (Tizen, webOS, Vizio), Android and Android TV, iOS and tvOS, desktop and web. Native targets do not render HTML. UI is `<view>`, `<text>`, `<Row>`, `<Column>` — never DOM elements.

This is a pnpm workspace (Node 24, pnpm via Corepack):

| Package                         | Path                | Contents                                                                                                                                                                               |
| ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@solid-multiplatform/renderer` | `packages/renderer` | `webgl/` (Lightning-derived v2), `canvas/` (v1 Canvas 2D), `roku/` (SceneGraph on the device's Hermes), `contracts.ts`                                                                 |
| `@solid-multiplatform/platform` | `packages/platform` | `src/core` (ElementNode, layout, focus), `src/primitives`, `src/sdk` (services), `src/hosts` + `hosts/` (per-target hosts), `cli/` (`solid-platform`), `examples/`, `bench/`, `tests/` |
| `@solid-multiplatform/video`    | `packages/video`    | Optional playback adapters: Media3, AVPlayer, Roku Video node, mpv, web                                                                                                                |

The structure is mid-restructure. The plan and its phase order are in the pull requests titled "Phase N"; hosts and the CLI become their own packages later. Do not add new code to patterns the plan removes: `setXPort` setters, browser-API fallbacks inside `src/sdk`, fake `document`/`window` shims, `.lng` access from primitives.

## Rules

1. Don't assume. Don't hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.
5. TV performance comes first: zero missed frames and no idle scheduling. Nothing may add timers, polling or listeners that run while a scene is idle. Feature code is opt-in.
6. A feature is "shipped" on a target only with an automated test on that target or recorded device evidence. Otherwise it is preview, or reported `unavailable`.

## Commands

Run from the repository root:

```sh
corepack pnpm install
corepack pnpm build      # renderer, then platform
corepack pnpm test       # renderer + platform (vitest, jsdom) + video
corepack pnpm lint       # prettier check + oxlint (type-aware)
```

From `packages/platform`:

```sh
npx vitest run tests/contract-flex.test.tsx   # one unit test file
corepack pnpm test:webgl                      # Playwright Chromium, real WebGL and Canvas
node tests/visual/run.mjs <out-dir>           # Canvas vs WebGL pixel comparison
node --test tests/native/*.test.mjs           # after a build
bash tests/cli/projects-smoke.sh              # pack, init an app, build web/Tizen/Roku
node bench/run.mjs --arms C --modes time,count --runs 3 --out <dir>
```

Type-aware lint needs `packages/platform/examples/roku` installed (`corepack pnpm install` there) because its tsconfig extends a Roku SDK file.

## How things fit

- `packages/platform/src/render.ts` + `solidOpts.ts`: Solid universal renderer over `ElementNode`.
- `src/core/elementNode.ts`: forwards props to the backend node, runs flex layout (`flexLayout.ts`), states, transitions.
- `src/core/focusManager.ts`: key handling and the focus path; takes a key event target.
- Unit tests run against a DOM renderer in jsdom (`SOLIDTV_DOM_RENDERING` define in `vitest.config.ts`); each test imports `tests/setup.ts` itself. WebGL, Canvas and the Roku backend are covered by `tests/webgl` and the renderer's own tests.
- The `@solidtv/source` import condition resolves package subpaths to TypeScript sources in tests and dev.
- `cli/init.mjs` scaffolds an app from `cli/templates` and `examples/*`; `cli/renderer-archive.mjs` packs the workspace renderer for it.

## Devices and secrets

Device credentials live in a `.env` outside this repository. Never print or commit them. Do not record device identifiers, addresses or full system traces in the repository.

## App-author rules (for example and template code)

- Nodes are absolutely positioned unless a parent has `display: "flex"`.
- Colors are 8-digit hex (`"#ff0000ff"`) or numbers. Use `color`, not `background`.
- No `style={{}}` objects with CSS, no classes, no DOM elements.
- One element should have `autofocus`; `Row`/`Column` manage child focus.
