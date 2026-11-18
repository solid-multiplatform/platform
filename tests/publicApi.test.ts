// Contract tests: what the JSX compiler imports, the runtime export names of
// every entry point, and the package.json `exports` map.
//
// The export lists below are today's runtime export names, sorted. Removing a
// name breaks apps; adding one is an API decision. Either way, update the list
// on purpose. Type-only exports are pinned in contract-types.tsx, which
// `pnpm tsc` type-checks (tests/tsconfig.contract.json).
import * as v from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as main from '@solid-multiplatform/platform';
import * as primitives from '@solid-multiplatform/platform/primitives';
// vitest aliases @solidjs/router to tests/stubs/solidjs-router.ts. That does
// not change this entry's export list: it re-exports nothing from the router
// (checked against TypeScript's export list, which resolves the real package).
import * as router from '@solid-multiplatform/platform/primitives/router';
import * as devtools from '@solid-multiplatform/platform/devtools';
import jsxLocator from '@solid-multiplatform/platform/devtools/jsx-locator';
import * as shaders from '@solid-multiplatform/platform/shaders';
import * as focusManager from '@solid-multiplatform/platform/focusManager';

const names = (mod: object) => Object.keys(mod).sort();

v.describe('Exports: runtime export names of every entry point', () => {
  v.test('@solid-multiplatform/platform (src/index.ts): 117 names', () => {
    v.expect(names(main)).toEqual([
      'Config',
      'DOMNode',
      'DOMRendererMain',
      'DOM_RENDERING',
      'Dynamic',
      'ElementNode',
      'ErrorBoundary',
      'For',
      'Index',
      'Match',
      'NodeType',
      'SHADERS_ENABLED',
      'Show',
      'Suspense',
      'SuspenseList',
      'Switch',
      'Text',
      'TextNode',
      'ThemeProvider',
      'View',
      'activeElement',
      'assertTruthy',
      'bindColorScheme',
      'clamp',
      'clearTasks',
      'combineStyles',
      'combineStylesMemo',
      'convertToShader',
      'createComponent',
      'createElement',
      'createForm',
      'createRawShaderAccessor',
      'createRenderer',
      'createTextNode',
      'darkTheme',
      'defaultShaderHolePunch',
      'defaultShaderLinearGradient',
      'defaultShaderRadialGradient',
      'defaultShaderRounded',
      'defaultShaderRoundedWithBorder',
      'defaultShaderRoundedWithBorderAndShadow',
      'defaultShaderRoundedWithShadow',
      'defaultShaderShadow',
      'deg2Rad',
      'effect',
      'enqueueDelete',
      'flattenStyles',
      'getElementScreenRect',
      'getRenderer',
      'getRendererFactory',
      'getWebglSupportedVersions',
      'hasFocus',
      'hasKeyboard',
      'hasPointer',
      'hexColor',
      'insert',
      'insertNode',
      'isArray',
      'isDev',
      'isDomRenderer',
      'isDomRendererActive',
      'isElementNode',
      'isElementText',
      'isFocused',
      'isFunction',
      'isINode',
      'isInteger',
      'isNumber',
      'isObject',
      'isString',
      'isTextNode',
      'keyExists',
      'keyboardAwareBounds',
      'lightTheme',
      'loadFontToDom',
      'loadFonts',
      'log',
      'logRenderTree',
      'memo',
      'mergeProps',
      'mod',
      'registerDefaultShader',
      'registerDefaultShaderHolePunch',
      'registerDefaultShaderLinearGradient',
      'registerDefaultShaderRadialGradient',
      'registerDefaultShaderRounded',
      'registerDefaultShaderRoundedWithBorder',
      'registerDefaultShaderRoundedWithBorderAndShadow',
      'registerDefaultShaderRoundedWithShadow',
      'registerDefaultShaderShadow',
      'registerDefaultShaders',
      'renderer',
      'resetCapabilities',
      'revealAboveKeyboard',
      'rootNode',
      'scheduleTask',
      'setActiveElement',
      'setActiveElementCore',
      'setCapabilities',
      'setColorScheme',
      'setProp',
      'setRendererFactory',
      'setTasksEnabled',
      'shaderAccessor',
      'spliceItem',
      'spread',
      'startLightningRenderer',
      'supports',
      'supportsOnlyWebGL2',
      'supportsWebGL',
      'supportsWebGL2',
      'themeFor',
      'use',
      'useCapabilities',
      'useColorScheme',
      'useKeyboard',
      'useTheme',
    ]);
  });

  v.test(
    '@solid-multiplatform/platform/primitives (src/primitives/index.ts): 69 names',
    () => {
      v.expect(names(primitives)).toEqual([
        'ALPHA_FULL',
        'ALPHA_NONE',
        'Announcer',
        'BorderBoxStyle',
        'Column',
        'FPSCounter',
        'FadeInOut',
        'FocusStackProvider',
        'Grid',
        'Image',
        'KeyboardAvoidingView',
        'LazyColumn',
        'LazyRow',
        'Marquee',
        'MarqueeText',
        'Modal',
        'Portal',
        'Row',
        'SafeArea',
        'Sheet',
        'Suspense',
        'Toast',
        'VirtualColumn',
        'VirtualGrid',
        'VirtualRow',
        'Visible',
        'activeElement',
        'addCustomStateToElement',
        'borderBox',
        'chainFunctions',
        'chainRefs',
        'checkIsInNonScrollableZone',
        'createBlurredImage',
        'createInfiniteItems',
        'createSpriteMap',
        'defaultTransitionBack',
        'defaultTransitionDown',
        'defaultTransitionForward',
        'defaultTransitionUp',
        'fadeIn',
        'fadeOut',
        'focusPath',
        'getFocusHistory',
        'handleNavigation',
        'hasCustomState',
        'isCursorVisible',
        'lazy',
        'moveSelection',
        'navigableForwardFocus',
        'navigableHandleNavigation',
        'onGridFocus',
        'printFocusHistory',
        'releaseKeySuppression',
        'removeCustomStateFromElement',
        'resetCounter',
        'scrollColumn',
        'scrollRow',
        'setActiveElement',
        'setActiveElementCore',
        'setupFPS',
        'spatialForwardFocus',
        'spatialHandleNavigation',
        'suppressKeyUntilRelease',
        'useAnnouncer',
        'useFocusManager',
        'useFocusStack',
        'useHold',
        'useMouse',
        'withScrolling',
      ]);
    },
  );

  v.test(
    '@solid-multiplatform/platform/primitives/router (src/primitives/routerIndex.ts): 16 names',
    () => {
      v.expect(names(router)).toEqual([
        'HashRouter',
        'KeepAlive',
        'KeepAliveRoute',
        'SUPPORTS_PROXY',
        'bindEvent',
        'clearKeepAlive',
        'clearKeepAliveRoute',
        'clearKeepAliveRouteCache',
        'collectDynamicParams',
        'createMemoWithoutProxy',
        'hashParser',
        'keepAliveRouteElements',
        'removeKeepAlive',
        'removeKeepAliveRoute',
        'storeKeepAlive',
        'storeKeepAliveRoute',
      ]);
    },
  );

  v.test(
    '@solid-multiplatform/platform/devtools (src/devtools/index.ts): 2 names',
    () => {
      v.expect(names(devtools)).toEqual([
        'elementInterface',
        'hexColorTransform',
      ]);
    },
  );

  // B21: ./shaders and ./focusManager are entry points of their own.
  v.test(
    '@solid-multiplatform/platform/shaders (src/core/shaders.ts): 17 names',
    () => {
      v.expect(names(shaders)).toEqual([
        'defaultShaderHolePunch',
        'defaultShaderLinearGradient',
        'defaultShaderRadialGradient',
        'defaultShaderRounded',
        'defaultShaderRoundedWithBorder',
        'defaultShaderRoundedWithBorderAndShadow',
        'defaultShaderRoundedWithShadow',
        'defaultShaderShadow',
        'registerDefaultShaderHolePunch',
        'registerDefaultShaderLinearGradient',
        'registerDefaultShaderRadialGradient',
        'registerDefaultShaderRounded',
        'registerDefaultShaderRoundedWithBorder',
        'registerDefaultShaderRoundedWithBorderAndShadow',
        'registerDefaultShaderRoundedWithShadow',
        'registerDefaultShaderShadow',
        'registerDefaultShaders',
      ]);
    },
  );

  v.test(
    '@solid-multiplatform/platform/focusManager (src/core/focusManager.ts): 8 names',
    () => {
      v.expect(names(focusManager)).toEqual([
        'focusPath',
        'getFocusHistory',
        'printFocusHistory',
        'releaseKeySuppression',
        'setActiveElementCore',
        'setFocusPath',
        'suppressKeyUntilRelease',
        'useFocusManager',
      ]);
    },
  );

  v.test(
    '@solid-multiplatform/platform/devtools/jsx-locator is a Babel plugin (default export)',
    () => {
      v.expect(typeof jsxLocator).toBe('function');
      const plugin = jsxLocator({ types: {} });
      v.expect(plugin.name).toBe('solid-tv-jsx-locator');
      v.expect(typeof plugin.visitor.Program.enter).toBe('function');
    },
  );
});

