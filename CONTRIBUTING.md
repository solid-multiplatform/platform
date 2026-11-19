# Contributing to Solid Multiplatform

The full guide, including where a new primitive, service, host or backend goes, is [docs/contributing.md](docs/contributing.md). The short version:

You need Node 24 and Corepack (pnpm comes from `corepack pnpm`). Type-aware lint also needs the Roku example installed, because its `tsconfig.json` extends a file from the Roku SDK: run `corepack pnpm install` in `packages/platform/examples/roku`. A target's own toolchain (JDK, Xcode, the Roku SDK) is only needed to build that target; `solid-platform doctor` lists what is missing in a generated app.

```sh
corepack pnpm install
corepack pnpm build       # renderer, then platform
corepack pnpm test        # renderer + platform (vitest, jsdom) + video
corepack pnpm lint        # prettier check + oxlint (type-aware)
corepack pnpm docs:check  # the feature matrix is generated and its evidence exists
```

While iterating, run one unit test file with `npx vitest run tests/<file>.test.tsx` from `packages/platform`. A pre-commit hook runs lint-staged: Prettier on staged `.ts`, `.js`, `.cjs` and `.md` files, oxlint on `.ts`, `.tsx` and `.mjs`.

## The rules that decide most reviews

1. **TV performance comes first.** Zero missed frames, and nothing scheduled while a scene is idle. A change may not add a timer, polling or a listener that runs while a scene is idle; feature code is opt-in.
2. **Evidence for target claims.** A feature is `tested` on a target only with an automated test that runs it on that target, or recorded device evidence. The [feature matrix](docs/features.md) is generated from `docs/features.json`: change the JSON, run `node scripts/feature-matrix.mjs`, and never edit the Markdown. Do not write "shipped" or "supported" without that evidence.
3. **Stay inside the contracts.** Core and primitives use only what the scene contract declares; a backend difference is fixed in the backend, never by branching in core. SDK functions reach devices only through the service registry.

Also: do not commit device identifiers, addresses, credentials or full system traces.

## Pull requests

Branch from `main`, make the change with its tests, and open a pull request against `main`. CI must pass: lint, the renderer and unit suites, the browser suites in Chromium and WebKit, the generated-project smoke, and the Apple, Android and desktop-runtime jobs that the change touches. Keep the change small — the minimum code that solves the problem — and do not add to patterns the project is removing (`setXPort` setters, browser-API fallbacks inside `src/sdk`, fake `document`/`window` shims, `.lng` access from primitives).

Contributions are licensed under Apache-2.0, the project's licence ([LICENSE](LICENSE), [NOTICE](NOTICE)). Releases are described in [docs/releasing.md](docs/releasing.md).
