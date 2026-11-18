<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=@solidtv/renderer" alt="SolidTV Renderer" />
</p>

# SolidTV Renderer

A powerful 2D scene renderer designed for rendering highly performant user
interfaces on web browsers running on embedded devices using WebGL.

## Setup & Commands

```
# Install renderer + example dependencies
pnpm install

# Build Renderer
pnpm build

# Build Renderer (watch mode)
pnpm watch

# Run unit tests
pnpm test

# Run Visual Regression Tests
pnpm test:visual

# Build API Documentation (builds into ./typedocs folder)
pnpm typedoc

# Launch Example Tests in dev mode (includes Build Renderer (watch mode))
pnpm start

# Launch Example Tests in production mode
# IMPORTANT: To run test examples on embedded devices that use older browser versions
# you MUST run the examples in this mode.
pnpm start:prod
```

## Browser Targets

The SolidTV Renderer's goal is to work with the following browser versions and above:

- Chrome v38 (Released October 7, 2014)

Any JavaScript language features or browser APIs that cannot be automatically transpiled or polyfilled by industry standard transpilers (such as Babel) to target these versions must be carefully considered before use.

For a more detailed and comprehensive list of browsers and their features please see [browsers](./BROWSERS.md).

## Build-time Flags

The renderer guards several optional subsystems behind build-time constants. Each
one reads a global that your bundler is expected to substitute:

```ts
export const ENABLE_COMPRESSED_TEXTURES =
  typeof __enableCompressedTextures__ !== 'undefined'
    ? __enableCompressedTextures__
    : false;
```

**Leaving a flag undefined is not the same as setting it to its default.** When the
global is undefined the expression stays a runtime `typeof` check that no bundler
can fold, so the guarded branches survive and every module they import is pulled
into your bundle. Compressed textures are the clearest case: the runtime default
is already `false`, so that code can never execute, yet the PVR/KTX/ASTC parser
still ships unless you define the flag.

Define them in your bundler and the constants fold, the dead branches drop, and
the modules behind them tree-shake away.

| Flag                           | Default if undefined       | Guards                                                                 |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| `__DEV__`                      | `false`                    | Sets `isProductionEnvironment`, the fallback for `__enableInspector__` |
| `__enableCompressedTextures__` | `false`                    | Compressed texture load and upload paths (PVR / KTX / ASTC)            |
| `__enableInspector__`          | `!isProductionEnvironment` | DOM inspector hooks in `RendererMain`                                  |
| `__emitBoundsEvents__`         | `false`                    | `CoreNode` bounds event emission                                       |
| `__renderTextBatching__`       | `true`                     | Deferred SDF text render-op batching                                   |

`__renderTextBatching__` is a performance feature that defaults on. Define it as
`true` to fold the branch rather than to turn anything off.

`__dirtyQuadBuffer__` was removed in 1.8.3, along with the surgical quad buffer
upload path it gated. The quad buffer is now rebuilt and uploaded in full every
frame. Defining it has no effect.

`__calculateFps__` was removed along with the build-time gate on the
`renderUpdate` event. `fpsUpdateInterval` is now the single switch for frame
telemetry, `renderUpdate` included, and it is honoured in production builds.
Defining it has no effect. See the [Telemetry Guide](./docs/telemetry.md) for
using it in production.

### Vite

```js
export default defineConfig({
  define: {
    __DEV__: false,
    __enableInspector__: false,
    __emitBoundsEvents__: false,
    __enableCompressedTextures__: false, // set true only if you ship .ktx/.pvr
    __renderTextBatching__: true,
  },
});
```

Turning `__enableCompressedTextures__` on is only half of what a `.ktx`/`.pvr`
build needs. Neither extension is in Vite's default asset list, so a bare string
path is never seen by the bundler and the file is not emitted. Register the
extensions and import the asset so you get a real emitted URL back:

```js
// vite.config.js
assetsInclude: ['**/*.pvr', '**/*.ktx'],
```

```js
import textureSrc from './assets/texture.ktx';
```

The loader keys off the `.ktx`/`.pvr` extension, so keep these above your
bundler's inline-asset threshold; a data URI is not recognized as a container.

See [examples/vite.config.ts](./examples/vite.config.ts) for the values the
example harness uses. Those are dev-build values and are not what you want in
production.

### What it saves

