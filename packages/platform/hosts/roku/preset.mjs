import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const host = path.dirname(fileURLToPath(import.meta.url));

/** Run from the Roku project. The shared entry exports mount() and returns a disposer. */
export function rokuConfig({ entry, assets, title, manifestEntries = {} }) {
  const root = process.cwd();
  const app = createRequire(path.join(root, 'package.json'));
  const shared = realpathSync(path.resolve(entry));
  const platform = path.dirname(
    app.resolve('@solid-multiplatform/platform/package.json'),
  );
  const staticDir = mkdtempSync(path.join(tmpdir(), 'solid-roku-assets-'));
  process.once('exit', () =>
    rmSync(staticDir, { recursive: true, force: true }),
  );
  cpSync(path.join(host, 'pkg'), staticDir, { recursive: true });
  // The images the SceneGraph backend draws gradients and shadows with. It
  // names them pkg:/assets/smp/<file>; they ship in the renderer package.
  const drawn = path.resolve(
    path.dirname(app.resolve('@solid-multiplatform/renderer/roku')),
    '../../roku/assets',
  );
  mkdirSync(path.join(staticDir, 'assets/smp'), { recursive: true });
  for (const name of readdirSync(drawn)) {
    if (name.endsWith('.png'))
      cpSync(path.join(drawn, name), path.join(staticDir, 'assets/smp', name));
  }
  if (assets) cpSync(path.resolve(assets), staticDir, { recursive: true });
  const plugin = {
    name: 'solid-multiplatform',
    setup(build) {
      build.initialOptions.conditions = ['roku', 'browser'];
      build.initialOptions.define = {
        ...build.initialOptions.define,
        SOLIDTV_DOM_RENDERING: 'false',
        SOLIDTV_DISABLE_SHADERS: 'true',
        'import.meta.env': '{}',
        'import.meta.env.DEV': 'false',
        'import.meta.env.PROD': 'true',
        'import.meta.env.BASE_URL': '"pkg:/"',
      };
      build.onResolve({ filter: /^solid-app-entry$/ }, () => ({
        path: shared,
      }));
      // Resolve app and host imports against the same installed framework, including
      // shared entries that live outside the Roku project directory.
      build.onResolve({ filter: /^@solid-multiplatform\// }, async (args) => {
        if (args.pluginData?.framework) return;
        return build.resolve(args.path, {
          resolveDir: root,
          kind: args.kind,
          pluginData: { framework: true },
        });
      });
      const solidRoot = path.dirname(app.resolve('solid-js/package.json'));
      build.onResolve(
        { filter: /^solid-js(?:\/(?:store|universal|web))?$/ },
        ({ path: spec }) => {
          const part = spec.split('/')[1];
          return {
            path: path.join(
              solidRoot,
              part || '',
              'dist',
              (part || 'solid') + '.js',
            ),
          };
        },
      );
      // SDK anchor JSX targets Roku nodes. Shared app JSX targets the platform runtime.
      build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path: file }) => {
        if (file.startsWith(host + path.sep)) return;
        const isApp = file.startsWith(path.dirname(shared) + path.sep);
        if (!isApp && !file.startsWith(platform + path.sep)) return;
        const babel = app('@babel/core');
        const result = await babel.transformAsync(readFileSync(file, 'utf8'), {
          filename: file,
          babelrc: false,
          configFile: false,
          presets: [
            [
              app.resolve('babel-preset-solid'),
              {
                moduleName: '@solid-multiplatform/platform',
                generate: 'universal',
              },
            ],
            [
              app.resolve('@babel/preset-typescript'),
              { allExtensions: true, isTSX: true },
            ],
          ],
        });
        const lowered = await babel.transformAsync(result.code, {
          filename: file,
          babelrc: false,
          configFile: false,
          assumptions: { noClassCalls: true },
          plugins: [
            app.resolve('@babel/plugin-transform-class-properties'),
            app.resolve('@babel/plugin-transform-classes'),
          ],
        });
        return {
          contents: lowered.code,
          loader: 'js',
          resolveDir: path.dirname(file),
        };
      });
    },
  };
  return {
    app: {
      entryPoint: path.join(host, 'main.ts'),
      staticAssetsDir: staticDir,
      manifestEntries: {
        title,
        major_version: 1,
        minor_version: 0,
        build_version: 1,
        ui_resolutions: 'fhd',
        rsg_version: '2.0',
        run_as_process: 1,
        ...manifestEntries,
      },
    },
    pipeline: Object.fromEntries(
      ['build', 'startDev'].map((name) => [
        name,
        { plugins: [{ position: { before: 'solid' }, plugin }] },
      ]),
    ),
  };
}
