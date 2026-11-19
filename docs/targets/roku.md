# Roku

Target name: `roku`.

Roku does not run a browser. The scene runs on the device's JavaScript engine and draws with SceneGraph nodes.

## What it is built from

- Backend: `packages/renderer/roku` (`@solid-multiplatform/renderer/roku`). `SceneGraphRenderer` maps scene nodes to SceneGraph nodes, with its own animation, text layout, font and effect code.
- Host: `packages/platform/hosts/roku`. `rokuHost({ namespace })` is a `HostDefinition`, so the generated entry is `startApp(rokuHost(...), App, options)`; `rokuKeyMap` supplies the media keys. The host supplies router history in memory, so the router no longer reads a shimmed `window.history`. `rokuConfig({ title, entry, assets })` from `@solid-multiplatform/platform/roku/preset` configures the Roku SDK build. `@solid-multiplatform/platform/roku` is the channel entry.
- Services: the host installs `settings`, encrypted `secureStorage`, `deviceInfo`, `locale`, `links` (launch, running and resume), `lifecycle` with Instant Resume, `request` over the firmware's `fetch`, `keyEvents`, `memory` and `connectivity`. Text entry is `@solid-multiplatform/platform/editor/roku`.
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

The device runs recorded on 2026-11-18 used a TCL 50S435 on Roku OS 16.0.4 at 1080p. Their result files are kept outside the repository under `handoff/roku-device/`; they are the evidence for the `device` cells in the [feature matrix](/features.md).

```sh
node packages/platform/tests/roku-device/run-conformance.mjs   # 15/15
node packages/platform/tests/roku-device/run-visual.mjs       # 26/26, and 26/26 with the forced image tier
node packages/platform/tests/roku-device/run-text.mjs         # 23/23
node packages/platform/tests/roku-device/run-host.mjs         # 48/48
node packages/platform/tests/roku-device/run-motion.mjs       # 9/9 (motion-verify-result.txt)
node packages/platform/tests/roku-device/run-video.mjs        # 16/16 (handoff/roku-video/2026-11-19-video-result.txt)
```

- `node packages/platform/tests/cli/roku-device-check.mjs` reads a device's state over ECP when `ROKU_DEV_IP` is set. It is read-only: it does not install or replace the channel. Without the variable it reports that and exits cleanly.
- `solid-platform certify roku <metrics.json>` compares a metrics file with the certification budgets in `src/sdk/certification.ts` and exits non-zero on a failure. Collecting the metrics is up to you.

Keep device addresses and credentials out of the repository.

## Not verified

- Animation of `x`, `y` and `alpha` runs on the SceneGraph render thread through `Animation` + `FloatFieldInterpolator`. Colour, `scale`, delay, loop and unknown easing fall back to the JavaScript clock. Frame pacing during animation has not been measured.
- The video adapter owns a `Video` node beneath the app surface. DRM was not exercised (no licence server), and per-player volume is not available on SceneGraph (mute only).
- Clipping children to a rounded shape is not implemented.
- The image-fallback tier has only been forced on an OpenGL TV, never on a device that needs it.
- Held keys do not repeat: the firmware sends one press and one release.