Measured against `dist/` with Rollup, minified with esbuild, for a typical app
entry point:

| Bundle                                                                    | Undefined flags       | All flags defined     | Saving                            |
| ------------------------------------------------------------------------- | --------------------- | --------------------- | --------------------------------- |
| WebGL (`RendererMain` + `WebGlRenderer` + `SdfTextRenderer` + one shader) | 161.9 kB / 46.7 kB gz | 150.3 kB / 43.0 kB gz | **-11.6 kB (-7.2%) / -3.7 kB gz** |
| Canvas (`RendererMain` + `CanvasRenderer` + `CanvasTextRenderer`)         | 120.3 kB / 35.5 kB gz | 112.1 kB / 32.7 kB gz | **-8.2 kB (-6.8%) / -2.7 kB gz**  |

`__enableCompressedTextures__` accounts for most of it on its own (-8.3 kB / -2.6
kB gz on WebGL) because it drops `textureCompression.js` entirely.

> **Note for esbuild users:** esbuild does not do the cross-module constant
> propagation this relies on, so defining the flags folds the constant but leaves
> the dead branch and its imports in place. Rollup, and therefore Vite, does strip
> them. Bundle with Rollup/Vite if these savings matter to you.

## Example Tests

The Example Tests sub-project define a set of tests for various Renderer
features. This is NOT an automated test. The command below will launch a
web server which can be accessed by a web browser for manual testing. However,
many of the Example Tests define Snapshots for the Visual Regression Test Runner
(see below).

The Example Tests can be launched with:

```
pnpm start
```

This supports modern browsers as well as Chrome 38 and above through a legacy build.

See [examples/README.md](./examples/README.md) for more info.

## Visual Regression Tests

In order to prevent bugs on existing Renderer features when new features or bug
fixes are added, the Renderer includes a Visual Regression Test Runner along
with a set of certified snapshot files that are checked into the repository.

These tests can be launched with:

```
pnpm test:visual
```

The captured Snapshots of these tests are optionally defined in the individual
Example Tests.

See [visual-regression/README.md](./visual-regression/README.md) for more info.

## Manual Regression Tests

See [docs/ManualRegressionTests.md].

## On-Device Performance Comparison

To A/B renderer branches on the reference TV using the `solid-demo-app` benchmark,
see [docs/TvBenchmarkComparison.md](./docs/TvBenchmarkComparison.md). It covers the
multi-arm deploy, driving the device over the inspector socket with the measurement
detached, and the noise floor you have to clear before a difference is real.

## Field Telemetry

To collect frame-rate and smoothness statistics from real devices in
production, see the [Telemetry Guide](./docs/telemetry.md). It covers enabling
`fpsUpdateInterval`, labelling segments, reading the animated frame-time
percentiles, and pooling samples correctly.

## Release Procedure

See [RELEASE.md](./RELEASE.md)

## Installing Fonts

Fonts can be installed into the Font Manager exposed by the Renderer's Stage.
There are two types of fonts that you can install, Web/Canvas2D fonts (WebTrFontFace)
and SDF fonts (SdfTrFontFace). Install that fonts that your applications needs
at start up so they are ready when your application is rendered.

```ts
import { RendererMain } from '@solidtv/renderer';

import { WebGlCoreRenderer, SdfTextRenderer } from '@solidtv/renderer/webgl';
import { CanvasTextRenderer } from '@solidtv/renderer/canvas';

const renderer = new RendererMain(
  {
    appWidth: 1920,
    appHeight: 1080,
    renderEngine: WebGlCoreRenderer,
    fontEngines: [SdfTextRenderer, CanvasTextRenderer],
    // ...Other Renderer Config
  },
  'app', // id of div to insert Canvas.
);

// Load fonts by explicitly specifying the renderer type
await stage.loadFont('canvas', {
  fontFamily: 'myWebFont',
  fontUrl: '/fonts/my-font.ttf',
});

await stage.loadFont('sdf', {
  fontFamily: 'mySdfFont',
  atlasUrl: '/fonts/my-font-atlas.png',
  atlasDataUrl: '/fonts/my-font-data.json',
});
```

For more information see [Font Loading](./docs/fontLoading.md)

## Migration Guide

Upgrading from Lightning 3 v2.x? See the [Migration Guide](./docs/migration-2x-to-3.0.md) for detailed information about breaking changes and how to update your code.
