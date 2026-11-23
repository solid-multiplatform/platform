import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import legacy from '@vitejs/plugin-legacy';
import { variantUpdates } from '@solid-multiplatform/platform/cli/variants';
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'legacy' ? 'dist-legacy' : 'dist',
    // The PS4 browser is an old WebKit: ES2017 syntax only. The legacy mode
    // is the Canvas 2D variant for engines without WebGL 2.
    target: mode === 'legacy' ? undefined : 'es2017',
  },
  // The PS4's pointer is a remote: a television target (see TELEVISION_TARGETS
  // in the platform's src/primitives/utils/touchScroll.ts), so the touch
  // scroller folds out of the bundle.
  define: {
    SOLIDTV_DOM_RENDERING: false,
    __DEV__: false,
    SOLIDTV_TOUCH_SCROLL: false,
  },
  plugins: [
    variantUpdates('__TARGET__'),
    solid({
      hot: false,
      solid: {
        generate: 'universal',
        moduleName: '@solid-multiplatform/platform',
      },
    }),
    ...(mode === 'legacy'
      ? [legacy({ targets: ['Chrome >= 38'], renderModernChunks: false })]
      : []),
  ],
  resolve: {
    conditions: [...(mode === 'legacy' ? ['canvas'] : []), 'browser', 'import'],
    dedupe: [
      'solid-js',
      '@solid-multiplatform/platform',
      '@solid-multiplatform/renderer',
    ],
  },
}));
