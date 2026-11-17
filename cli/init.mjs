import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  command,
  copy,
  framework,
  freshDirectory,
  json,
  template,
  validateName,
  write,
  writeJson,
} from './files.mjs';

function device(root, target, dependencies) {
  const origin = path.join(
    framework,
    'examples',
    target === 'ios' ? 'apple-tv' : target,
  );
  const dest = path.join(root, 'targets', target);
  const pkg = json(path.join(origin, 'package.json'));
  Object.assign(pkg.dependencies, dependencies);
  pkg.name = 'host-' + target;
  delete pkg.description;
  writeJson(path.join(dest, 'package.json'), pkg);
  for (const file of ['pnpm-workspace.yaml', 'tsconfig.json'])
    copy(path.join(origin, file), path.join(dest, file));
  if (target === 'roku') {
    copy(
      path.join(origin, 'package-zip.py'),
      path.join(dest, 'package-zip.py'),
    );
    copy(path.join(origin, 'src'), path.join(dest, 'src'));
    write(
      path.join(dest, 'roku-config.ts'),
      `import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({ title: ${JSON.stringify(json(path.join(root, 'solid-platform.json')).name)}, entry: 'work/main.ts', assets: 'work/assets' });
`,
    );
    pkg.devDependencies.brighterscript = '0.73.8';
    writeJson(path.join(dest, 'package.json'), pkg);
    return;
  }
  const copyResource = (file) =>
    copy(path.join(origin, file), path.join(dest, file));
  if (target === 'android-tv') {
    for (const file of [
      'App_Resources/Android/src/main/AndroidManifest.xml',
      'App_Resources/Android/src/main/res',
    ])
      copyResource(file);
    const resource = path.join(dest, 'App_Resources/Android');
    const base = readFileSync(
      path.join(origin, 'App_Resources/Android/app.gradle'),
      'utf8',
    ).split('// Android installs native executables')[0];
    write(
      path.join(resource, 'app.gradle'),
      base +
        "\napply from: file(getAppResourcesPath().toString() + '/Android/plugins.gradle')\n",
    );
    write(
      path.join(resource, 'settings.gradle'),
      "apply from: new File(settingsDir, '../../work/plugins.settings.gradle')\n",
    );
    write(
      path.join(resource, 'plugins.gradle'),
      "apply from: new File(rootProject.projectDir, '../../work/plugins.app.gradle')\n",
    );
  } else {
    copyResource('App_Resources');
    copyResource('svg-compat');
  }
  const appName = json(path.join(root, 'solid-platform.json')).name;
  const bundleId = 'dev.solidapp.a' + appName.replaceAll('-', '');
  const config = readFileSync(
    path.join(origin, 'nativescript.config.ts'),
    'utf8',
  ).replaceAll('dev.solidmultiplatform.fixture', bundleId);
  const appleConfig =
    target === 'ios' || target === 'apple-tv'
      ? config.replace(
          'export default {',
          `export default {\n  ${target === 'ios' ? 'ios' : 'tvos'}: { NativeSource: [{ name: 'SolidPlugins', path: './work/swift/*.swift' }] },`,
        )
      : config;
  write(path.join(dest, 'nativescript.config.ts'), appleConfig);
  const webpack = readFileSync(
    path.join(origin, 'webpack.config.js'),
    'utf8',
  ).replace('../../tests/webgl/fonts', 'work/fonts');
  write(path.join(dest, 'webpack.config.js'), webpack);
  const fn =
    target === 'android-tv'
      ? 'runAndroidTV'
      : target === 'ios'
        ? 'runIOS'
        : 'runAppleTV';
  write(
    path.join(dest, 'app/app.ts'),
    `import { ${fn} } from '@solid-multiplatform/platform/${target}';\n${fn}(() => import('../work/main'));\n`,
  );
}

export function init(destination, selected) {
  const name = validateName(path.basename(destination));
  const meta = json(path.join(framework, 'package.json'));
  if (!existsSync(path.join(framework, 'dist/src/index.js')))
    throw new Error(
      'Build the platform package before running init from a source checkout.',
    );
  freshDirectory(destination, (root) => {
    const vendor = path.join(root, 'vendor');
    const renderer = path.basename(
      meta.devDependencies['@solid-multiplatform/renderer'].slice(5),
    );
    copy(path.join(framework, 'vendor', renderer), path.join(vendor, renderer));
    command(
      'npm',
      ['pack', '--ignore-scripts', '--silent', '--pack-destination', vendor],
      framework,
    );
    const archive = `solid-multiplatform-platform-${meta.version}.tgz`;
    const deps = (prefix) => ({
      '@solid-multiplatform/platform': 'file:' + prefix + archive,
      '@solid-multiplatform/renderer': 'file:' + prefix + renderer,
      'solid-js': '1.9.17',
      '@solidjs/router': '0.16.1',
    });
    writeJson(path.join(root, 'package.json'), {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: meta.packageManager,
      scripts: {
        platform: 'solid-platform',
        build: 'solid-platform build',
        dev: 'solid-platform dev',
      },
      dependencies: deps('vendor/'),
    });
    writeJson(path.join(root, 'solid-platform.json'), {
      name,
      targets: selected,
    });
    write(
      path.join(root, 'src/app.tsx'),
      template('app/app.tsx', { APP_NAME: name }),
    );
    copy(
      path.join(framework, 'tests/webgl/fonts'),
      path.join(root, 'assets/fonts'),
    );
    write(
      path.join(root, '.gitignore'),
      'node_modules/\ntargets/*/work/\ntargets/*/platforms/\ntargets/*/hooks/\ntargets/*/dist/\ntargets/*/dist-roku/\ntargets/web/public/fonts/\n',
    );
    write(
      path.join(root, 'README.md'),
      `# ${name}\n\nInstall with \`corepack pnpm install\`. Create an extension with \`corepack pnpm platform plugin new my-plugin\`. Build a target with \`corepack pnpm build ${selected[0]}\`. App code lives in src, extensions in plugins, and native projects in targets. The CLI regenerates each target's work directory on build.\n\nTargets: ${selected.join(', ')}. Desktop is a native plugin runner.\n`,
    );
    for (const target of selected) {
      const dest = path.join(root, 'targets', target);
      const dependencies = deps('../../vendor/');
      if (target === 'desktop')
        writeJson(path.join(dest, 'package.json'), {
          name: 'desktop-host',
          private: true,
          type: 'module',
        });
      else if (target === 'web') {
        writeJson(path.join(dest, 'package.json'), {
          name: 'web-host',
          private: true,
          type: 'module',
          packageManager: meta.packageManager,
          scripts: { build: 'vite build', dev: 'vite' },
          dependencies,
          devDependencies: { vite: '8.0.13', 'vite-plugin-solid': '2.11.12' },
        });
        write(
          path.join(dest, 'pnpm-workspace.yaml'),
          'onlyBuiltDependencies:\n  - esbuild\n',
        );
        for (const file of ['index.html', 'vite.config.mjs'])
          write(
            path.join(dest, file),
            template('web/' + file, { APP_NAME: name }),
          );
      } else device(root, target, dependencies);
    }
  });
}
