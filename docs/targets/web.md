# Web

Target name: `web`.

## What it is built from

- Backend: WebGL (`@solid-multiplatform/renderer`), drawing on a canvas inside a page element.
- Host: `webHost` from `@solid-multiplatform/platform/host/web`. It supplies DOM key events, pointer and touch input, native text fields, the browser viewport and the browser service providers.
- CLI target: a Vite project in `targets/web`. The generated `work/main.ts` installs the services, binds the viewport and pointer input, registers the service worker in production builds and calls your `mount`.

## Build and run

```sh
corepack pnpm dev web      # Vite dev server
corepack pnpm build web    # targets/web/dist
```

The build needs the define `SOLIDTV_DOM_RENDERING: false` and Solid in universal mode with `moduleName: '@solid-multiplatform/platform'`. The generated `vite.config.mjs` sets both. `SOLIDTV_DOM_RENDERING` is a legacy name and will be renamed before 1.0.

## How it is tested

- `unit` job: the platform test suite runs on the DOM backend in jsdom. This covers `ElementNode`, flex layout, focus, the primitives and the SDK functions with fake ports. It is not evidence for the WebGL backend.
- `browser` job: `packages/platform/tests/webgl/*.test.tsx` run in headless Chromium on real WebGL and Canvas: the scene conformance cases, the shared app fixture, borders, flex with text, resize. `tests/visual/run.mjs` then compares Canvas and WebGL pixels. The same job runs `apps/showcase/tests/showcase.e2e.mjs`: a real keyboard and mouse walk the app, the ARIA mirror is checked at every step, `?probe=1` asserts every service against the web manifests, and the scene must request no frame for two seconds once settled.
- `projects` job: `tests/cli/projects-smoke.sh` creates an app with `init`, builds `web`, serves `targets/web/dist` and drives it in Chromium with `tests/cli/browser-smoke.mjs`, including a real pointer and the ARIA button.
- `tests/host/start-app.test.tsx` runs `startApp` on the DOM host, including service install and teardown.

Chromium is the only browser engine in CI.

## Services

The web host installs the browser providers listed in [Services](/services.md). A service the browser does not have reports `unavailable`.

## Not verified

- Firefox and WebKit: no test runs the showcase or the generated app outside Chromium.
- Services that need a person or a permission prompt are reported `unverified` by the showcase probe and stay `preview` in the feature matrix. The probe requires them to report `unverified`, so the test does not prove they work.
