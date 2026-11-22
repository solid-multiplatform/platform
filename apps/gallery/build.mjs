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
const tv = process.argv.includes('--tv');
const roku = process.argv.includes('--roku');
const skipAudit = process.argv.includes('--skip-audit');
const targetName = roku ? 'roku' : tv ? 'android-tv' : 'android';
const arch = arm64 ? 'arm64' : 'x86_64';
const abi = arm64 ? 'arm64-v8a' : 'x86_64';
const scratch = roku
  ? '/var/tmp/smp-gallery-roku'
  : `/var/tmp/smp-gallery-${tv ? 'tv-' : ''}${arch === 'x86_64' ? 'x86' : arch}`;
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

// The audit is a build gate: it renders the real screens at the smallest
// phone, a Pixel 7 Pro, a 540-pt TV, Roku at 1080p and a desktop window, then
// reads the boxes back. A calendar column hanging off the right edge or a
// sheet footer below a short screen stops the build with the node named.
if (!skipAudit) {
  step('Auditing layout at phone, TV, Roku and desktop sizes');
  run(
    process.execPath,
    [path.join(repo, 'packages/platform/scripts/layout-audit.mjs')],
    repo,
  );
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
    targetName,
  ],
  repo,
);

step('Copying the gallery sources');
rmSync(path.join(scratch, 'src'), { recursive: true, force: true });
cpSync(path.join(here, 'src'), path.join(scratch, 'src'), { recursive: true });
// The CLI expects the app as `src/app.tsx`; the repo's file is `app-entry.tsx`
// so it does not collide with `App.tsx` on a case-insensitive filesystem.
if (roku) {
  // Roku's bundler (esbuild) sees `App.tsx` and `app.tsx` as one name and
  // resolves `./App` to the wrong file. Give the screen another name there.
  const srcDir = path.join(scratch, 'src');
  cpSync(path.join(srcDir, 'App.tsx'), path.join(srcDir, 'app-shell.tsx'));
  const entry = path.join(srcDir, 'app-entry.tsx');
  writeFileSync(
    entry,
    readFileSync(entry, 'utf8').replace("from './App'", "from './app-shell'"),
  );
  rmSync(path.join(srcDir, 'App.tsx'));
}
writeFileSync(
  path.join(scratch, 'src/app.tsx'),
  "import { App } from './app-entry';\nexport default App;\n",
);
const projectConfig = JSON.parse(
  readFileSync(path.join(here, 'solid-platform.config.json'), 'utf8'),
);
projectConfig.targets = [targetName];
writeFileSync(
  path.join(scratch, 'solid-platform.config.json'),
  JSON.stringify(projectConfig, null, 2) + '\n',
);
// A Roku target has no NativeScript config; only the Android targets do.
if (!roku) {
  const nsConfig = path.join(
    scratch,
    `targets/${targetName}/nativescript.config.ts`,
  );
  writeFileSync(
    nsConfig,
    readFileSync(nsConfig, 'utf8').replace(
      /id:\s*['"][^'"]+['"]/,
      "id: 'dev.solidapp.sona'",
    ),
  );
}

