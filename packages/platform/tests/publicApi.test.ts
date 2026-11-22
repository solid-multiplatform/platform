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
import * as services from '@solid-multiplatform/platform/services';
import * as webServices from '@solid-multiplatform/platform/services/web';
import * as app from '@solid-multiplatform/platform/app';
import * as appEntryModule from '@solid-multiplatform/platform/app/entry';

const names = (mod: object) => Object.keys(mod).sort();

v.describe('Exports: runtime export names of every entry point', () => {
  v.test('@solid-multiplatform/platform (src/index.ts): 308 names', () => {
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
      'MIN_TOUCH_TARGET',
      'Match',
      'NodeType',
      'ROKU_CERTIFICATION_BUDGETS',
      'SHADERS_ENABLED',
      'Show',
      'Suspense',
      'SuspenseList',
      'Switch',
      'Text',
      'TextNode',
      'ThemeProvider',
      'View',
      'activateServiceWorkerUpdate',
      'activeElement',
      'applySystemBarStyle',
      'assertTruthy',
      'auditLayout',
      'auditSemantics',
      'authenticate',
      'batteryState',
      'bindBackKey',
      'bindColorScheme',
      'bindFileDrop',
      'bindGamepadEvents',
      'bindMediaKeys',
      'biometricsAvailable',
      'breakpoint',
      'breakpointFor',
      'buildRoute',
      'calendarAvailable',
      'capturePhoto',
      'captureThumbnail',
      'centerIn',
      'checkForUpdate',
      'checkRokuCertification',
      'clamp',
      'clampSize',
      'clearIconRegistry',
      'clearTasks',
      'combineStyles',
      'combineStylesMemo',
      'compareVersions',
      'configureLogging',
      'configureMediaSession',
      'contactsAvailable',
      'contentBoxFor',
      'convertToShader',
      'createAudioPlayer',
      'createBackDispatcher',
      'createBookmarks',
      'createCalendarEvent',
      'createComponent',
      'createElement',
      'createForm',
      'createGestureAlternatives',
      'createI18n',
      'createInstallPrompt',
      'createLogger',
      'createOfflineQueue',
      'createPagedList',
      'createPersistentStore',
      'createPinchGesture',
      'createPullToRefresh',
      'createQuery',
      'createRawShaderAccessor',
      'createReleasePipeline',
      'createRenderer',
      'createReorder',
      'createSelection',
      'createShortcuts',
      'createSwipeActions',
      'createTextNode',
      'createUpdateChecker',
      'createUpdateDelivery',
      'createWindowStateStore',
      'cursorForElement',
      'darkTheme',
      'defaultBreakpoints',
      'defaultShaderHolePunch',
      'defaultShaderLinearGradient',
      'defaultShaderRadialGradient',
      'defaultShaderRounded',
      'defaultShaderRoundedWithBorder',
      'defaultShaderRoundedWithBorderAndShadow',
      'defaultShaderRoundedWithShadow',
      'defaultShaderShadow',
      'defineReleaseHooks',
      'deg2Rad',
      'deviceInfo',
      'deviceMemory',
      'dir',
      'displayInfo',
      'displayRefreshRate',
      'downloadBytes',
      'downloadFile',
      'downloadText',
      'downloadUrl',
      'effect',
      'enqueueDelete',
      'ensureTouchTarget',
      'enterFullscreen',
      'enterPictureInPicture',
      'env',
      'envFlag',
      'envNumber',
      'estimateTextWidth',
      'exitFullscreen',
      'fileDirectories',
      'fileExists',
      'findMenuItem',
      'fitSize',
      'flattenSections',
      'focusVisibility',
      'formatDate',
      'formatDisplayName',
      'formatLayoutFinding',
      'formatList',
      'formatNumber',
      'formatRelativeTime',
      'gamepadEdges',
      'getCalendarEvents',
      'getContacts',
      'getContactsPage',
      'getCurrentPosition',
      'getElementScreenRect',
      'getIcon',
      'getQueryData',
      'getRenderer',
      'getRendererFactory',
      'getWebglSupportedVersions',
      'hasFocus',
      'hasKeyboard',
      'hasPointer',
      'hexColor',
      'highContrastDarkTheme',
      'highContrastLightTheme',
      'iconBase',
      'iconDataUrl',
      'iconSource',
      'iconSvg',
      'impact',
      'insert',
      'insertNode',
      'invalidateQueries',
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
      'isRTL',
      'isStandalone',
      'isString',
      'isTextNode',
      'keepAwake',
      'keyExists',
      'keyboardAwareBounds',
      'layoutRichText',
      'lightTheme',
      'listFiles',
      'loadFontToDom',
      'loadFonts',
      'locale',
      'lockOrientation',
      'log',
      'logEvent',
      'logRenderTree',
      'mapsAvailable',
      'matchRoute',
      'matchesCombo',
      'mediaCapabilities',
      'meetsTouchTarget',
      'memo',
      'menuItemsPayload',
      'menusAvailable',
      'mergeProps',
      'mod',
      'moveItem',
      'normalizeWindowBounds',
      'notificationFeedback',
      'onDisplayChange',
      'openDirections',
      'openExternal',
      'openMap',
      'parseCombo',
      'parseVersion',
      'pickContact',
      'pickFiles',
      'pickedFileFromWeb',
      'preferDisplayRefreshRate',
      'publicEnvironment',
      'readClipboard',
      'readFileBytes',
      'readFileText',
      'readGamepads',
      'readSensor',
      'readingOrder',
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
      'registerIcon',
      'registerIcons',
      'registerServiceWorker',
      'removeFile',
      'renderer',
      'reportCrash',
      'requestAppReview',
      'requireEnv',
      'requireSigningIdentity',
      'resetCapabilities',
      'resetCrashReporter',
      'resetCursor',
      'resetEnvironment',
      'resetLayoutAudit',
      'resolveResponsive',
      'revealAboveKeyboard',
      'rootNode',
      'runMenuItem',
      'scaled',
      'scheduleLayoutAudit',
      'scheduleTask',
      'screenRect',
      'sectionListHeight',
      'selectionFeedback',
      'sensorAvailable',
      'sensorsAvailable',
      'setActiveElement',
      'setActiveElementCore',
      'setAppVersion',
      'setApplicationMenu',
      'setCapabilities',
      'setColorScheme',
      'setCrashReporter',
      'setCursor',
      'setEnvironment',
      'setHighContrast',
      'setIconBase',
      'setProp',
      'setQueryData',
      'setRendererFactory',
      'setTasksEnabled',
      'setTextScale',
      'setTray',
      'setupI18n',
      'shaderAccessor',
      'share',
      'spliceItem',
      'spread',
      'startLightningRenderer',
      'startRecording',
      'stickyHeaderAt',
      'supports',
      'supportsDrm',
      'supportsOnlyWebGL2',
      'supportsWebGL',
      'supportsWebGL2',
      'svgDataUrl',
      't',
      'textDirection',
      'themeFor',
      'touchTargetSize',
      'unregisterServiceWorkers',
      'updateSource',
      'use',
      'useBreakpoint',
      'useCapabilities',
      'useColorScheme',
      'useContentBox',
      'useCursor',
      'useHighContrast',
      'useI18n',
      'useKeyboard',
      'useLogger',
      'useTextScale',
      'useTheme',
      'useTransition',
      'useUiScale',
      'vibrate',
      'visibleSectionRows',
      'watchPosition',
      'watchSensor',
      'withSpan',
      'writeClipboard',
      'writeFileBytes',
      'writeFileText',
    ]);
  });

  v.test(
    '@solid-multiplatform/platform/primitives (src/primitives/index.ts): 114 names',
    () => {
      v.expect(names(primitives)).toEqual([
        'ALPHA_FULL',
        'ALPHA_NONE',
        'ActionSheet',
        'ActivityIndicator',
        'Alert',
        'Announcer',
        'AppErrorBoundary',
        'BorderBoxStyle',
        'ChatMessage',
        'CheckIcon',
        'Checkbox',
        'ChevronIcon',
        'CloseIcon',
        'Column',
        'ContextMenu',
        'DatePicker',
        'Drawer',
        'FPSCounter',
        'FadeInOut',
        'FocusGroup',
        'FocusStackProvider',
        'GestureAlternatives',
        'Grid',
        'Icon',
        'Image',
        'KeyboardAvoidingView',
        'LazyColumn',
        'LazyRow',
        'ListState',
        'Markdown',
        'Marquee',
        'MarqueeText',
        'Menu',
        'Modal',
        'PageControl',
        'Popover',
        'Portal',
        'Radio',
        'RadioGroup',
        'RichText',
        'Row',
        'SafeArea',
        'Select',
        'SelectableText',
        'Sheet',
        'Slider',
        'Suspense',
        'Svg',
        'Switch',
        'TelemetryCounter',
        'TitleBar',
        'Toast',
        'Tooltip',
        'VirtualColumn',
        'VirtualGrid',
        'VirtualRow',
        'Visible',
        'WindowDragRegion',
        'WindowNoDrag',
        'activeElement',
        'addCustomStateToElement',
        'borderBox',
        'chainFunctions',
        'chainRefs',
        'charIndexAt',
        'checkIsInNonScrollableZone',
        'createBlurredImage',
        'createInfiniteItems',
        'createScreenHistory',
        'createSpriteMap',
        'createTooltip',
        'defaultTransitionBack',
        'defaultTransitionDown',
        'defaultTransitionForward',
        'defaultTransitionUp',
        'ensureSelectionVisible',
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
        'nextWordBoundary',
        'onGridFocus',
        'pageNavigation',
        'printFocusHistory',
        'rangeBounds',
        'rangeSegments',
        'releaseKeySuppression',
        'removeCustomStateFromElement',
        'resetCounter',
        'scrollColumn',
        'scrollColumnIntoView',
        'scrollRow',
        'scrollRowIntoView',
        'selectedText',
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
        'wheelMoveSelection',
        'wheelNavigation',
        'withScrolling',
        'wordRangeAt',
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

  // The service registry is how hosts provide device features and how apps
  // reach the ones without a function of their own (settings, lifecycle, …).
  v.test(
    '@solid-multiplatform/platform/services (src/sdk/services.ts): 9 names',
    () => {
      v.expect(names(services)).toEqual([
        'CapabilityError',
        'installServices',
        'installedServices',
        'loadService',
        'peekService',
        'resetServices',
        'serviceAvailable',
        'subscribeEvent',
        'useService',
      ]);
    },
  );

  v.test(
    '@solid-multiplatform/platform/services/web (src/hosts/web-services/index.ts): 3 names',
    () => {
      v.expect(names(webServices)).toEqual([
        'openMicrophoneStream',
        'webAppServices',
        'webServices',
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
    '@solid-multiplatform/platform/focusManager (src/core/focusManager.ts): 16 names',
    () => {
      v.expect(names(focusManager)).toEqual([
        'currentFocusTrap',
        'focusNearestLiveAncestor',
        'focusPath',
        'focusVisible',
        'getFocusHistory',
        'hideFocusVisible',
        'pressKey',
        'printFocusHistory',
        'pushFocusTrap',
        'releaseKeySuppression',
        'restoreFocusAfterRemoval',
        'setActiveElementCore',
        'setFocusPath',
        'suppressKeyUntilRelease',
        'syncSelectedAncestors',
        'useFocusManager',
      ]);
    },
  );

  // The authoring surface: what an app imports. A name here is a promise to
  // every app; add one only with an example in docs/app-api.md.
  // src/app/index.ts and src/app/entry.ts.
  v.test('@solid-multiplatform/platform/app: 72 names', () => {
    v.expect(names(app)).toEqual([
      'ActionSheet',
      'ActivityIndicator',
      'Alert',
      'AppErrorBoundary',
      'Button',
      'Column',
      'ErrorBoundary',
      'For',
      'Grid',
      'HashRouter',
      'HostScope',
      'Image',
      'Index',
      'KeepAliveRoute',
      'List',
      'Match',
      'Modal',
      'PageControl',
      'Row',
      'Screen',
      'SearchField',
      'SelectableText',
      'Sheet',
      'Show',
      'Slider',
      'Spacer',
      'Switch',
      'Text',
      'TextField',
      'ThemeProvider',
      'Toast',
      'ToggleSwitch',
      'VirtualColumn',
      'VirtualGrid',
      'VirtualRow',
      'Visible',
      'applySystemBarStyle',
      'available',
      'centerIn',
      'clampSize',
      'contentBoxFor',
      'createEffect',
      'createMemo',
      'createScreenHistory',
      'createSignal',
      'defineTheme',
      'deviceColorScheme',
      'deviceInfo',
      'fitSize',
      'impact',
      'keepAwake',
      'loadService',
      'onCleanup',
      'onMount',
      'openExternal',
      'readClipboard',
      'setupI18n',
      'share',
      't',
      'useBattery',
      'useBreakpoint',
      'useColorScheme',
      'useConnectivity',
      'useContentBox',
      'useHost',
      'useLifecycle',
      'useLocale',
      'usePlugin',
      'usePlugins',
      'useTheme',
      'useUiScale',
      'useViewport',
      'writeClipboard',
    ]);
    v.expect(names(appEntryModule)).toEqual(['AppShell', 'appEntry']);
  });

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
      './markdown',
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
      './nativescript/host',
      './nativescript/webpack',
      './browser-tv',
      './browser-tv/canvas',
      './ios',
      './plugins',
      './cli/variants',
      './android',
      './viewport',
      './chrome',
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
      './services/roku',
      './motion',
      './focus',
      './permissions',
      './semantics',
      './services/native/secure-storage',
      './services/native/notifications',
      './permissions/android',
      './services/android',
      './editor/roku',
      './scroll',
      './network',
      './theme',
      './capabilities',
      './keyboard',
      './form',
      './cursor',
      './data',
      './device',
      './i18n',
      './a11y',
      './list',
      './crash',
      './responsive',
      './media',
      './sections',
      './geolocation',
      './biometrics',
      './files',
      './update',
      './shortcuts',
      './logging',
      './env',
      './transition',
      './capture',
      './routes',
      './gamepad',
      './audio',
      './drm',
      './rich-text',
      './svg',
      './gestures',
      './contacts',
      './calendar',
      './sensors',
      './maps',
      './release',
      './pwa',
      './download',
      './menus',
      './window-state',
      './certification',
      './app',
      './app/entry',
      './host',
      './host/web',
      './host/dom',
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
          (subpath === './controls' || subpath === './theme' ? '.jsx' : '.js'),
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
