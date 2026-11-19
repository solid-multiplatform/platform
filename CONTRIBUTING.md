# Contributing to Solid Multiplatform

The full guide is [docs/contributing.md](docs/contributing.md). The short version:

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm docs:check
```

You need Node 24 and Corepack. Type-aware lint also needs `corepack pnpm install` in `packages/platform/examples/roku`.

Three rules decide most reviews:

1. TV performance comes first: zero missed frames, and nothing scheduled while a scene is idle.
2. A feature is `tested` on a target only with an automated test that runs it on that target. The [feature matrix](docs/features.md) is generated from `docs/features.json`; change the JSON, run `node scripts/feature-matrix.mjs`, and never edit the Markdown.
3. Core and primitives use only what the scene contract declares, and SDK functions reach devices only through the service registry.

Do not commit device identifiers, addresses, credentials or full system traces.

Branch from `main`, make the change with its tests, and open a pull request. Releases are described in [docs/releasing.md](docs/releasing.md).
