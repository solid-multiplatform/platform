# Roku

Target name: `roku`.

Roku does not run a browser. The scene runs on the device's JavaScript engine and draws with SceneGraph nodes.

## What it is built from

- Backend: `packages/renderer/roku` (`@solid-multiplatform/renderer/roku`). `SceneGraphRenderer` maps scene nodes to SceneGraph nodes, with its own animation, text layout, font and effect code.
- Host: `packages/platform/hosts/roku`. `rokuConfig({ title, entry, assets })` from `@solid-multiplatform/platform/roku/preset` configures the Roku SDK build. `@solid-multiplatform/platform/roku` is the channel entry. The host does not implement `HostDefinition` yet.
- Services: `rokuServices(section)` from `@solid-multiplatform/platform/services/roku` provides `settings`, stored in the device registry. Text entry is `@solid-multiplatform/platform/editor/roku`.
- CLI target: `targets/roku` with a `roku-config.ts`. Plugins are SceneGraph Tasks written in BrighterScript and compiled with `bsc`.

## Build

```sh
corepack pnpm build roku
```

Output: `targets/roku/dist-roku/solid-multiplatform.zip`, a developer ZIP to sideload. The build needs `python3` for the zip step. `dev` is not available; sideload with the device's developer tools.

## How it is tested

- `browser` job: `packages/platform/tests/webgl/conformance-roku.test.tsx` runs the scene conformance cases on the SceneGraph backend, and `fixture-roku.test.tsx` runs the shared app fixture on it. Both run in Chromium on a fake of the Roku SDK (`tests/webgl/scenegraph-sdk`). They test the backend's logic, not a device.
- `renderer` job: `packages/renderer/tests/roku-contract-props.test.mjs`, on fakes.
- `unit` job: `tests/roku-native-text.test.ts`, `tests/roku-video-bridge.test.ts` and `tests/roku-video.test.mjs`, in jsdom or Node.
- `projects` job: `tests/cli/projects-smoke.sh` builds `roku` from a generated app and checks that the ZIP contains the compiled plugin component.

No CI job runs a channel on a Roku device or on Roku OS.

## Device procedures

- `node packages/platform/tests/cli/roku-device-check.mjs` reads a device's state over ECP when `ROKU_DEV_IP` is set. It is read-only: it does not install or replace the channel. Without the variable it reports that and exits cleanly.
- `solid-platform certify roku <metrics.json>` compares a metrics file with the certification budgets in `src/sdk/certification.ts` and exits non-zero on a failure. Collecting the metrics is up to you.

Keep device addresses and credentials out of the repository.

## In progress

Verification on a physical Roku TV is in an open pull request. Shapes, gradients and shadows have been checked there; fonts are still being worked on. Until it merges, treat drawing on a real device as `in-progress`.
