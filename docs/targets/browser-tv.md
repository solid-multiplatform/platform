# Browser TVs

Target names: `tizen` (Samsung), `webos` (LG), `vizio`.

These TVs run a browser engine, so they use the web backends and the web service providers with a TV-specific viewport and remote input.

## What it is built from

- Backend: WebGL by default. `build <target> --legacy` builds a Canvas 2D variant for old engines: it resolves the `canvas` package condition, calls `useCanvas()` from `@solid-multiplatform/platform/browser-tv/canvas` and compiles for Chrome 38 and later with `@vitejs/plugin-legacy`.
- Host: the browser host with the TV's `target` (`webHost({ target: 'tizen' })`). The capability defaults differ per TV: `tizen` and `vizio` declare a remote only; `webos` declares a remote and a pointer. Router history comes from the host over `window.history`.
- CLI target: a Vite project in `targets/<target>`. The generated `work/main.ts` binds the TV viewport (`bindTVViewport`) and remote input (`bindBrowserTV`) from `@solid-multiplatform/platform/browser-tv/input`. The scene is a 1920×1080 logical stage, scaled to fit the display and centred.

## Build and package

```sh
corepack pnpm build tizen            # targets/tizen/dist
corepack pnpm build tizen --legacy   # targets/tizen/dist-legacy
```

- Tizen: the build writes `config.xml` into the output. If the environment variable `TIZEN_SECURITY_PROFILE` names an existing signing profile, the Tizen CLI (`tizen package -t wgt`) produces the signed WGT. Without it you get the unpacked widget directory.
- webOS: the build writes `appinfo.json` and runs `ares-package`; the IPK lands in `dist-package` (or `dist-legacy-package`).
- Vizio: the output is the web assets in `dist`. There is no packaging step.

`dev` is not available for these targets. Build, then install with the vendor's tools.

## How it is tested

- `projects` job: `tests/cli/projects-smoke.sh` builds `tizen`, `tizen --legacy`, `webos` and `vizio` from a generated app and drives each build in desktop Chromium with `tests/cli/browser-smoke.mjs --tv`. That script checks the stage scaling at several display sizes and pixel ratios, a plugin command through keyboard input, and pointer clicks through four viewport sizes.
- `browser` job: the WebGL and Canvas backends themselves (see [Web](/targets/web.md)).
- Device procedure: `node apps/showcase/tests/showcase.e2e.mjs dist/tizen tizen` runs a browser-TV bundle's probe mode and the two-second idle check in desktop Chromium. It is not part of CI for the TV targets.

What this does not cover:

- No test runs on Tizen, webOS or Vizio hardware, or in a vendor emulator. Remote key codes, the vendor packaging tools and old-engine behaviour on a real TV are unverified by this project. The generated builds run in desktop Chromium, which is why the feature matrix keeps their scene, input and service cells `preview`.
