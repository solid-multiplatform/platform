// The web build of the showcase. It mirrors what `solid-platform build web`
// generates for an app (cli/templates/web/vite.config.mjs): the CLI itself
// builds only projects that `solid-platform init` laid out (targets/<name>),
// so a workspace app carries the same settings in its own config.
//
//   vite build                 web:   dist/web/
//   vite build --mode tizen    Tizen: dist/tizen/ (same bundle, TV host)
//   vite build --mode webos    webOS: dist/webos/
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const browserTVs = ['tizen', 'webos'];
const platform = path.dirname(
  createRequire(import.meta.url).resolve(
    '@solid-multiplatform/platform/package.json',
  ),
);

// The MSDF font the framework ships for its starter; the CLI copies the same
// files into an app's `public/fonts`.
function fonts() {
  return {
    name: 'showcase-fonts',
    generateBundle() {
      for (const name of ['Lato-Regular.msdf.json', 'Lato-Regular.msdf.png'])
        this.emitFile({
          type: 'asset',
          fileName: 'fonts/' + name,
          source: readFileSync(path.join(platform, 'tests/webgl/fonts', name)),
        });
    },
  };
}

export default defineConfig(({ mode }) => {
  const tv = browserTVs.includes(mode);
  return {
    base: './',
    build: {
      outDir: 'dist/' + (tv ? mode : 'web'),
      target: tv ? 'chrome85' : undefined,
    },
    define: {
      SOLIDTV_DOM_RENDERING: false,
      __DEV__: false,
      // The phone/web path keeps the touch scroller; the TV modes (the same
      // television targets as TELEVISION_TARGETS in
      // packages/platform/src/primitives/utils/touchScroll.ts) fold it out.
      SOLIDTV_TOUCH_SCROLL: !tv,
      // Which host the one web entry starts: 'web', or a browser TV.
      __SHOWCASE_TARGET__: JSON.stringify(tv ? mode : 'web'),
    },
    plugins: [
      fonts(),
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
  };
});
