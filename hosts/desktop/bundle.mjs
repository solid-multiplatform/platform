import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const dir = process.argv[2],
  app = createRequire(path.join(dir, 'package.json'));
const babel = app('@babel/core');
await app('esbuild').build({
  absWorkingDir: dir,
  entryPoints: ['work/scene.ts'],
  outfile: 'work/scene.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  conditions: ['browser', 'import'],
  external: ['./plugins.mjs'],
  define: {
    'import.meta.env': '{}',
    SOLIDTV_DOM_RENDERING: 'false',
    __DEV__: 'false',
  },
  plugins: [
    {
      name: 'solid-desktop',
      setup(build) {
        build.onLoad({ filter: /\.[tj]sx$/ }, async ({ path: file }) => {
          const r = await babel.transformAsync(await readFile(file, 'utf8'), {
            filename: file,
            configFile: false,
            babelrc: false,
            presets: [
              [
                app.resolve('babel-preset-solid'),
                {
                  generate: 'universal',
                  moduleName: '@solid-multiplatform/platform',
                },
              ],
              app.resolve('@babel/preset-typescript'),
            ],
          });
          return { contents: r.code, loader: 'js' };
        });
      },
    },
  ],
});
