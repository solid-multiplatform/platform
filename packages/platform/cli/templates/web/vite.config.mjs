import { defineConfig } from 'vite';
import { variantUpdates } from '@solid-multiplatform/platform/cli/variants';
import solid from 'vite-plugin-solid';
export default defineConfig({
  base: './',
  // Web is a pointer/touch target: the touch scroller stays compiled in.
  define: {
    SOLIDTV_DOM_RENDERING: false,
    __DEV__: false,
    SOLIDTV_TOUCH_SCROLL: true,
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
  ],
  resolve: {
    dedupe: [
      'solid-js',
      '@solid-multiplatform/platform',
      '@solid-multiplatform/renderer',
    ],
  },
});