if (!tv && !roku) {
  step('Locking the gallery to portrait');
  const manifestFile = path.join(
    scratch,
    `targets/${targetName}/App_Resources/Android/src/main/AndroidManifest.xml`,
  );
  writeFileSync(
    manifestFile,
    readFileSync(manifestFile, 'utf8').replace(
      'android:name="com.tns.NativeScriptActivity"',
      'android:name="com.tns.NativeScriptActivity"\n        android:screenOrientation="portrait"',
    ),
  );
  // The app's own palette for the parts Android draws (the editor caret and
  // any native chrome), instead of the framework example's teal.
  const stylesFile = path.join(
    scratch,
    `targets/${targetName}/App_Resources/Android/src/main/res/values/styles.xml`,
  );
  if (existsSync(stylesFile)) {
    writeFileSync(
      stylesFile,
      readFileSync(stylesFile, 'utf8')
        .replace(/android:colorAccent">[^<]*</, 'android:colorAccent">#E2603F<')
        .replace(
          /android:windowBackground">[^<]*</,
          'android:windowBackground">#08080A<',
        ),
    );
  }
}

step('Installing the gallery fonts (Roboto regular and bold)');
const fontSource = path.join(repo, 'packages/platform/bench/public/fonts');
const fontTarget = path.join(
  scratch,
  roku ? 'targets/roku/fonts' : 'assets/fonts',
);
rmSync(fontTarget, { recursive: true, force: true });
mkdirSync(fontTarget, { recursive: true });
if (roku) {
  // Roku loads the packaged TTF; the family/weight come from app.fonts.
  const ttfSource = path.join(
    repo,
    'packages/platform/tests/roku-device/fonts',
  );
  for (const name of ['Roboto-Regular.ttf', 'Roboto-Bold.ttf'])
    cpSync(path.join(ttfSource, name), path.join(fontTarget, name));
} else {
  for (const name of readdirSync(fontSource))
    if (/^Roboto-(Regular|Bold)\.msdf\.(json|png)$/.test(name))
      cpSync(path.join(fontSource, name), path.join(fontTarget, name));
}

if (!roku) {
  step(`Restricting the APK to ${abi}`);
  const gradleFile = path.join(
    scratch,
    `targets/${targetName}/App_Resources/Android/app.gradle`,
  );
  let gradle = readFileSync(gradleFile, 'utf8');
  gradle = gradle.replace(
    /ndk\s*\{[\s\S]*?\n\s*\}/,
    `ndk {\n            abiFilters.clear()\n            abiFilters.addAll(['${abi}'])\n        }`,
  );
  if (!gradle.includes('useLegacyPackaging'))
    gradle += '\nandroid.packaging.jniLibs.useLegacyPackaging = true\n';
  // Every build is an upgrade: a versionCode that never changes makes the
  // package installer treat a tap-to-install as a reinstall, and some
  // launchers keep showing the old build's label.
  const built = new Date();
  const versionCode = Math.floor(built.getTime() / 60000);
  const stamp = built.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const versionName = `${projectConfig.version}+${stamp}`;
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+'[^']*'/, `versionName '${versionName}'`);
  writeFileSync(gradleFile, gradle);
  console.log(`Version: ${versionName} (${versionCode})`);
}

step('Installing the app and its target');
run('corepack', ['pnpm', 'install', '--no-frozen-lockfile'], scratch);
run(
  'corepack',
  ['pnpm', 'install', '--no-frozen-lockfile'],
  path.join(scratch, `targets/${targetName}`),
);

step('Staging and building the Android target');
run(
  process.execPath,
  [path.join(repo, 'packages/platform/cli/main.mjs'), 'build', targetName],
  scratch,
);

if (roku) {
  step('Collecting the Roku package');
  const candidates = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(pkg|zip)$/.test(entry.name)) candidates.push(full);
    }
  };
  walk(path.join(scratch, 'targets/roku'));
  if (candidates.length === 0) throw new Error('No Roku package produced');
  const out = path.join(here, 'build');
  mkdirSync(out, { recursive: true });
  const destination = path.join(out, 'gallery-roku.pkg');
  cpSync(candidates[0], destination);
  console.log(`\nPackage: ${destination}`);
  process.exit(0);
}

step('Signing a release build');
const keystore = path.join(here, 'build', 'gallery.keystore');
const password = 'gallery-pass';
mkdirSync(path.join(here, 'build'), { recursive: true });
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
  path.join(scratch, `targets/${targetName}`),
);

step('Copying the APK');
const built = path.join(
  scratch,
  `targets/${targetName}/platforms/android/app/build/outputs/apk/release/app-release.apk`,
);
const out = path.join(here, 'build');
mkdirSync(out, { recursive: true });
const destination = path.join(out, `gallery${tv ? '-tv' : ''}-${arch}.apk`);
cpSync(built, destination);
const size = (readFileSync(destination).length / (1024 * 1024)).toFixed(1);
console.log(`\nAPK: ${destination}\nSize: ${size} MiB`);
