#!/usr/bin/env node
/**
 * Build the mobile demo into a signed release APK.
 *
 * The source in this directory is the app. The CLI needs an `init`ed project
 * (vendor tarballs, a NativeScript target, fonts), so this script scaffolds
 * one in a scratch directory, copies `src/` over, and builds there:
 *
 *   1. `solid-platform init <scratch> --targets android`
 *   2. copy src/ and solid-platform.config.json over the generated app
 *   3. inject TMDB_API_KEY into src/config.ts (empty = bundled catalogue)
 *   4. restrict app.gradle to one ABI (x86_64 for the emulator, arm64-v8a
 *      for a Pixel) and keep `useLegacyPackaging` on for a small APK
 *   5. `solid-platform build android` (stages the sources, installs the target)
 *   6. `ns build android --release` signed with a throwaway keystore
 *
 * Usage: node build.mjs [--arm64]
 * Output: build/mobile-demo-x86_64.apk or build/mobile-demo-arm64.apk
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const arm64 = process.argv.includes('--arm64');
const arch = arm64 ? 'arm64' : 'x86_64';
const abi = arm64 ? 'arm64-v8a' : 'x86_64';
const scratch = `/var/tmp/smp-mobile-demo-${arm64 ? 'arm64' : 'x86'}`;
const javaHome = process.env.JAVA_HOME ?? '/usr/lib/jvm/java-21-openjdk';
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${path.join(javaHome, 'bin')}:${process.env.PATH ?? ''}`,
  ANDROID_SDK_ROOT:
    process.env.ANDROID_SDK_ROOT ?? '/mnt/ALPH/viptv-storage/android/Sdk',
  ANDROID_HOME:
    process.env.ANDROID_SDK_ROOT ?? '/mnt/ALPH/viptv-storage/android/Sdk',
};

function run(command, args, cwd, capture = false) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  return execFileSync(command, args, {
    cwd,
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
}

function step(text) {
  process.stdout.write(`\n== ${text}\n`);
}

if (!existsSync(path.join(repo, 'packages/platform/dist/src/index.js'))) {
  step('Building the framework packages (dist is missing)');
  run('corepack', ['pnpm', 'run', 'build'], repo);
}

step(`Scaffolding ${scratch}`);
rmSync(scratch, { recursive: true, force: true });
run(
  process.execPath,
  [
    path.join(repo, 'packages/platform/cli/main.mjs'),
    'init',
    scratch,
    '--targets',
    'android',
  ],
  repo,
);

step('Copying the demo sources');
rmSync(path.join(scratch, 'src'), { recursive: true, force: true });
cpSync(path.join(here, 'src'), path.join(scratch, 'src'), { recursive: true });
cpSync(
  path.join(here, 'solid-platform.config.json'),
  path.join(scratch, 'solid-platform.config.json'),
);
// The generated NativeScript config carries the id from init; ours is copied
// over the project config, so keep the two in step.
const nsConfig = path.join(scratch, 'targets/android/nativescript.config.ts');
writeFileSync(
  nsConfig,
  readFileSync(nsConfig, 'utf8').replace(
    /id:\s*['"][^'"]+['"]/,
    "id: 'dev.solidapp.amobiledemo'",
  ),
);

step('Locking the demo to portrait');
const manifestFile = path.join(
  scratch,
  'targets/android/App_Resources/Android/src/main/AndroidManifest.xml',
);
writeFileSync(
  manifestFile,
  readFileSync(manifestFile, 'utf8').replace(
    'android:name="com.tns.NativeScriptActivity"',
    'android:name="com.tns.NativeScriptActivity"\n        android:screenOrientation="portrait"',
  ),
);

step('Injecting TMDB_API_KEY');
const key = process.env.TMDB_API_KEY ?? '';
const configFile = path.join(scratch, 'src/config.ts');
const injected = readFileSync(configFile, 'utf8').replace(
  "'__TMDB_API_KEY__'",
  JSON.stringify(key),
);
writeFileSync(configFile, injected);
process.stdout.write(
  key ? 'TMDB key present\n' : 'No TMDB key: bundled catalogue only\n',
);

step(`Restricting the APK to ${abi}`);
const gradleFile = path.join(
  scratch,
  'targets/android/App_Resources/Android/app.gradle',
);
let gradle = readFileSync(gradleFile, 'utf8');
gradle = gradle.replace(
  /ndk\s*\{[\s\S]*?\n\s*\}/,
  `ndk {\n            abiFilters.clear()\n            abiFilters.addAll(['${abi}'])\n        }`,
);
if (!gradle.includes('useLegacyPackaging')) {
  gradle += '\nandroid.packaging.jniLibs.useLegacyPackaging = true\n';
}
writeFileSync(gradleFile, gradle);

step('Installing the app and its Android target');
run('corepack', ['pnpm', 'install', '--no-frozen-lockfile'], scratch);
run(
  'corepack',
  ['pnpm', 'install', '--no-frozen-lockfile'],
  path.join(scratch, 'targets/android'),
);

step('Staging and building the Android target');
run(
  process.execPath,
  [path.join(repo, 'packages/platform/cli/main.mjs'), 'build', 'android'],
  scratch,
);

step('Signing a release build');
const keystore = path.join(scratch, 'mobile-demo.keystore');
const password = 'mobile-demo-pass';
if (!existsSync(keystore)) {
  const keytool = path.join(javaHome, 'bin', 'keytool');
  run(
    existsSync(keytool) ? keytool : 'keytool',
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storetype',
      'PKCS12',
      '-alias',
      'mobile-demo',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      password,
      '-keypass',
      password,
      '-dname',
      'CN=Mobile Demo, OU=Demo, O=Solid Multiplatform, L=Local, ST=Local, C=US',
    ],
    scratch,
  );
}
run(
  'corepack',
  [
    'pnpm',
    'exec',
    'ns',
    'build',
    'android',
    '--release',
    '--env.production',
    '--no-hmr',
    '--key-store-path',
    keystore,
    '--key-store-password',
    password,
    '--key-store-alias',
    'mobile-demo',
    '--key-store-alias-password',
    password,
  ],
  path.join(scratch, 'targets/android'),
);

const outDir = path.join(
  scratch,
  'targets/android/platforms/android/app/build/outputs/apk/release',
);
const apk = readdirSync(outDir)
  .filter((name) => name.endsWith('.apk'))
  .map((name) => path.join(outDir, name))
  .sort((a, b) => statSync(b).size - statSync(a).size)[0];
if (!apk) throw new Error(`No release APK in ${outDir}`);

const target = path.join(here, 'build', `mobile-demo-${arch}.apk`);
mkdirSync(path.dirname(target), { recursive: true });
cpSync(apk, target);
process.stdout.write(
  `\nAPK: ${target}\nSize: ${(statSync(target).size / 1024 / 1024).toFixed(1)} MiB\n`,
);