// vite-plugin-solid runs with these options in the demo app (vite.config.js),
// and the compiled JSX imports the universal-renderer helpers from
// @solid-multiplatform/platform. Compile a component that uses every JSX form apps use and
// read back what the compiler imports.
const COMPILER_HELPERS = [
  'createComponent',
  'createElement',
  'createTextNode',
  'effect',
  'insert',
  'insertNode',
  'memo',
  'mergeProps',
  'setProp',
  'spread',
  'use',
];

const COMPONENT = `
import { Show } from '@solid-multiplatform/platform';
const Tile = (props) => <view>{props.children}</view>;
export const App = (props) => {
  let ref;
  return (
    <view ref={ref} x={props.x} y={props.y}>
      <text>Hello {props.name}!</text>
      <view {...props.rest} color={0xff0000ff} />
      <Tile a={props.a} {...props.more}>
        {props.cond ? <view /> : null}
      </Tile>
      <Show when={props.show}>
        <view />
      </Show>
      {props.list}
    </view>
  );
};
`;

/** Compiles COMPONENT as the demo app does in dev (jsx-locator included). */
function compile(): string {
  // @babel/core and babel-preset-solid are vite-plugin-solid's own deps.
  const fromVitePluginSolid = createRequire(
    createRequire(import.meta.url).resolve('vite-plugin-solid'),
  );
  const babel = fromVitePluginSolid('@babel/core') as {
    transformSync: (code: string, opts: object) => { code: string } | null;
  };
  return babel.transformSync(COMPONENT, {
    filename: '/app/src/App.jsx',
    cwd: '/app',
    babelrc: false,
    configFile: false,
    plugins: [jsxLocator],
    presets: [
      [
        fromVitePluginSolid.resolve('babel-preset-solid'),
        {
          moduleName: '@solid-multiplatform/platform',
          generate: 'universal',
          builtIns: [],
        },
      ],
    ],
  })!.code;
}

