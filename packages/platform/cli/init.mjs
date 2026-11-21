import { tvBrowsers } from './variants.mjs';
import { rendererArchive } from './renderer-archive.mjs';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  command,
  copy,
  framework,
  freshDirectory,
  json,
  project,
  template,
  validateName,
  write,
  writeJson,
} from './files.mjs';

function device(root, target, dependencies) {
  const origin = path.join(
    framework,
    'examples',
    target === 'ios'
      ? 'apple-tv'
      : target === 'android'
        ? 'android-tv'
        : target,
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
    // Roku draws text with a font file, not the SDF atlas the other targets
    // load from assets/fonts: the starter app's family (Lato) as a TTF, with
    // its licence, kept with this target.
    copy(
      path.join(framework, 'cli/templates/roku/fonts'),
      path.join(dest, 'fonts'),
    );
    write(
      path.join(dest, 'roku-config.ts'),
      `import { rokuConfig } from '@solid-multiplatform/platform/roku/preset';
export default rokuConfig({ title: ${JSON.stringify(project(root).name)}, entry: 'work/main.ts', assets: 'work/assets' });
`,
    );
    pkg.devDependencies.brighterscript = '0.73.8';
    writeJson(path.join(dest, 'package.json'), pkg);
    return;
  }
  const copyResource = (file) =>
    copy(path.join(origin, file), path.join(dest, file));
  if (target === 'android-tv' || target === 'android') {
    for (const file of [
      'App_Resources/Android/src/main/AndroidManifest.xml',
      'App_Resources/Android/src/main/res',
    ])
      copyResource(file);
    const resource = path.join(dest, 'App_Resources/Android');
    if (target === 'android') {
      copy(
        path.join(framework, 'hosts/android/AndroidManifest.xml'),
        path.join(resource, 'src/main/AndroidManifest.xml'),
      );
    }
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
  const appName = project(root).name;
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
  // The framework's rasterised icons travel with the fonts: the build stages
  // them in `work/icons`, the native package carries them at `assets/app/icons`
  // and `setIconBase` in the generated entry points at them.
  const webpack = readFileSync(path.join(origin, 'webpack.config.js'), 'utf8')
    .replace('../../tests/webgl/fonts', 'work/fonts')
    .replace(
      'args[0].patterns.push({',
      // `noErrorOnMissing`: an app built before the icons existed still
      // builds; it simply draws no framework icons.
      "args[0].patterns.push({\n        from: path.resolve(__dirname, 'work/icons'),\n        to: 'icons',\n        noErrorOnMissing: true,\n      });\n      args[0].patterns.push({",
    );
  write(path.join(dest, 'webpack.config.js'), webpack);
  if (target === 'android') {
    // A phone app keeps its status bar; only a television goes fullscreen.
    const styles = path.join(
      dest,
      'App_Resources/Android/src/main/res/values/styles.xml',
    );
    if (existsSync(styles))
      write(
        styles,
        readFileSync(styles, 'utf8')
          .replace(
            /\s*<item name="android:windowFullscreen">[^<]*<\/item>/g,
            '',
          )
          .replace(
            '<style name="AppThemeBase" parent="Theme.AppCompat.NoActionBar">',
            '<style name="AppThemeBase" parent="Theme.AppCompat.NoActionBar">\n    <item name="android:windowLightStatusBar">false</item>\n    <item name="android:windowLightNavigationBar">false</item>',
          ),
      );
  }
  const fn =
    target === 'android-tv'
      ? 'runAndroidTV'
      : target === 'android'
        ? 'runAndroid'
        : target === 'ios'
          ? 'runIOS'
          : 'runAppleTV';
  write(
    path.join(dest, 'app/app.ts'),
    `import { ${fn} } from '@solid-multiplatform/platform/${target}';\n${fn}(async host => { const app = await import('../work/main'); return { mount: () => app.mount(host) }; });\n`,
  );
}

export function init(destination, selected) {
  const name = validateName(path.basename(destination));
  const meta = json(path.join(framework, 'package.json'));
  // pnpm pack strips packageManager from the top-level release manifest.
  const packageManager =
    meta.packageManager ??
    json(path.join(framework, 'examples/roku/package.json')).packageManager;
  if (!existsSync(path.join(framework, 'dist/src/index.js')))
    throw new Error(
      'Build the platform package before running init from a source checkout.',
    );
  freshDirectory(destination, (root) => {
    const vendor = path.join(root, 'vendor');
    const { file: rendererFile, name: renderer } = rendererArchive();
    copy(rendererFile, path.join(vendor, renderer));
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
    write(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
    writeJson(path.join(root, 'package.json'), {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager,
      scripts: {
        platform: 'solid-platform',
        check: 'solid-platform check',
        build: 'solid-platform build',
        dev: 'solid-platform dev',
      },
      dependencies: deps('vendor/'),
      devDependencies: { typescript: '7.0.2' },
    });
    writeJson(path.join(root, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'preserve',
        jsxImportSource: '@solid-multiplatform/platform',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    });
    writeJson(path.join(root, 'solid-platform.config.json'), {
      id: 'dev.solidapp.a' + name.replaceAll('-', ''),
      name,
      version: '0.1.0',
      targets: selected,
      // Fonts come from assets/fonts unless `app.fonts` lists them.
      app: { designSize: { width: 1920, height: 1080 }, theme: 'dark' },
      deepLinks: { schemes: [], hosts: [] },
      services: [],
      signing: {},
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
      'node_modules/\ntargets/*/work/\ntargets/*/.solid-build.lock/\ntargets/*/platforms/\ntargets/*/hooks/\ntargets/*/dist/\ntargets/*/dist-roku/\ntargets/web/public/fonts/\n',
    );
    write(
      path.join(root, 'README.md'),
      `# ${name}\n\nInstall with \`corepack pnpm install\`. Create an extension with \`corepack pnpm platform plugin new my-plugin\`. Build a target with \`corepack pnpm build ${selected[0]}\`. App code lives in src, extensions in plugins, and native projects in targets. The CLI regenerates each target's work directory on build.\n\nTargets: ${selected.join(', ')}.\n`,
    );
    for (const target of selected) {
      const dest = path.join(root, 'targets', target);
      const dependencies = deps('../../vendor/');
      if (target === 'desktop') {
        // The desktop target has no Node dependencies: its host package and
        // runtime are installed separately with `solid-platform add desktop`.
        write(path.join(dest, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
        writeJson(path.join(dest, 'package.json'), {
          name: 'desktop-host',
          packageManager,
          private: true,
          type: 'module',
        });
      } else if (target === 'web' || tvBrowsers.includes(target)) {
        writeJson(path.join(dest, 'package.json'), {
          name: 'web-host',
          private: true,
          type: 'module',
          packageManager,
          scripts: { build: 'vite build', dev: 'vite' },
          dependencies,
          devDependencies: {
            vite: '8.0.13',
            'vite-plugin-solid': '2.11.12',
            ...(tvBrowsers.includes(target)
              ? { '@vitejs/plugin-legacy': '8.2.4', terser: '5.51.2' }
              : {}),
            ...(target === 'webos' ? { '@webos-tools/cli': '3.2.6' } : {}),
          },
        });
        write(
          path.join(dest, 'pnpm-workspace.yaml'),
          'onlyBuiltDependencies:\n  - esbuild\n',
        );
        for (const file of [
          'index.html',
          'vite.config.mjs',
          'manifest.webmanifest',
        ])
          write(
            path.join(dest, file),
            template(
              'web/' +
                (file === 'vite.config.mjs' && tvBrowsers.includes(target)
                  ? target === 'ps4'
                    ? 'ps4-vite.config.mjs'
                    : 'tv-vite.config.mjs'
                  : file),
              { APP_NAME: name, TARGET: target },
            ),
          );
        copy(
          path.join(framework, 'cli/templates/web/icon.png'),
          path.join(dest, 'public/icon.png'),
        );
        copy(
          path.join(framework, 'cli/templates/web/sw.js'),
          path.join(dest, 'public/sw.js'),
        );
      } else device(root, target, dependencies);
    }
  });
}
