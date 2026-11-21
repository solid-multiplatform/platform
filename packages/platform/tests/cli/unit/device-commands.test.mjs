// run, logs, screenshot and package against faked tools. No device is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { findTarget } from '../../../cli/targets/index.mjs';
import { serve } from '../../../cli/serve.mjs';
import { adbListing, config, machine, scratch } from './helpers.mjs';

const apk = (target) =>
  `/app/targets/${target}/platforms/android/app/build/outputs/apk/debug/app-debug.apk`;
const oneEmulator =
  'List of devices attached\nemulator-5554 device product:sdk model:sdk_tv device:emu transport_id:1\n';
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

function androidMachine(target, listing, extra = {}) {
  const written = [];
  const m = machine({
    tools: ['corepack', 'adb'],
    files: [apk(target), `/app/targets/${target}/nativescript.config.ts`],
    readFile: () =>
      `export default {\n  id: 'com.example.demo',\n  appPath: 'app',\n};\n`,
    writeFile: (file, data) => written.push([file, data]),
    exec: (bin, args, options) => {
      const line = args.join(' ');
      if (line === 'devices -l') return { stdout: listing };
      if (line.includes('shell pidof')) return { stdout: '4321\n' };
      if (line.includes('exec-out screencap'))
        return { stdout: options.binary ? png : 'text' };
      return {};
    },
    ...extra,
  });
  return Object.assign(m, { written });
}

test('run android-tv builds, installs on the only device and starts the app', async () => {
  const m = androidMachine('android-tv', oneEmulator);
  assert.equal(await m.cli('run', 'android-tv'), 0);
  assert.deepEqual(m.calls, [
    ['build', 'android-tv', false, false],
    ['/usr/bin/adb', 'devices', '-l'],
    ['/usr/bin/adb', '-s', 'emulator-5554', 'install', '-r', apk('android-tv')],
    [
      '/usr/bin/adb',
      '-s',
      'emulator-5554',
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      'com.example.demo/com.tns.NativeScriptActivity',
    ],
  ]);
  assert.deepEqual(m.out, ['Started com.example.demo on emulator-5554']);
});

test('run android installs nothing when an emulator and a physical device are attached', async () => {
  const m = androidMachine('android', adbListing);
  assert.equal(await m.cli('run', 'android', '--no-build'), 1);
  assert.match(
    m.err[0],
    /^4 Android devices are attached \(1 emulator, 3 physical\)\. Choose one with --device <id>/,
  );
  assert.deepEqual(m.calls, [['/usr/bin/adb', 'devices', '-l']]);
});

test('run android --device installs on exactly that device, without building when asked', async () => {
  const m = androidMachine('android', adbListing);
  assert.equal(
    await m.cli('run', 'android', '--no-build', '--device', 'emulator-5554'),
    0,
  );
  assert.deepEqual(
    m.calls.map((call) => call.slice(1, 4).join(' ')),
    ['devices -l', '-s emulator-5554 install', '-s emulator-5554 shell'],
  );
  const other = androidMachine('android', adbListing);
  assert.equal(
    await other.cli(
      'run',
      'android',
      '--no-build',
      '--device',
      'emulator-7777',
    ),
    1,
  );
  assert.match(other.err[0], /^Device emulator-7777 is not attached/);
  assert.equal(other.calls.length, 1);
});

