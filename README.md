# Solid Multiplatform

One SolidJS scene on Roku, browser TVs (Tizen, webOS, Vizio), PlayStation 4, Android and Android TV, iOS and tvOS, desktop (Linux, macOS, Windows) and the web. You write the UI once; the `solid-platform` CLI generates each target's entry, and the app runs on that target's host.

The scene is not DOM. You write `<view>`, `<text>`, `<Row>` and `<Column>` with Solid's reactivity; Solid's universal renderer turns them into nodes of a drawing backend (WebGL, Canvas 2D or Roku SceneGraph), and a host supplies the surface, the keys and the device services for each platform.

Solid Multiplatform is for teams building television-first applications in TypeScript who want one codebase across TV, mobile and desktop, and who care about frame timing on low-power devices more than about DOM compatibility.

## Why

Two commitments shape the design:

- **One scene, generated entries.** An app is one component in one file, `src/app.tsx`, default-exported and built from `Screen`, `Text`, `Button` and `List` (`@solid-multiplatform/platform/app`). The CLI generates every target's entry around it. A target that needs its own layout gets a variant file beside the shared one, not a fork.
- **Performance first.** The project's first rule is TV performance: zero missed frames, and nothing scheduled while a scene is idle. Nothing in the framework may add timers, polling or listeners that run while a scene is idle, and feature code is opt-in.

```tsx
import {
  Button,
  Screen,
  Text,
  createSignal,
} from '@solid-multiplatform/platform/app';

export default function App() {
  const [count, setCount] = createSignal(0);
  return (
    <Screen>
      <Text size="title">living-room</Text>
      <Button onPress={() => setCount(count() + 1)}>
        {`Pressed ${count()} times`}
      </Button>
    </Screen>
  );
}
```

## Quick start

You need Node 24 and Corepack (pnpm comes from `corepack pnpm`).

```sh
git clone https://github.com/solid-multiplatform/platform.git
cd platform
corepack pnpm install
corepack pnpm build
node packages/platform/cli/main.mjs init ../living-room --targets web
cd ../living-room
corepack pnpm install
corepack pnpm dev web
```

`init` vendors the packed platform and renderer packages into the app, so it builds without this checkout. For the desktop target, run `corepack pnpm platform add desktop <release.tgz>` in the app: it installs the desktop host and fetches the native runtime from the GitHub release. The desktop runtime is Rust and Hermes — no Node at run time; Node is only a build tool. [Getting started](docs/getting-started.md) covers every target, its toolchain and its commands.

## Repository

| Path                    | Package or app                      | What it holds                                                                                               |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/renderer`     | `@solid-multiplatform/renderer`     | The scene contract, the WebGL, Canvas 2D, Roku SceneGraph and DOM test backends, and the conformance suite. |
| `packages/platform`     | `@solid-multiplatform/platform`     | Layout, focus, primitives, the service registry, hosts and the `solid-platform` CLI.                        |
| `packages/host-desktop` | `@solid-multiplatform/host-desktop` | The Rust + Hermes desktop runtime and its host definition.                                                  |
| `packages/video`        | `@solid-multiplatform/video`        | Optional playback adapters: Media3, AVPlayer, Roku SceneGraph, mpv, web.                                    |
| `apps/showcase`         | showcase                            | The kitchen-sink app: every primitive and service, and a device probe.                                      |
| `docs/`                 | —                                   | The documentation site.                                                                                     |

## Verifying a checkout

```sh
corepack pnpm build       # renderer, then platform
corepack pnpm test        # renderer + platform (vitest, jsdom) + video
corepack pnpm audit:layout # render real screens at phone/TV/Roku/desktop sizes
corepack pnpm lint        # prettier check + oxlint (type-aware)
corepack pnpm docs:check  # the feature matrix is generated and its evidence exists
```

CI additionally runs the showcase and the renderer's browser suites in Chromium and WebKit, the generated-project smoke, the Apple simulators, Android, and the desktop runtime on Linux, macOS and Windows. The documentation is in [docs/](docs/README.md); [docs/targets/](docs/targets/README.md) says how each target is built and tested.

## Status

Pre-1.0 beta. Not every feature works on every target, and the [feature matrix](docs/features.md) says exactly which do: a feature is `tested` on a target only with an automated test that runs it on that target, or recorded device evidence. Read the matrix and the [target pages](docs/targets/README.md) before relying on a target.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute and [docs/releasing.md](docs/releasing.md) for how releases are made.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE); source records for imported code are in `PROVENANCE.md` inside each package. The video package is additionally offered under MIT.
