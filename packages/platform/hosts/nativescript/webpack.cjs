// The webpack pieces a SolidTV app needs under @nativescript/webpack. Use it
// from the app's webpack.config.js:
//
//   const webpack = require('@nativescript/webpack');
//   const { chainSolidTV } = require('@solidtv/nativescript/webpack');
//   module.exports = (env) => {
//     webpack.init(env);
//     webpack.chainWebpack(chainSolidTV);
//     return webpack.resolveConfig();
//   };

// webpack itself comes from the app, through @nativescript/webpack, not from
// this package: resolve it from the project the build runs in.
const { createRequire } = require('node:module');
const fromApp = createRequire(
  require('node:path').join(process.cwd(), 'package.json'),
);

function requireWebpack() {
  try {
    return require('webpack');
  } catch {
    return require(require.resolve('webpack', { paths: [process.cwd()] }));
  }
}

// The NativeScript targets that are televisions: focus movement, not direct
// manipulation. The same target list as TELEVISION_TARGETS in the platform's
// src/primitives/utils/touchScroll.ts; android and ios stay pointer/touch.
const TELEVISION_TARGETS = new Set(['android-tv', 'apple-tv']);

/**
 * Adds what a SolidTV app needs to a webpack-chain config: Solid JSX
 * compilation for @solid-multiplatform/platform's renderer, browser export conditions, the
 * polyfill's optional-module ignore, vite's `import.meta.env`, and on
 * request the hex-colour transform and aliases.
 *
 * @param {import('webpack-chain')} config The config `webpack.chainWebpack` hands over.
 * @param {{
 *   moduleName?: string,
 *   env?: Record<string, unknown>,
 *   target?: string,
 *   hexColors?: { include: string[] },
 *   alias?: Record<string, string>,
 * }} [options]
 *   `moduleName` is the package the compiled JSX imports its renderer from;
 *   default `@solid-multiplatform/platform`. `env` adds members to `import.meta.env`, or
 *   overrides the ones webpack defines itself: `MODE`, `DEV` and `PROD` from
 *   the build mode, and `BASE_URL` from @nativescript/webpack's public path,
 *   `file:///app/`, the runtime's virtual app root, which the shims map to
 *   the app folder. `target` is the solid-platform target being built
 *   (android, android-tv, ios or apple-tv): a television folds the touch
 *   scroller out of the bundle, a phone or tablet keeps it. `hexColors.include` names the directories whose sources
 *   get the `"#RRGGBB"` to `0xRRGGBBAA` transform of
 *   @lightningtv/vite-hex-transform, as a loader. `alias` maps import names
 *   to paths.
 */
function chainSolidTV(config, options) {
  const moduleName =
    options !== undefined && options.moduleName !== undefined
      ? options.moduleName
      : '@solid-multiplatform/platform';
  const { DefinePlugin, IgnorePlugin } = requireWebpack();

  // vite's import.meta.env, which @solid-multiplatform/platform and apps built with vite
  // read, is webpack's own since 5.1xx: a map it merges member definitions
  // into, so an app's extra members go in as `import.meta.env.NAME`.
  if (options !== undefined && options.env !== undefined) {
    const definitions = {};
    const names = Object.keys(options.env);
    for (let i = 0; i < names.length; i++) {
      definitions['import.meta.env.' + names[i]] = JSON.stringify(
        options.env[names[i]],
      );
    }
    config.plugin('SolidTVImportMetaEnv').use(DefinePlugin, [definitions]);
  }

  // The compile-time touch-scroll decision, from the target this chain is
  // built for. Without the `typeof` key webpack would leave the guard in
  // touchScroll.ts reading an undefined global and take the runtime
  // fallback instead of folding the scroller out.
  if (options !== undefined && options.target !== undefined) {
    const touchScroll = !TELEVISION_TARGETS.has(options.target);
    config.plugin('SolidTVTouchScroll').use(DefinePlugin, [
      {
        SOLIDTV_TOUCH_SCROLL: JSON.stringify(touchScroll),
        'typeof SOLIDTV_TOUCH_SCROLL': JSON.stringify('boolean'),
      },
    ]);
  }

  if (options !== undefined && options.hexColors !== undefined) {
    // A post-loader: it runs on the JavaScript TypeScript and Babel emit,
    // where a colour is a string literal in a call, as vite's transform runs
    // after its Solid plugin. On the source it would turn a JSX attribute
    // value into an unquoted number, which no parser takes.
    const rule = config.module
      .rule('solidtv-hex-colors')
      .post()
      .test(/\.[jt]sx?$/);
    const include = options.hexColors.include;
    for (let i = 0; i < include.length; i++) {
      rule.include.add(include[i]);
    }
    rule.use('hex-colors').loader(require.resolve('./hexColorLoader.cjs'));
  }

  if (options !== undefined && options.alias !== undefined) {
    const names = Object.keys(options.alias);
    for (let i = 0; i < names.length; i++) {
      config.resolve.alias.set(names[i], options.alias[names[i]]);
    }
  }

  // canvas-polyfill probes for an optional audio package inside a try/catch.
  // Without this, webpack reports the missing module on every build.
  config
    .plugin('IgnoreAudioContext')
    .use(IgnorePlugin, [{ resourceRegExp: /^@nativescript\/audio-context$/ }]);

  // The base config compiles only `.ts`. The app's `.tsx` and the `.jsx`
  // files @solid-multiplatform/platform ships go through babel-preset-solid in universal
  // mode, which emits calls into @solid-multiplatform/platform's renderer rather than DOM
  // operations. Presets apply last to first, so types are stripped before
  // the JSX transform runs. Loader and presets resolve from this package, so
  // the app does not list them.
  config.resolve.extensions.add('.tsx').add('.jsx');
  // A TypeScript source imports its siblings by their emitted names, `./x.js`
  // for `x.ts`, as vite resolves them; webpack needs telling.
  config.resolve.set('extensionAlias', {
    '.js': ['.ts', '.tsx', '.js'],
    '.jsx': ['.tsx', '.jsx'],
  });
  config.module
    .rule('solid-jsx')
    .test(/\.[jt]sx$/)
    .use('babel-loader')
    .loader(fromApp.resolve('babel-loader'))
    .options({
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      presets: [
        [
          fromApp.resolve('babel-preset-solid'),
          { moduleName, generate: 'universal', builtIns: [] },
        ],
        fromApp.resolve('@babel/preset-typescript'),
      ],
    });

  // The base config targets `node`, so webpack asks packages for their
  // `node` export condition: solid-js and solid-js/web then resolve to their
  // server builds, whose client APIs throw and whose signals never update.
  // The app runs in a polyfilled browser, so ask for `browser`. `solid`
  // selects the JSX source Solid libraries such as @solidjs/router publish
  // for the app's own compiler, which the rule above compiles for
  // @solid-multiplatform/platform. Setting the list drops webpack's per-dependency
  // `import` too, so it is named here; every package with an exports map
  // is imported as ESM.
  config.resolve.set('conditionNames', [
    'solid',
    'browser',
    'import',
    'module',
    'webpack',
  ]);
}

module.exports = { chainSolidTV };
