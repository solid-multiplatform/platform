import { packageTV } from './tv-package.mjs';
import { buildDesktopUI } from './desktop.mjs';
import { stageSources, browserTVs } from './variants.mjs';
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

function buildDesktop(root, work, plugins, launch) {
  for (const { name } of plugins) {
    const dir = path.join(work, 'plugins', name);
    const src = path.join(dir, 'worker.c');
    if (!existsSync(src)) continue;
    if (process.platform === 'win32')
      command('cl', ['/nologo', '/O2', 'worker.c', '/Fe:worker.exe'], dir);
    else
      command(process.env.CC || 'cc', ['-O2', 'worker.c', '-o', 'worker'], dir);
  }
  const main = path.join(work, 'src/desktop.mjs');
  if (existsSync(main)) copy(main, path.join(work, 'desktop.mjs'));
  else
    write(
      path.join(work, 'desktop.mjs'),
      'export async function main(plugins) { for (const [name, plugin] of Object.entries(plugins)) console.log(name, await plugin.run()); }\n',
    );
  write(
    path.join(work, 'main.mjs'),
    "import { plugins } from './plugins.mjs';\nimport { main } from './desktop.mjs';\nimport { attachPlugins } from '@solid-multiplatform/platform/plugins';\nconst detach = attachPlugins(plugins, {target:'desktop'});\ntry { await main(plugins); } finally { detach(); }\n",
  );
  if (launch) command(process.execPath, ['main.mjs'], work);
}

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
function browserEntry(target, legacy, name, fonts) {
  const tv = browserTVs.includes(target);
  const options = `{ target: '${target}', namespace: ${JSON.stringify(name)} }`;
  const base = legacy ? 'canvasHost' : 'webHost';
  return `import { onCleanup } from 'solid-js';
import { createComponent } from '@solid-multiplatform/platform';
import { startApp } from '@solid-multiplatform/platform/host';
${
  legacy
    ? "import { canvasHost } from '@solid-multiplatform/platform/browser-tv/canvas';"
    : "import { webHost } from '@solid-multiplatform/platform/host/web';"
}
${tv ? "import { tvHost } from '@solid-multiplatform/platform/browser-tv/input';" : "import { registerServiceWorker } from '@solid-multiplatform/platform/pwa';"}
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { App, appOptions } from './src/app';
import { plugins } from './plugins.mjs';
export function mount(host = { target: '${target}' }) {
  return startApp(
    ${tv ? `tvHost(${base}, ${options})` : `${base}(${options})`},
    (context) => {
      // Plugins attach once the host's services exist and detach before they go.
      onCleanup(attachPlugins(plugins, host));
      return createComponent(App, { plugins, host: context });
    },
    appOptions(${fonts}),
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
    const graphical =
      json(path.join(dir, 'package.json')).solidDesktopWindow &&
      dev !== 'plugins';
    buildDesktop(root, work, plugins, dev && !graphical);
    if (graphical) buildDesktopUI(root, dir, work, dev);

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
  const fonts =
    target === 'roku' || legacy
      ? 'undefined'
      : browser
        ? "'./fonts'"
        : "'file:///app/fonts'";
  write(
    path.join(work, 'main.ts'),
    browser
      ? browserEntry(target, legacy, project(root).name, fonts)
      : `import { mount as start } from './src/app';
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { plugins } from './plugins.mjs';
export function mount(host = { target: '${target}' }) {
  const detach = attachPlugins(plugins, host);
  try {
    const dispose = start(plugins, ${fonts}, host.input, host);
    return () => { try { dispose?.(); } finally { detach(); } };
  } catch (error) { detach(); throw error; }
}
`,
  );
  if (target !== 'roku')
    copy(
      path.join(root, 'assets/fonts'),
      browser ? path.join(dir, 'public/fonts') : path.join(work, 'fonts'),
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
      packageTV(dir, target, project(root).name, legacy);
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