v.describe('Compiler contract: vite-plugin-solid universal output', () => {
  const code = compile();

  v.test(
    'the compiler imports exactly the universal-renderer helpers from @solid-multiplatform/platform',
    () => {
      const imported = [
        ...code.matchAll(
          /import \{ (\w+) as _\$\w+ \} from "@solid-multiplatform\/platform";/g,
        ),
      ].map((m) => m[1]);
      v.expect(imported.sort()).toEqual(COMPILER_HELPERS);
    },
  );

  v.test.each(COMPILER_HELPERS)('%s is exported as a function', (name) => {
    v.expect(typeof (main as Record<string, unknown>)[name]).toBe('function');
  });

  v.test(
    'jsx-locator tags components (not intrinsic elements) with componentName and componentLocation',
    () => {
      v.expect(code).toContain('componentName: "Tile"');
      v.expect(code).toContain('componentLocation: "src/App.jsx:10:6"');
      v.expect(code).toContain('componentName: "Show"');
      v.expect(code).not.toContain('componentName: "view"');
    },
  );
});

v.describe('package.json exports', () => {
  // Paths, not URLs: under jsdom `URL` is not Node's, and fs rejects it.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ) as { exports: Record<string, string | Record<string, unknown>> };
  const exists = (target: string) => existsSync(resolve(root, target));
  /** The source file an export resolves to under `@solidtv/source`. */
  const sourceTarget = (entry: string | Record<string, unknown>) =>
    typeof entry === 'string' ? entry : (entry['@solidtv/source'] as string);

  v.test('the subpaths exported', () => {
    v.expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './primitives',
      './primitives/router',
      './devtools',
      './devtools/jsx-locator',
      './shaders',
      './focusManager',
      './jsx-runtime',
      './package.json',
      './roku',
      './roku/preset',
      './roku/storage',
      './roku/tasks',
      './apple-tv',
      './android-tv',
      './nativescript',
      './nativescript/webpack',
      './browser-tv',
      './browser-tv/canvas',
      './ios',
      './plugins',
      './cli/variants',
      './android',
      './viewport',
      './viewport/web',
      './input',
      './editor',
      './editor/native',
      './android/system',
      './services',
      './services/web',
      './services/native',
      './navigation',
      './controls',
      './controls/web',
      './controls/native',
      './browser-tv/input',
      './services/mobile-providers',
      './services/desktop',
      './services/roku',
      './motion',
      './focus',
      './permissions',
      './semantics',
      './services/native/secure-storage',
      './services/native/notifications',
      './permissions/android',
      './editor/roku',
      './scroll',
      './network',
      './editor/desktop',
      './theme',
      './capabilities',
      './keyboard',
      './form',
    ]);
  });

  v.test('every source target exists', () => {
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
      v.expect(exists(sourceTarget(entry)), subpath).toBe(true);
    }
  });

  // The published files are tsc's output of the source files: dist/src/<path
  // under src>.js and .d.ts. Checked as strings (dist is not built in a test
  // run); `pnpm build` then proves the files exist.
  v.test('every dist target mirrors its source target', () => {
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
      if (typeof entry === 'string' || subpath === './jsx-runtime') continue;
      const stem = (entry['@solidtv/source'] as string)
        .replace('./src/', './dist/src/')
        .replace(/\.tsx?$/, '');
      v.expect(entry['import'], subpath).toEqual({
        types: stem + '.d.ts',
        default:
          stem +
          (subpath === './controls' ||
          subpath === './editor/desktop' ||
          subpath === './theme'
            ? '.jsx'
            : '.js'),
      });
    }
  });

  // B21: ./shaders pointed at src/shaders/index.ts (and dist/src/shaders/*),
  // deleted in cf3b1e0 ("use shaders from renderer").
  v.test('./shaders points at a file that exists', () => {
    v.expect(exists(sourceTarget(pkg.exports['./shaders']!))).toBe(true);
  });

  // B21: the demo app imports `KeyMap, KeyHoldMap` from
  // "@solid-multiplatform/platform/focusManager" (src/pages/App.tsx:5), which was not in
  // `exports`.
  v.test('./focusManager is exported', () => {
    v.expect(pkg.exports['./focusManager']).toBeDefined();
  });
});
