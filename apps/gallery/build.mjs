#!/usr/bin/env node
/**
 * Build the gallery into a signed Android APK.
 *
 * The source here is the app. The CLI needs an `init`ed project (vendor
 * tarballs, an Android target, fonts), so this scaffolds one in a scratch
 * directory, copies `src/` and the project config over it, swaps the fonts
 * for the gallery's (Roboto regular and bold), and builds there:
 *
 *   node apps/gallery/build.mjs [--arm64]
 * Output: build/gallery-<arch>.apk
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const arm64 = process.argv.includes('--arm64');
const arch = arm64 ? 'arm64' : 'x86_64';
const abi = arm64 ? 'arm64-v8a' : 'x86_64';
const scratch = `/var/tmp/smp-gallery-${arch}`;
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
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const step = (text) => process.stdout.write(`\n== ${text}\n`);

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

step('Copying the gallery sources');
rmSync(path.join(scratch, 'src'), { recursive: true, force: true });
cpSync(path.join(here, 'src'), path.join(scratch, 'src'), { recursive: true });
cpSync(
  path.join(here, 'solid-platform.config.json'),
  path.join(scratch, 'solid-platform.config.json'),
);
const nsConfig = path.join(scratch, 'targets/android/nativescript.config.ts');
writeFileSync(
  nsConfig,
  readFileSync(nsConfig, 'utf8').replace(
    /id:\s*['"][^'"]+['"]/,
    "id: 'dev.solidapp.sona'",
  ),
);

step('Locking the gallery to portrait');
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

step('Installing the gallery fonts (Roboto regular and bold)');
const fontSource = path.join(repo, 'packages/platform/bench/public/fonts');
const fontTarget = path.join(scratch, 'assets/fonts');
rmSync(fontTarget, { recursive: true, force: true });
mkdirSync(fontTarget, { recursive: true });
for (const name of readdirSync(fontSource))
  if (/^Roboto-(Regular|Bold)\.msdf\.(json|png)$/.test(name))
    cpSync(path.join(fontSource, name), path.join(fontTarget, name));

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
if (!gradle.includes('useLegacyPackaging'))
  gradle += '\nandroid.packaging.jniLibs.useLegacyPackaging = true\n';
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
const keystore = path.join(scratch, 'gallery.keystore');
const password = 'gallery-pass';
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
      'gallery',
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
      'CN=Sona Gallery, OU=Gallery, O=Solid Multiplatform, L=Local, ST=Local, C=US',
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
    'gallery',
    '--key-store-alias-password',
    password,
  ],
  path.join(scratch, 'targets/android'),
);

step('Copying the APK');
const built = path.join(
  scratch,
  'targets/android/platforms/android/app/build/outputs/apk/release/app-release.apk',
);
const out = path.join(here, 'build');
mkdirSync(out, { recursive: true });
const destination = path.join(out, `gallery-${arch}.apk`);
cpSync(built, destination);
const size = (readFileSync(destination).length / (1024 * 1024)).toFixed(1);
console.log(`\nAPK: ${destination}\nSize: ${size} MiB`);
