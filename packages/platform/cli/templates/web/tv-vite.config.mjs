import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import legacy from '@vitejs/plugin-legacy';
import { variantUpdates } from '@solid-multiplatform/platform/cli/variants';
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'legacy' ? 'dist-legacy' : 'dist',
    target: mode === 'legacy' ? undefined : 'chrome85',
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
