# Solid Multiplatform

One SolidJS scene on Roku, browser TVs (Tizen, webOS, Vizio), Android and Android TV, iOS and tvOS, desktop and the web.

The scene is not DOM. You write `<view>`, `<text>`, `<Row>` and `<Column>` with Solid's reactivity. Solid's universal renderer turns them into nodes of a drawing backend (WebGL, Canvas 2D or Roku SceneGraph), and a host supplies the surface, the keys and the device services for each platform.

The first rule of the project is TV performance: zero missed frames, and nothing scheduled while a scene is idle.

## Status

Pre-1.0, and mid-restructure. The documentation describes what is on `main`.

- **On `main`:** the monorepo; a typed scene contract with a conformance suite that CI runs on the DOM, WebGL, Canvas and Roku backends; one flex engine; the host contract (`HostDefinition`, `startApp`) with web and DOM hosts; a service registry with browser providers; the `solid-platform` CLI; release automation.
- **In progress, in open pull requests:** Roku verified on a physical TV; a desktop runtime in Rust that embeds Hermes, replacing the Node-based desktop host on `main`; pointer and accessibility as framework features; native Android service providers.
- **Not verifiable by this project today:** physical Apple devices; Tizen, webOS and Vizio hardware; desktop on Windows and macOS; push notifications end to end.

What is tested on which target is in the [feature matrix](docs/features.md). It is generated from [docs/features.json](docs/features.json), and a cell says `tested` only when it names an automated test that runs that feature on that target.

## Try it

You need Node 24 and Corepack.

```sh
corepack pnpm install
corepack pnpm build
node packages/platform/cli/main.mjs init ../living-room --targets web
cd ../living-room
corepack pnpm install
corepack pnpm dev web
```

`init` creates an app outside this repository and vendors the packed platform and renderer packages into it. [Getting started](docs/getting-started.md) explains the project layout and how to build each target.

## Documentation

The docs are a docsify site in [docs/](docs/README.md).

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md): packages, the scene, host and CLI contracts, the frame loop
- Writing UI: [layout](docs/flow/layout.md), [styling](docs/essentials/styling.md), [focus and keys](docs/essentials/focus.md), [Row and Column](docs/primitives/row_column.md)
- [Services](docs/services.md): device features behind one registry
- [Add a host](docs/add-a-host.md) and [add a renderer backend](docs/add-a-backend.md)
- [Targets](docs/targets/README.md): how each target is built and tested
- [Performance](docs/performance.md)
- [Migrating from `@lightningtv/solid` or `@solidtv/solid`](docs/migrate.md)

## Repository

A pnpm workspace with three packages, versioned together:

- [`packages/renderer`](packages/renderer): `@solid-multiplatform/renderer`. The scene contract (`contracts.ts`), the backends (`webgl/`, `canvas/`, `roku/`, `dom/`) and the conformance cases every backend must pass.
- [`packages/platform`](packages/platform): `@solid-multiplatform/platform`. `ElementNode`, flex layout and focus (`src/core`), primitives, the SDK and its service registry (`src/sdk`), the host contract (`src/host.ts`) and hosts, the CLI (`cli/`), examples, the bench and the tests.
- [`packages/video`](packages/video): `@solid-multiplatform/video`. Optional playback adapters.

```sh
corepack pnpm test         # renderer + platform (vitest, jsdom) + video
corepack pnpm lint         # prettier check + oxlint
corepack pnpm docs:check   # the feature matrix is up to date and its evidence exists
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/releasing.md](docs/releasing.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Source records for imported code are in [packages/platform/PROVENANCE.md](packages/platform/PROVENANCE.md) and [packages/renderer/PROVENANCE.md](packages/renderer/PROVENANCE.md).
