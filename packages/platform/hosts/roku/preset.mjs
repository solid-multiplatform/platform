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
import { pathToFileURL } from 'node:url';

const host = path.dirname(fileURLToPath(import.meta.url));

// The sizes the channel store requires of each image.
const IMAGE_SIZES = {
  mm_icon_focus_fhd: [540, 405],
  mm_icon_focus_hd: [290, 218],
  splash_screen_fhd: [1920, 1080],
  splash_screen_hd: [1280, 720],
  splash_screen_sd: [720, 480],
};

/** Copies a PNG into the package and checks it has the size its manifest key requires. */
function manifestImage(key, file, staticDir) {
  const data = readFileSync(path.resolve(file));
  if (data.length < 24 || data.toString('latin1', 1, 4) !== 'PNG')
    throw new Error(`${key}: ${file} is not a PNG file.`);
  const [width, height] = IMAGE_SIZES[key];
  const got = [data.readUInt32BE(16), data.readUInt32BE(20)];
  if (got[0] !== width || got[1] !== height)
    throw new Error(
      `${key}: ${file} is ${got[0]}x${got[1]}, and must be ${width}x${height}.`,
    );
  mkdirSync(path.join(staticDir, 'images'), { recursive: true });
  cpSync(path.resolve(file), path.join(staticDir, 'images', key + '.png'));
  return `pkg:/images/${key}.png`;
}

/**
 * Run from the Roku project. `entry` is the app's own entry module: the one
 * that calls `startApp(rokuHost(), App)`.
 */
export function rokuConfig({
  entry,
  assets,
  title,
  version = '1.0.1',
  icons = {},
  splash = {},
  instantResume = false,
  manifestEntries = {},
}) {
  const [major, minor, build] = String(version).split('.').map(Number);
  if (![major, minor, build].every(Number.isInteger))
    throw new Error(
      `version must be major.minor.build, such as 1.0.1; got ${version}.`,
    );
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
  const rendererRoku = path.dirname(
    app.resolve('@solid-multiplatform/renderer/roku'),
  );
  const drawn = path.resolve(rendererRoku, '../../roku/assets');
  mkdirSync(path.join(staticDir, 'assets/smp'), { recursive: true });
  for (const name of readdirSync(drawn)) {
    if (name.endsWith('.png'))
      cpSync(path.join(drawn, name), path.join(staticDir, 'assets/smp', name));
  }
  if (assets) cpSync(path.resolve(assets), staticDir, { recursive: true });
  const images = {};
  for (const [key, file] of [
    ['mm_icon_focus_fhd', icons.fhd],
    ['mm_icon_focus_hd', icons.hd],
    ['splash_screen_fhd', splash.fhd],
    ['splash_screen_hd', splash.hd],
    ['splash_screen_sd', splash.sd],
  ])
    if (file) images[key] = manifestImage(key, file, staticDir);
  if (splash.color) images.splash_color = splash.color;
  // An imported font file (`import url from './X.ttf'`). The SDK's font plugin
  // copies the file into the package and gives its pkg:/fonts URI. This wraps
  // that module: the file is also read here, and the widths, kerning and line
  // metrics text layout needs are shipped in the bundle under the same URI.
  // The app's text is then laid out from the first frame, before the firmware
  // has loaded the font and without measuring a string on the device.
  // An import and not a `fonts` option in this config: the table is made for
  // exactly the files the bundle uses, from the file the SDK packages, with
  // no second list to keep in step with the app.
  const fontPlugin = {
    name: 'solid-multiplatform-fonts',
    setup(build) {
      const packer = import(
        pathToFileURL(path.join(rendererRoku, 'font-file.js')).href
      );
      build.onResolve({ filter: /\.(ttf|otf)$/ }, (args) => {
        // The import the module below makes is the SDK plugin's to resolve.
        if (args.namespace === 'solid-font' || !/^[./]/.test(args.path)) return;
        return {
          path: path.resolve(args.resolveDir, args.path),
          namespace: 'solid-font',
        };
      });
      build.onLoad(
        { filter: /.*/, namespace: 'solid-font' },
        async ({ path: file }) => {
          let table;
          try {
            table = (await packer).fontMetricsBase64(readFileSync(file));
          } catch (error) {
            return {
              errors: [{ text: `Cannot read font ${file}: ${error.message}` }],
            };
          }
          return {
            contents:
              `import uri from ${JSON.stringify(file)};\n` +
              "import { registerFontMetrics } from '@solid-multiplatform/renderer/roku';\n" +
              `registerFontMetrics(uri, ${JSON.stringify(table)});\n` +
              'export default uri;\n',
            loader: 'js',
            resolveDir: root,
            watchFiles: [file],
          };
        },
      );
    },
  };
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
      entryPoint: shared,
      staticAssetsDir: staticDir,
      manifestEntries: {
        title,
        major_version: major,
        minor_version: minor,
        build_version: build,
        ui_resolutions: 'fhd',
        rsg_version: '2.0',
        // The app's JavaScript runs in the channel's own process.
        run_as_process: 1,
        // Deep links reach a running app as input events, not a relaunch.
        supports_input_launch: 1,
        // Instant Resume: the firmware suspends the app instead of ending
        // it, and the host then provides the `lifecycle` service.
        ...(instantResume ? { sdk_instant_resume: 1 } : {}),
        ...images,
        ...manifestEntries,
      },
    },
    pipeline: Object.fromEntries(
      ['build', 'startDev'].map((name) => [
        name,
        {
          plugins: [
            { position: { before: 'fonts' }, plugin: fontPlugin },
            { position: { before: 'solid' }, plugin },
          ],
        },
      ]),
    ),
  };
}
