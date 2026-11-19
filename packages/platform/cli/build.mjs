import { packageTV } from './tv-package.mjs';
import { stageSources, browserTVs } from './variants.mjs';
import { CliError } from './context.mjs';
import { requireHostDesktopCli } from './host-desktop.mjs';
import {
  NATIVE_FORMS,
  appModule,
  appSettings,
  desktopComponent,
  mountComponent,
  nativeComponent,
  rokuComponentEntry,
} from './app-entry.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import {
  command,
  copy,
  framework,
  json,
  project,
  targets,
  template,
  validateName,
  write,
  writeJson,
} from './files.mjs';

function pluginsFor(root, target) {
  const dir = path.join(root, 'plugins');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const name = validateName(e.name);
      const plugin = json(path.join(dir, name, 'plugin.json'));
      if (plugin.name !== name)
        throw new Error('Plugin name must match its directory: ' + name);
      targets(plugin.targets.join(','), project(root).targets);
      return plugin;
    })
    .filter((p) => p.targets.includes(target))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The desktop runtime's own build tool, from the app's dependencies or the
// workspace. Node is the build tool; what runs the app is the Rust binary.

function android(root, work, plugins, target) {
  const modules = plugins.map(({ name }) => {
    const relative = path
      .relative(
        path.join(root, 'targets', target, 'platforms/android'),
        path.join(root, 'plugins', name, target),
      )
      .split(path.sep)
      .join('/');
    return `include ':plugin-${name}'\nproject(':plugin-${name}').projectDir = new File(settingsDir, '${relative}')`;
  });
  write(path.join(work, 'plugins.settings.gradle'), modules.join('\n') + '\n');
  const pluginPaths = plugins.map(({ name }) => `':plugin-${name}'`);
  const dependencies = [
    '    solidPluginPaths.each { implementation project(it) }',
  ];
  const host = json(path.join(root, 'targets', target, 'package.json'));
  if (host.dependencies?.['@solid-multiplatform/video']) {
    // Match the Media3 engine supplied by the Android canvas-media plugin.
    dependencies.push(
      "    implementation 'androidx.media3:media3-exoplayer-hls:1.4.0'",
      "    implementation 'androidx.media3:media3-exoplayer-dash:1.4.0'",
    );
  }
  write(
    path.join(work, 'plugins.app.gradle'),
    `def solidPluginPaths = [${pluginPaths.join(', ')}]\n` +
      `dependencies {\n${dependencies.join('\n')}\n}\n` +
      template('android/plugin-metadata.gradle', {}) +
      (plugins.some((p) => p.androidKind === 'sidecar')
        ? 'android.packaging.jniLibs.useLegacyPackaging = true\n'
        : ''),
  );
}

function roku(work, plugins, dir) {
  mkdirSync(path.join(work, 'assets'), { recursive: true });
  if (!plugins.length) return;
  const source = path.join(work, 'bsc');
  for (const { name } of plugins) {
    const from = path.join(work, 'plugins', name, 'components');
    if (existsSync(from)) copy(from, path.join(source, 'components', name));
  }
  // Compile all plugins together so duplicate component names fail in one build.
  writeJson(path.join(work, 'bsconfig.json'), {
    rootDir: 'bsc',
    files: ['components/**/*'],
    stagingDir: 'assets',
    createPackage: false,
    copyToStaging: true,
    retainStagingDir: true,
    autoImportComponentScript: false,
  });
  command(
    'corepack',
    ['pnpm', 'exec', 'bsc', '--project', 'work/bsconfig.json'],
    dir,
  );
}

