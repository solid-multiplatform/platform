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
  define: { SOLIDTV_DOM_RENDERING: false, __DEV__: false },
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
