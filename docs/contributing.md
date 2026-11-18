# Contributing

## Set up

You need Node 24 and Corepack. From the repository root:

```sh
corepack pnpm install
corepack pnpm build      # renderer, then platform
corepack pnpm test       # renderer + platform (vitest, jsdom) + video
corepack pnpm lint       # prettier check + oxlint (type-aware)
corepack pnpm docs:check # the feature matrix is up to date and its evidence exists
```

Type-aware lint needs the Roku example installed, because its `tsconfig.json` extends a file from the Roku SDK:

```sh
cd packages/platform/examples/roku
corepack pnpm install
```

More tests, from `packages/platform`:

```sh
npx vitest run tests/contract-flex.test.tsx   # one unit test file
corepack pnpm exec playwright install chromium
corepack pnpm test:webgl                      # headless Chromium, real WebGL and Canvas
node tests/visual/run.mjs <out-dir>           # Canvas against WebGL pixel comparison
node --test tests/native/*.test.mjs           # after a build
bash tests/cli/projects-smoke.sh              # pack, init an app, build web, Tizen and Roku
```

A pre-commit hook runs `lint-staged`: Prettier on `.ts`, `.js`, `.cjs` and `.md` files and oxlint on `.ts`, `.tsx` and `.mjs` files.

## Rules

1. **TV performance comes first.** Zero missed frames and no idle scheduling. A change may not add a timer, polling or a listener that runs while a scene is idle. Feature code is opt-in. See [Performance](/performance.md).
2. **The evidence rule.** A feature is `tested` on a target only with an automated test that runs it on that target. Otherwise it is `preview`, `in-progress` or `unavailable`. Do not write "shipped" or "supported" in docs without that evidence.
3. **Stay inside the contracts.** Core and primitives use only what the scene contract declares. A difference between backends is fixed in the backend, never by branching in core. SDK functions reach devices only through the service registry.
4. **Small changes.** The minimum code that solves the problem. Touch only what you must.
5. **No device data.** Device credentials live in a `.env` outside the repository. Do not commit device identifiers, addresses or full system traces.

Patterns that are being removed, so do not add to them: `setXPort` setters, browser-API fallbacks inside `src/sdk`, fake `document` or `window` shims, and `.lng` access from primitives.

## Where things go

- A new UI primitive: `packages/platform/src/primitives`, exported from `src/primitives/index.ts`, with a `tests/contract-*.test.tsx` file.
- A new device service: see "Add a service" in [Services](/services.md).
- A new platform: [Add a host](/add-a-host.md).
- A new graphics model: [Add a renderer backend](/add-a-backend.md).

Unit tests run on the DOM backend in jsdom; each test file imports `tests/setup.ts` itself. Tests under `tests/webgl` run in Chromium on the real backends.

## The feature matrix

`docs/features.md` is generated. Do not edit it.

1. Change `docs/features.json`. A `tested` cell needs `evidence` that starts with the repository path of the test, followed by the CI job that runs it.
2. Run `node scripts/feature-matrix.mjs` to render `docs/features.md`.
3. Run `corepack pnpm docs:check`. It fails if the rendered file is out of date, if a `tested` cell has no evidence, or if an evidence path does not exist.

The script has its own tests: `node --test scripts/*.test.mjs`.

## Documentation

The site in `docs/` is [docsify](https://docsify.js.org): Markdown files, `_sidebar.md` and `index.html`. Serve the `docs` directory with any static file server to preview it.

- Write plainly, in the second person, in short sentences.
- Code samples must match the current API. Copy from `packages/platform/examples`, `cli/templates` and the tests where you can.
- Use the legacy names that are still in the code (`SOLIDTV_*` defines, the `@solidtv/source` condition, `ElementNode.lng`) as they are, and say they will be renamed before 1.0.
- Describe work in open pull requests as in progress, never as available.
- Prettier checks every Markdown file. Run `corepack pnpm lint` before you push.

## Pull requests

1. Branch from `main`.
2. Make the change with its tests.
3. Run `corepack pnpm lint`, `corepack pnpm test` and `corepack pnpm docs:check`.
4. Open a pull request. CI runs the `lint`, `renderer`, `unit`, `browser`, `projects` and `apple` jobs, and the `android` job; [Targets](/targets/README.md) says what each covers.

Releases are described in [Releasing](/releasing.md).