// Browser targets start through startApp on the web host; browser TVs wrap it
// for the fixed stage and the remote, and --legacy draws with Canvas 2D.
// `app` is how src/app starts: a component (its default export), or the
// `App` and `appOptions` exports of an app written before that.
function browserEntry(target, legacy, name, fonts, app, settings) {
  const tv = browserTVs.includes(target);
  const options = `{ target: '${target}', namespace: ${JSON.stringify(name)} }`;
  const base = legacy ? 'canvasHost' : 'webHost';
  return `import { onCleanup } from 'solid-js';
${app.component ? "import { appEntry } from '@solid-multiplatform/platform/app/entry';" : "import { createComponent } from '@solid-multiplatform/platform';"}
import { startApp } from '@solid-multiplatform/platform/host';
${
  legacy
    ? "import { canvasHost } from '@solid-multiplatform/platform/browser-tv/canvas';"
    : "import { webHost } from '@solid-multiplatform/platform/host/web';"
}
${tv ? "import { tvHost } from '@solid-multiplatform/platform/browser-tv/input';" : "import { registerServiceWorker } from '@solid-multiplatform/platform/pwa';"}
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
${app.component ? `import App${app.options ? ', { options }' : ''} from './src/app';` : "import { App, appOptions } from './src/app';"}
import { plugins } from './plugins.mjs';
export function mount(host = { target: '${target}' }) {
  ${app.component ? `const entry = appEntry(App, plugins, ${settings}${app.options ? ', options' : ''});` : ''}
  return startApp(
    ${tv ? `tvHost(${base}, ${options})` : `${base}(${options})`},
    (context) => {
      // Plugins attach once the host's services exist and detach before they go.
      onCleanup(attachPlugins(plugins, host));
      return ${app.component ? 'entry.root()' : 'createComponent(App, { plugins, host: context })'};
    },
    ${app.component ? 'entry.options' : `appOptions(${fonts})`},
  );
}
mount();
${tv ? '' : "if (import.meta.env.PROD && 'serviceWorker' in navigator) void registerServiceWorker({ url: './sw.js' });\n"}`;
}

