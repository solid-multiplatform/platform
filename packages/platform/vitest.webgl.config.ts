// Real-renderer tests: Vitest browser mode in headless Chromium, Firefox and
// WebKit, drawing through @solid-multiplatform/renderer (WebGL, SDF text), not
// the DOM renderer.
//
//   pnpm test:webgl   (vitest run --config=vitest.webgl.config.ts)
//
// Needs Playwright's three engines: `npx playwright install chromium firefox webkit`.
// The default `vitest run` (vitest.config.ts, jsdom) excludes tests/webgl.
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import solid from 'vite-plugin-solid';
import { firefoxLaunch } from './tests/webgl/firefox-launch.mjs';

// Every engine runs the same suite. Chromium's headless build has no GPU, so
// it alone is launched on SwiftShader; Firefox and WebKit provide software
// WebGL themselves and reject Chromium's switches. Firefox's launch is shared
// with the showcase e2e (tests/webgl/firefox-launch.mjs), so the two cannot
// drift apart.
function launch(name: 'chromium' | 'firefox' | 'webkit') {
  if (name === 'chromium')
    return {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    };
  if (name === 'firefox') return firefoxLaunch();
  return {};
}

function engine(name: 'chromium' | 'firefox' | 'webkit') {
  return {
    extends: true as const,
    test: {
      name,
      browser: {
        enabled: true,
        headless: true,
        // A failure's screenshot of the canvas says nothing the assertion
        // does not, and would litter the tree with __screenshots__.
        screenshotFailures: false,
        // https://vitest.dev/guide/browser/playwright
        provider: playwright({ launchOptions: launch(name) }),
        instances: [{ browser: name }],
      },
    },
  };
}

export default defineConfig({
  define: {
    // Solid: build without the DOM renderer, as a WebGL app does.
    SOLIDTV_DOM_RENDERING: false,
    // Renderer build flags (src/common/flags.ts): production build, no
    // inspector, no bounds events, as the bench and the demo app build it.
    __DEV__: false,
    __enableInspector__: false,
    __emitBoundsEvents__: false,
    __enableCompressedTextures__: false,
  },
  plugins: [
    solid({
      hot: false,
      solid: {
        moduleName: '@solid-multiplatform/platform',
        generate: 'universal',
        builtIns: [],
      },
    }),
  ],
  test: {
    include: ['tests/webgl/**/*.test.tsx'],
    watch: false,
    projects: [engine('chromium'), engine('firefox'), engine('webkit')],
  },
  resolve: {
    alias: {
      '@roku-sdk/solid': new URL(
        './tests/webgl/scenegraph-sdk/nodes.ts',
        import.meta.url,
      ).pathname,
      '@roku-sdk/rsg-ts/runtime': new URL(
        './tests/webgl/scenegraph-sdk/runtime.ts',
        import.meta.url,
      ).pathname,
    },
    conditions: ['@solidtv/source', 'browser', 'development'],
    dedupe: ['solid-js', 'solid-js/universal', 'solid-js/store'],
  },
});