test('run android stops when the install fails or there is no APK', async () => {
  const failing = androidMachine('android', oneEmulator, {
    exec: (bin, args) =>
      args.join(' ') === 'devices -l'
        ? { stdout: oneEmulator }
        : {
            status: 1,
            stderr:
              'adb: failed to install\nINSTALL_FAILED_INSUFFICIENT_STORAGE\n',
          },
  });
  assert.equal(await failing.cli('run', 'android', '--no-build'), 1);
  assert.deepEqual(failing.err, [
    'adb install failed: INSTALL_FAILED_INSUFFICIENT_STORAGE',
  ]);
  assert.equal(failing.calls.length, 2);

  const unbuilt = machine({ tools: ['corepack', 'adb'] });
  assert.equal(await unbuilt.cli('run', 'android', '--no-build'), 1);
  assert.match(unbuilt.err[0], /^No APK at targets\/android\//);
  assert.deepEqual(unbuilt.calls, []);
});

test('the application id must agree between the config and the native project', async () => {
  const m = androidMachine('android', oneEmulator, {
    config: config({ id: 'com.example.other' }),
  });
  assert.equal(await m.cli('run', 'android', '--no-build'), 1);
  assert.match(
    m.err[0],
    /id is com\.example\.other but targets\/android\/nativescript\.config\.ts builds com\.example\.demo/,
  );
  assert.deepEqual(m.calls, []);
});

test('logs android follows logcat for the pid of the running app', async () => {
  const m = androidMachine('android-tv', oneEmulator);
  assert.equal(await m.cli('logs', 'android-tv'), 0);
  assert.deepEqual(m.calls, [
    ['/usr/bin/adb', 'devices', '-l'],
    [
      '/usr/bin/adb',
      '-s',
      'emulator-5554',
      'shell',
      'pidof',
      'com.example.demo',
    ],
    ['/usr/bin/adb', '-s', 'emulator-5554', 'logcat', '--pid=4321'],
  ]);

  const stopped = androidMachine('android-tv', oneEmulator, {
    exec: (bin, args) =>
      args.join(' ') === 'devices -l' ? { stdout: oneEmulator } : { status: 1 },
  });
  assert.equal(await stopped.cli('logs', 'android-tv'), 1);
  assert.match(
    stopped.err[0],
    /^com\.example\.demo is not running on emulator-5554/,
  );
});

test('screenshot android writes the PNG that screencap returns', async () => {
  const m = androidMachine('android', oneEmulator);
  assert.equal(await m.cli('screenshot', 'android', 'shots/home.png'), 0);
  assert.deepEqual(m.calls.at(-1), [
    '/usr/bin/adb',
    '-s',
    'emulator-5554',
    'exec-out',
    'screencap',
    '-p',
  ]);
  assert.equal(m.written.length, 1);
  assert.equal(m.written[0][0], path.resolve('/app', 'shots/home.png'));
  assert.deepEqual(m.written[0][1], png);

  const broken = androidMachine('android', oneEmulator, {
    exec: (bin, args) =>
      args.join(' ') === 'devices -l'
        ? { stdout: oneEmulator }
        : { stdout: Buffer.from('error: closed') },
  });
  assert.equal(await broken.cli('screenshot', 'android', 'a.png'), 1);
  assert.deepEqual(broken.written, []);
});

test('package android makes a signed release and never prints the passwords', async () => {
  const signing = {
    android: {
      keystore: 'keys/release.jks',
      alias: 'upload',
      storePasswordEnv: 'STORE_PASSWORD',
      keyPasswordEnv: 'KEY_PASSWORD',
    },
  };
  const m = androidMachine('android', oneEmulator, {
    config: config({ signing }),
    env: { STORE_PASSWORD: 'sentinel-store', KEY_PASSWORD: 'sentinel-key' },
  });
  assert.equal(await m.cli('package', 'android'), 0);
  assert.deepEqual(m.calls[0], ['build', 'android', false, false]);
  const release = m.calls[1];
  assert.deepEqual(release.slice(0, 7), [
    'corepack',
    'pnpm',
    'exec',
    'ns',
    'build',
    'android',
    '--release',
  ]);
  assert.equal(
    release[release.indexOf('--key-store-path') + 1],
    '/app/keys/release.jks',
  );
  assert.equal(
    release[release.indexOf('--key-store-password') + 1],
    'sentinel-store',
  );
  assert.equal(
    release[release.indexOf('--key-store-alias-password') + 1],
    'sentinel-key',
  );
  assert.doesNotMatch(m.text(), /sentinel/);

  const unset = androidMachine('android', oneEmulator, {
    config: config({ signing }),
  });
  assert.equal(await unset.cli('package', 'android'), 1);
  assert.deepEqual(unset.err, ['Set STORE_PASSWORD to package android.']);
  assert.deepEqual(unset.calls, []);

  const unconfigured = androidMachine('android', oneEmulator);
  assert.equal(await unconfigured.cli('package', 'android'), 1);
  assert.match(unconfigured.err[0], /signing\.android\.keystore is required/);
});

function rokuMachine(extra = {}) {
  const device = [];
  const written = [];
  const m = machine({
    env: { ROKU_DEV_IP: '192.0.2.44', ROKU_DEV_PASSWORD: 'sentinel-password' },
    dirs: {
      '/app/targets/roku/dist-roku': ['bundle', 'solid-multiplatform.zip'],
    },
    writeFile: (file, data) => written.push([file, data]),
    rokuDevice: {
      rokuDevice: (env) => {
        if (!env.ROKU_DEV_IP || !env.ROKU_DEV_PASSWORD)
          throw new Error(
            'Set ROKU_DEV_IP and ROKU_DEV_PASSWORD to reach a Roku in developer mode.',
          );
        return { ip: env.ROKU_DEV_IP };
      },
      sideload: async (_, zip) => void device.push(['sideload', zip]),
      launch: async (_, id) => void device.push(['launch', id]),
      screenshot: async () => png,
      readConsole: (_, onLine) => {
        for (const line of [
          '[beacon.signal] AppLaunchComplete',
          'connected from 192.0.2.44',
        ])
          onLine(line);
        return { done: Promise.resolve([]), stop() {} };
      },
    },
    ...extra,
  });
  return Object.assign(m, { device, written });
}

test('run roku builds, sideloads the ZIP and launches the developer app', async () => {
  const m = rokuMachine();
  assert.equal(await m.cli('run', 'roku'), 0);
  assert.deepEqual(m.calls, [['build', 'roku', false, false]]);
  assert.deepEqual(m.device, [
    ['sideload', '/app/targets/roku/dist-roku/solid-multiplatform.zip'],
    ['launch', 'dev'],
  ]);
  assert.deepEqual(m.out, [
    'Sideloaded and launched solid-multiplatform.zip on the configured Roku',
  ]);
});

test('run roku without a configured device fails before building', async () => {
  const m = rokuMachine({ env: {} });
  assert.equal(await m.cli('run', 'roku'), 1);
  assert.match(m.err[0], /^Set ROKU_DEV_IP and ROKU_DEV_PASSWORD/);
  assert.deepEqual(m.calls, []);
  assert.deepEqual(m.device, []);
});

test('run roku needs exactly one ZIP', async () => {
  const none = rokuMachine({ dirs: {} });
  assert.equal(await none.cli('run', 'roku', '--no-build'), 1);
  assert.match(none.err[0], /^No ZIP in targets\/roku\/dist-roku/);
  assert.deepEqual(none.device, []);
});

test('logs roku prints console lines with the device address removed', async () => {
  const m = rokuMachine();
  assert.equal(await m.cli('logs', 'roku', '--timeout', '5'), 0);
  assert.deepEqual(m.out, [
    '[beacon.signal] AppLaunchComplete',
    'connected from [hidden]',
  ]);
});

test('screenshot roku writes the image the device returns', async () => {
  const m = rokuMachine();
  assert.equal(await m.cli('screenshot', 'roku', '/tmp/shot.png'), 0);
  assert.deepEqual(m.written, [['/tmp/shot.png', png]]);
});

test('Apple run needs macOS, and on macOS boots, installs and launches in a simulator', async () => {
  const linux = machine();
  assert.equal(await linux.cli('run', 'ios'), 1);
  assert.deepEqual(linux.err, ['run ios needs macOS.']);
  assert.equal(await linux.cli('build', 'apple-tv'), 1);
  assert.deepEqual(linux.calls, []);

  const mac = machine({
    platform: 'darwin',
    exec: (bin, args) => {
      if (bin === 'find')
        return {
          stdout:
            '/app/targets/ios/platforms/ios/build/Debug-iphonesimulator/demo.app\n',
        };
      if (bin.endsWith('PlistBuddy')) return { stdout: 'com.example.demo\n' };
      if (args.join(' ') === 'simctl list devices available -j')
        return {
          stdout: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
                { udid: 'AAAA-1111', name: 'iPhone 17', state: 'Shutdown' },
              ],
            },
          }),
        };
      return {};
    },
  });
  assert.equal(await mac.cli('run', 'ios'), 0);
  assert.deepEqual(
    mac.calls
      .filter(([bin]) => bin === 'xcrun' || bin === 'build')
      .map((c) => c.slice(0, 4).join(' ')),
    [
      'build ios false false',
      'xcrun simctl list devices',
      'xcrun simctl boot AAAA-1111',
      'xcrun simctl install AAAA-1111',
      'xcrun simctl launch AAAA-1111',
    ],
  );
  assert.deepEqual(mac.out, ['Started com.example.demo on iPhone 17']);
});

