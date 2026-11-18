# Targets

A target is a name the CLI and the SDK both know: `web`, `tizen`, `webos`, `vizio`, `roku`, `android`, `android-tv`, `ios`, `apple-tv`, `desktop`.

Each page below says what the target is built from, how it is tested, and what is still in progress. The per-feature status is in the [feature matrix](/features.md), which is generated from `docs/features.json`.

- [Web](/targets/web.md): `web`
- [Browser TVs](/targets/browser-tv.md): `tizen`, `webos`, `vizio`
- [Roku](/targets/roku.md): `roku`
- [Android and Android TV](/targets/android.md): `android`, `android-tv`
- [iOS and tvOS](/targets/apple.md): `ios`, `apple-tv`
- [Desktop](/targets/desktop.md): `desktop`

## The words used here

- **Tested**: an automated test in this repository exercises the feature on that target, and the page names the test and the CI job.
- **Preview**: the code is on `main`, but no automated test runs it on that target.
- **In progress**: the work is in an open pull request, not on `main`.
- **Unavailable**: not implemented on that target.

## What this project cannot verify today

- Physical Apple devices. CI uses the iOS and tvOS simulators.
- Tizen, webOS and Vizio hardware. CI runs the browser TV builds in desktop Chromium.
- Desktop on Windows and macOS.
- Push notifications end to end.

A test that needs a physical device is not run by CI. The device procedures that exist are described in [Performance](/performance.md).

## CI jobs

The workflow `test.yml` ("Foundation") runs on every push to `main` and every pull request:

- `lint`: Prettier, oxlint, and a syntax check of every host, CLI and video module.
- `renderer`: builds and tests `packages/renderer`.
- `unit`: the platform unit tests in jsdom on the DOM backend, the CLI variant tests, the frame-timeline parser tests, `tests/native/*.test.mjs`, and the video package tests.
- `browser`: `pnpm test:webgl` in headless Chromium (WebGL, Canvas and the Roku backend on a fake SDK), then the Canvas against WebGL pixel comparison.
- `projects`: `tests/cli/projects-smoke.sh`. It packs the platform, runs `init`, and builds and checks web, Tizen (modern and legacy), Roku and the desktop plugin fixture.
- `apple`: `tests/cli/apple-smoke.sh` for `ios` and `apple-tv` on macOS: builds the generated app and launches it in the simulator.

The workflow `android.yml` ("Android plugins") has one job, `android`: `tests/cli/android-smoke.sh` builds the generated Android TV app and inspects the APK.

`apple-artifacts.yml` and `desktop-artifacts.yml` run only when started by hand. They produce downloadable packages and are not test evidence.