function buildTarget(root, target, dev, legacy) {
  if (dev && !['web', 'desktop'].includes(target))
    throw new Error(
      'Use build for native packages, then launch them with the device SDK.',
    );
  if (legacy && !browserTVs.includes(target))
    throw new Error('--legacy requires a browser TV target');
  const dir = path.join(root, 'targets', target);
  const work = path.join(dir, 'work');
  if (existsSync(work) && !existsSync(path.join(work, '.generated')))
    throw new Error('Unmanaged directory: ' + work);
  rmSync(work, { recursive: true, force: true });
  write(
    path.join(work, '.generated'),
    'Generated by solid-platform. Edit src or plugins in the project root.\n',
  );
  const plugins = pluginsFor(root, target);
  const imports = [];
  const entries = [];
  for (const [i, { name }] of plugins.entries()) {
    const src = path.join(root, 'plugins', name, target);
    const dest = path.join(work, 'plugins', name);
    // Native Android modules remain in their source directories and are compiled by Gradle.
    if (target === 'android-tv' || target === 'android')
      copy(path.join(src, 'index.mjs'), path.join(dest, 'index.mjs'));
    else copy(src, dest);
    const ext = target === 'roku' ? 'ts' : 'mjs';
    imports.push(
      `import * as plugin${i} from './plugins/${name}/index.${ext}';`,
    );
    entries.push(`  '${name}': plugin${i}`);
  }
  write(
    path.join(work, 'plugins.mjs'),
    imports.join('\n') +
      '\nexport const plugins = {\n' +
      entries.join(',\n') +
      '\n};\n',
  );
  stageSources(path.join(root, 'src'), path.join(work, 'src'), target);
  if (target === 'desktop') {
    // The host package is the build tool and the runtime's launcher, both
    // from the app's dependencies. Node is never what runs the app.
    const cli = requireHostDesktopCli(root);
    const out = path.join(work, 'bundle');
    const fonts = path.join(work, 'fonts');
    if (existsSync(path.join(root, 'assets/fonts')))
      copy(path.join(root, 'assets/fonts'), fonts);
    const hasFonts = existsSync(fonts);
    if (dev === 'plugins') {
      // The plugin command fixture, run by the runtime without a window.
      write(
        path.join(work, 'plugins-entry.mjs'),
        "import { plugins } from './plugins.mjs';\n(async () => {\n  for (const [name, plugin] of Object.entries(plugins)) console.log(name, await plugin.run());\n  globalThis.__solid.exit(0);\n})();\n",
      );
      command(
        process.execPath,
        [cli, 'build', path.join(work, 'plugins-entry.mjs'), '--out', out],
        work,
      );
      command(
        process.execPath,
        [cli, 'run', path.join(out, 'app.js'), '--headless'],
        work,
      );
      return;
    }
    const app = appModule(work);
    if (!app.component)
      throw new CliError(
        'The desktop target runs a component app: src/app.tsx must default-export the app component (as the starter does).',
      );
    // One component, one startApp call: the runtime bundles the entry and
    // runs it.
    const settings = appSettings(root, 'desktop', "'./fonts'");
    write(
      path.join(work, 'entry.tsx'),
      settings.imports +
        '\n' +
        desktopComponent(settings.settings, app.options),
    );
    command(
      process.execPath,
      [
        cli,
        'build',
        path.join(work, 'entry.tsx'),
        '--out',
        out,
        ...(hasFonts ? ['--assets', fonts] : []),
        ...(dev === true ? [] : ['--bytecode', '--minify']),
      ],
      work,
    );
    if (dev === true)
      command(
        process.execPath,
        [
          cli,
          'run',
          path.join(out, 'app.hbc'),
          ...(hasFonts ? ['--assets', fonts] : []),
        ],
        work,
      );
    return;
  }
  if (target === 'web') {
    const publicDir = path.join(dir, 'public');
    const appName = project(root).name;
    if (!existsSync(path.join(publicDir, 'sw.js')))
      copy(
        path.join(framework, 'cli/templates/web/sw.js'),
        path.join(publicDir, 'sw.js'),
      );
    if (!existsSync(path.join(publicDir, 'manifest.webmanifest')))
      write(
        path.join(publicDir, 'manifest.webmanifest'),
        template('web/manifest.webmanifest', { APP_NAME: appName }),
      );
    if (!existsSync(path.join(publicDir, 'icon.png')))
      copy(
        path.join(framework, 'cli/templates/web/icon.png'),
        path.join(publicDir, 'icon.png'),
      );
  }
  const browser = target === 'web' || browserTVs.includes(target);
  // Roku draws text with font files. The starter's (targets/roku/fonts, from
  // init) is imported by the generated entry, which registers it under the
  // family the app names; the Roku preset packages the file and its layout
  // table.
  const rokuFont =
    target === 'roku' && existsSync(path.join(dir, 'fonts/Lato-Regular.ttf'));
  const fonts = legacy
    ? 'undefined'
    : target === 'roku'
      ? "'pkg:/fonts'"
      : browser
        ? "'./fonts'"
        : "'file:///app/fonts'";
  const app = appModule(work);
  // Android, Android TV, iOS and tvOS run a component through `startApp` on
  // their `HostDefinition`; Roku installs its renderer and mounts directly.
  const nativeForm = NATIVE_FORMS[target];
  const settings = app.component
    ? appSettings(root, target, legacy ? undefined : fonts)
    : undefined;
  write(
    path.join(work, 'main.ts'),
    (browser
      ? browserEntry(
          target,
          legacy,
          project(root).name,
          fonts,
          app,
          settings?.settings,
        )
      : app.component && target === 'roku'
        ? // Roku starts the host itself: one startApp call, the app's
          // default export, and the remote's media keys in the key map.
          `${settings.imports}\n${rokuComponentEntry(
            settings.settings,
            app.options,
            project(root).name,
          )}`
        : app.component
          ? // The app is a component: the entry wires it to the host. The same
            // text on Roku; the same shape on the four NativeScript targets.
            `${settings.imports}
${target === 'roku' ? "import { setRendererFactory } from '@solid-multiplatform/platform'; import { rokuHost } from '@solid-multiplatform/platform/roku';" : ''}
import App${app.options ? ', { options }' : ''} from './src/app';
import { appEntry } from '@solid-multiplatform/platform/app/entry';
${
  nativeForm
    ? "import { startApp } from '@solid-multiplatform/platform/host';\nimport { nativeHost } from '@solid-multiplatform/platform/nativescript/host';"
    : "import { mountApp } from '@solid-multiplatform/platform/host';"
}
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { plugins } from './plugins.mjs';
export function mount(host = { target: '${target}' }) {
  const detach = attachPlugins(plugins, host);
  try {
    ${
      nativeForm
        ? nativeComponent(settings.settings, app.options, nativeForm)
        : mountComponent(settings.settings, app.options)
    }
    return () => { try { ${nativeForm ? 'stop?.()' : 'dispose()'}; } finally { detach(); } };
  } catch (error) { detach(); throw error; }
}
`
          : `${rokuFont ? "import { loadFonts } from '@solid-multiplatform/platform'; import lato from '../fonts/Lato-Regular.ttf';" : ''}
${target === 'roku' ? "import { setRendererFactory } from '@solid-multiplatform/platform'; import { rokuHost } from '@solid-multiplatform/platform/roku';" : ''}
import { mount as start } from './src/app';
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { plugins } from './plugins.mjs';
export function mount(host = { target: '${target}' }) {
  const detach = attachPlugins(plugins, host);
  ${rokuFont ? "void loadFonts([{ fontFamily: 'Lato', fontUrl: lato }]).catch((error) => console.error(error));" : ''}
  try {
    const dispose = start(plugins, ${fonts}, host.input, host);
    return () => { try { dispose?.(); } finally { detach(); } };
  } catch (error) { detach(); throw error; }
}
`) +
      (target === 'roku' && !app.component
        ? // An app written before the component API: its own mount() builds
          // the renderer the host supplies when the scene exists.
          `rokuHost({ namespace: ${JSON.stringify(project(root).name)} }).launch((context) => { setRendererFactory((settings) => context.createRenderer(settings), context.loadFonts); return mount({ target: 'roku', ...context }); });\n`
        : ''),
  );
  if (target !== 'roku')
    copy(
      path.join(root, 'assets/fonts'),
      browser ? path.join(dir, 'public/fonts') : path.join(work, 'fonts'),
    );
  else if (rokuFont && existsSync(path.join(dir, 'fonts/Lato-OFL.txt')))
    // The licence travels with the font into the package.
    copy(
      path.join(dir, 'fonts/Lato-OFL.txt'),
      path.join(work, 'assets/fonts/Lato-OFL.txt'),
    );
  if (target === 'android-tv' || target === 'android')
    android(root, work, plugins, target);
  command(
    'corepack',
    [
      'pnpm',
      'install',
      existsSync(path.join(dir, 'pnpm-lock.yaml'))
        ? '--frozen-lockfile'
        : '--no-frozen-lockfile',
    ],
    dir,
  );
  if (target === 'roku') roku(work, plugins, dir);
  if (target === 'apple-tv' || target === 'ios') {
    const swiftDir = path.join(work, 'swift');
    mkdirSync(swiftDir, { recursive: true });
    if (
      json(path.join(dir, 'package.json')).dependencies?.[
        '@solid-multiplatform/video'
      ]
    ) {
      const app = createRequire(path.join(dir, 'package.json'));
      copy(
        app.resolve('@solid-multiplatform/video/swift'),
        path.join(swiftDir, 'SolidPlayback.swift'),
      );
    }
    for (const { name } of plugins) {
      const from = path.join(root, 'plugins', name, 'apple');
      for (const file of readdirSync(from).filter((f) =>
        f.endsWith('.swift'),
      )) {
        if (existsSync(path.join(swiftDir, file)))
          throw new Error('Duplicate Swift source: ' + file);
        copy(path.join(from, file), path.join(swiftDir, file));
      }
    }
  }
  if (target === 'apple-tv' || target === 'ios')
    command(
      'corepack',
      [
        'pnpm',
        'exec',
        'ns',
        'build',
        target === 'ios' ? 'ios' : 'tvos',
        '--emulator',
        '--env.production',
        '--no-hmr',
      ],
      dir,
    );
  else {
    command(
      'corepack',
      ['pnpm', dev ? 'dev' : 'build', ...(legacy ? ['--mode', 'legacy'] : [])],
      dir,
    );
    if (!dev && browserTVs.includes(target))
      packageTV(dir, target, project(root).name, legacy, project(root));
  }
}

export function build(root, target, dev = false, legacy = false) {
  if (!project(root).targets.includes(target))
    throw new Error('Unknown target: ' + target);
  const lock = path.join(root, 'targets', target, '.solid-build.lock');
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      'Build already active. If the previous process was interrupted, remove ' +
        lock,
    );
  }
  try {
    buildTarget(root, target, dev, legacy);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