test('the web server serves the build on localhost only', async (t) => {
  const root = scratch(t, {
    'targets/web/dist/index.html': '<!doctype html><title>demo</title>',
    'targets/web/dist/assets/app.js': 'export {};',
    'secret.txt': 'outside the build',
  });
  const m = machine({ root, exists: existsSync, readFile: readFileSync });
  const server = await findTarget('web').run(m.ctx(), {
    build: false,
    port: 0,
  });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/localhost:\d+\/$/);
  assert.deepEqual(m.out, [
    `Serving targets/web/dist at ${server.url} (Ctrl+C to stop)`,
  ]);
  const index = await fetch(server.url);
  assert.equal(await index.text(), '<!doctype html><title>demo</title>');
  assert.match(index.headers.get('content-type'), /^text\/html/);
  const script = await fetch(server.url + 'assets/app.js');
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  assert.equal((await fetch(server.url + 'missing.js')).status, 404);
  // A client-side route gets the app shell.
  assert.equal((await fetch(server.url + 'settings/profile')).status, 200);
  const escaped = await fetch(server.url + '..%2f..%2f..%2fsecret.txt');
  assert.notEqual(await escaped.text(), 'outside the build');
});

test('run web without a build says how to make one', async (t) => {
  const m = machine({ root: scratch(t), exists: existsSync });
  assert.equal(await m.cli('run', 'web', '--no-build'), 1);
  assert.deepEqual(m.err, [
    'No build at targets/web/dist. Run `solid-platform build web`.',
  ]);
});

test('serve closes cleanly', async (t) => {
  const root = scratch(t, { 'index.html': 'ok' });
  const server = await serve(root);
  assert.equal(await (await fetch(server.url)).text(), 'ok');
  await server.close();
  await assert.rejects(fetch(server.url));
});
