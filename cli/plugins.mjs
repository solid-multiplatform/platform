import { browserTVs } from './variants.mjs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  copy,
  framework,
  freshDirectory,
  template,
  validateName,
  write,
  writeJson,
} from './files.mjs';

export const androidModes = ['kotlin', 'sidecar', 'service', 'jni'];

function androidPlugin(dir, name, mode) {
  const lib = 'solid' + name.replaceAll('-', '_');
  const pkg = 'dev.solidmultiplatform.plugins.p' + name.replaceAll('-', '_');
  const kotlin = path.join(dir, 'src/main/java', ...pkg.split('.'));
  const values = {
    PACKAGE: pkg,
    LIB: lib,
    PLUGIN: name,
    SYMBOL:
      'Java_' +
      pkg.replaceAll('_', '_1').replaceAll('.', '_') +
      '_Commands_run',
  };
  let gradle = `apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'
android {
    namespace '${pkg}'
    compileSdk 36
    defaultConfig { minSdk 23 }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = '17' }
}
`;
  let manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>';
  const namespace =
    'globalThis.dev.solidmultiplatform.plugins.p' + name.replaceAll('-', '_');
  let binding;
  if (mode === 'sidecar') {
    const example = path.join(framework, 'examples/android-tv');
    const command = readFileSync(
      path.join(
        example,
        'App_Resources/Android/src/main/java/dev/solidmultiplatform/fixture/PreviewCommand.kt',
      ),
      'utf8',
    );
    write(
      path.join(kotlin, 'PreviewCommand.kt'),
      command
        .replace('package dev.solidmultiplatform.fixture', 'package ' + pkg)
        .replace('libsolid_preview.so', 'lib' + lib + '.so'),
    );
    copy(
      path.join(example, 'native/preview.c'),
      path.join(dir, 'native/preview.c'),
    );
    gradle += template('android/sidecar.gradle', { LIB: lib });
    binding = `import { Application } from '@nativescript/core';
export function run() {
  const native = ${namespace};
  let worker;
  const cancel = () => worker.cancel();
  return new Promise((resolve, reject) => {
    const result = new native.PreviewResult({ complete: resolve, failed: reason => reject(new Error(reason)) });
    worker = new native.PreviewCommand(Application.android.context, result);
    Application.on('suspend', cancel);
    worker.start();
  }).finally(() => Application.off('suspend', cancel));
}`;
  } else if (mode === 'service') {
    write(
      path.join(kotlin, 'PluginService.kt'),
      template('android/PluginService.kt', values),
    );
    manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
  <application><service android:name="${pkg}.PluginService" android:exported="false" android:foregroundServiceType="shortService"/></application>
</manifest>`;
    binding = `import { Application } from '@nativescript/core';
export function run() {
  const native = ${namespace};
  return new Promise((resolve, reject) => native.Commands.run(Application.android.context,
    new native.Result({ complete: resolve, failed: reason => reject(new Error(reason)) })));
}`;
  } else {
    write(
      path.join(kotlin, 'Commands.kt'),
      template(
        mode === 'jni' ? 'android/JniCommand.kt' : 'android/KotlinCommand.kt',
        values,
      ),
    );
    binding = `export async function run() { return ${namespace}.Commands.run(); }`;
    if (mode === 'jni') {
      gradle +=
        "android.ndkVersion = '28.2.13676358'\nandroid.externalNativeBuild.cmake.path = file('native/CMakeLists.txt')\n";
      write(
        path.join(dir, 'native/command.c'),
        template('android/command.c', values),
      );
      write(
        path.join(dir, 'native/CMakeLists.txt'),
        `cmake_minimum_required(VERSION 3.22)
project(${lib} C)
add_library(${lib} SHARED command.c)
target_link_options(${lib} PRIVATE "-Wl,-z,max-page-size=16384")
`,
      );
    }
  }
  write(path.join(dir, 'build.gradle'), gradle);
  write(path.join(dir, 'src/main/AndroidManifest.xml'), manifest + '\n');
  write(path.join(dir, 'index.mjs'), binding + '\n');
}

export function newPlugin(root, name, selected, mode) {
  validateName(name);
  if (!androidModes.includes(mode))
    throw new Error('Android kind must be ' + androidModes.join(', '));
  const label =
    'P' +
    name
      .split('-')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join('');
  freshDirectory(path.join(root, 'plugins', name), (dir) => {
    writeJson(path.join(dir, 'plugin.json'), {
      name,
      targets: selected,
      ...(selected.some((t) => t === 'android' || t === 'android-tv') && {
        androidKind: mode,
      }),
    });
    for (const target of selected) {
      const dest = path.join(dir, target);
      const values = { CLASS: label, PLUGIN: name };
      if (target === 'android-tv' || target === 'android')
        androidPlugin(dest, name, mode);
      if (target === 'web' || browserTVs.includes(target))
        write(
          path.join(dest, 'index.mjs'),
          `export async function run() { return '${name} web'; }\n`,
        );
      if (target === 'apple-tv' || target === 'ios') {
        const className = 'Solid' + label + 'Plugin';
        write(
          path.join(dest, 'index.mjs'),
          `export async function run() { return ${className}.run(); }\n`,
        );
        // The Swift implementation is shared by the Apple hosts.
        write(
          path.join(dir, 'apple', className + '.swift'),
          `import Foundation

@objc(${className})
public final class ${className}: NSObject {
    @objc public static func run() -> String { "${name} Swift" }
}
`,
        );
      }
      if (target === 'desktop')
        for (const f of ['index.mjs', 'worker.c'])
          write(path.join(dest, f), template('desktop/' + f, values));
      if (target === 'roku') {
        write(path.join(dest, 'index.ts'), template('roku/index.ts', values));
        for (const ext of ['xml', 'bs'])
          write(
            path.join(dest, 'components', label + 'Task.' + ext),
            template('roku/component.' + ext, values),
          );
      }
    }
  });
}
