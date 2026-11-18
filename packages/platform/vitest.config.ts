import { configDefaults, defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

const shared = [
  ...configDefaults.exclude,
  // Real-renderer tests run in a browser: vitest.webgl.config.ts.
  'tests/webgl/**',
  'tests/native/**',
  'tests/cli/**',
  'examples/**',
  'bench/**',
  // .claude/** holds nested git worktrees with their own copies of tests.
  '.claude/**',
];

export default defineConfig(() => ({
  define: {
    __DEV__: false,
    SOLIDTV_DOM_RENDERING: true,
  },
  plugins: [
    solidPlugin({
      hot: false,
      solid: {
        moduleName: '@solid-multiplatform/platform',
        generate: 'universal',
        builtIns: [],
      },
    }),
  ],
  test: {
    watch: false,
    exclude: shared,
    passWithNoTests: true,
    environment: 'jsdom',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...shared, 'tests/host/**'],
          // One renderer for every file in a worker: tests/setup.ts.
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          // Each file starts its own app on its own host.
          name: 'host',
          include: ['tests/host/**/*.test.{ts,tsx}'],
          isolate: true,
        },
      },
    ],
  },
  resolve: {
    dedupe: ['solid-js'],
    conditions: [
      '@solidtv/source',
      '@solid-multiplatform/renderer-source',
      'browser',
      'development',
    ],
    alias: {
      // @solidjs/router resolves to untranspiled .jsx under the
      // `@solidtv/source` condition, which vitest can't load. Tests only
      // need <Route> to exist.
      '@solidjs/router': new URL(
        './tests/stubs/solidjs-router.ts',
        import.meta.url,
      ).pathname,
      '@roku-sdk/solid': new URL(
        './tests/stubs/roku-solid.mjs',
        import.meta.url,
      ).pathname,
    },
  },
}));
