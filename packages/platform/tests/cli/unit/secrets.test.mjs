// Device addresses and credentials come from the environment. No command may
// print them, on success or on failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactor } from '../../../cli/context.mjs';
import { adbListing, config, machine } from './helpers.mjs';

const secrets = {
  ROKU_DEV_IP: 'sentinel-roku-address.invalid',
  ROKU_DEV_USERNAME: 'sentinel-roku-user',
  ROKU_DEV_PASSWORD: 'sentinel-roku-password',
  ANDROID_SDK_ROOT: '/sentinel-android/sdk',
  ANDROID_HOME: '/sentinel-android/home',
  ANDROID_SERIAL: 'sentinel-android-serial',
  STORE_PASSWORD: 'sentinel-store-password',
  KEY_PASSWORD: 'sentinel-key-password',
  HERMES_SRC: '/sentinel-hermes/src',
  HERMES_BUILD: '/sentinel-hermes/build',
  TIZEN_SECURITY_PROFILE: 'sentinel-tizen-profile',
};
const signing = {
  android: {
    keystore: 'release.jks',
    alias: 'upload',
    storePasswordEnv: 'STORE_PASSWORD',
    keyPasswordEnv: 'KEY_PASSWORD',
  },
};

// A device module and tools that repeat the device and credential values
// back in what they return and in what they throw. (Toolchain paths such as
// HERMES_SRC are not secrets; commands simply never print them themselves.)
const everything = Object.entries(secrets)
  .filter(([name]) => /^(ROKU_DEV_|ANDROID_)|PASSWORD/.test(name))
  .map(([, value]) => value)
  .join(' ');
const leakyRoku = (fail) => ({
  rokuDevice: (env) => ({ ip: env.ROKU_DEV_IP, password: env.ROKU_DEV_PASSWORD }),
  deviceInfo: async () => {
    if (fail) throw new Error('GET http://' + everything + ' failed');
    return { model: 'Roku Ultra', softwareVersion: '15.0.4', developerEnabled: true };
  },
  sideload: async () => {
    if (fail) throw new Error('Install failed for ' + everything);
  },
  launch: async () => {},
  screenshot: async () => {
    if (fail) throw new Error('Screenshot failed at ' + everything);
    return new Uint8Array([1]);
  },
  readConsole: (_, onLine) => {
    onLine('console: ' + everything);
    return {
      done: fail ? Promise.reject(new Error('lost ' + everything)) : Promise.resolve([]),
      stop() {},
    };
  },
});

const commands = [
  ['--help'],
  ['doctor'],
  ['doctor', 'roku', 'android', 'android-tv', 'desktop', 'tizen', 'ios'],
  ['devices'],
  ['devices', 'roku'],
  ['devices', 'android'],
  ['run', 'roku', '--no-build'],
  ['run', 'android', '--no-build'],
  ['run', 'android-tv', '--no-build', '--device', 'emulator-5554'],
  ['logs', 'roku'],
  ['logs', 'android', '--device', 'emulator-5554'],
  ['screenshot', 'roku', 'shot.png'],
  ['screenshot', 'android', 'shot.png', '--device', 'emulator-5554'],
  ['package', 'android'],
  ['package', 'tizen'],
  ['package', 'roku'],
  ['build', 'web'],
];

for (const fail of [false, true])
  test(`no command prints a device address or credential (${fail ? 'failing' : 'working'} tools)`, async () => {
    for (const argv of commands) {
      const m = machine({
        env: secrets,
        config: config({ signing }),
        tools: ['corepack', 'adb', 'python3'],
        dirs: {
          '/app/targets/roku/dist-roku': ['app.zip'],
          '/sentinel-android/sdk': [],
        },
        files: [
          '/app/targets/android/platforms/android/app/build/outputs/apk/debug/app-debug.apk',
          '/app/targets/android-tv/platforms/android/app/build/outputs/apk/debug/app-debug.apk',
        ],
        rokuDevice: leakyRoku(fail),
        exec: (bin, args) =>
          fail
            ? { status: 1, stderr: 'tool failed: ' + everything }
            : args.join(' ') === 'devices -l'
              ? { stdout: adbListing }
              : { stdout: 'pid 77 ' + everything },
        buildProject: () => {
          if (fail) throw new Error('build failed near ' + everything);
        },
      });
      const code = await m.cli(...argv);
      assert.equal(typeof code, 'number');
      const printed = m.text();
      // A successful build prints only what its tools print.
      if (fail || argv[0] !== 'build')
        assert.ok(printed.length > 0, argv.join(' ') + ' printed nothing');
      for (const [name, value] of Object.entries(secrets))
        assert.ok(
          !printed.includes(value),
          `${argv.join(' ')} printed the value of ${name}`,
        );
      assert.doesNotMatch(printed, /sentinel/, argv.join(' '));
    }
  });

test('the redactor removes device and credential values, longest first', () => {
  const redact = redactor({
    ROKU_DEV_IP: '192.0.2.44',
    ROKU_DEV_PASSWORD: '192.0.2.44-extended',
    ANDROID_SDK_ROOT: '/opt/sdk',
    API_TOKEN: 'abcdef',
    PATH: '/usr/bin',
    SHORT_SECRET: 'ab',
    HOME: '/home/someone',
  });
  assert.equal(
    redact('at 192.0.2.44-extended and 192.0.2.44 in /opt/sdk/ndk with abcdef; /usr/bin /home/someone ab'),
    'at [hidden] and [hidden] in [hidden]/ndk with [hidden]; /usr/bin /home/someone ab',
  );
});

test('the real executable keeps them out of stdout and stderr', () => {
  const main = fileURLToPath(new URL('../../../cli/main.mjs', import.meta.url));
  for (const argv of [
    ['doctor', 'roku', 'android', 'desktop'],
    ['--help'],
    ['logs', 'web'],
  ]) {
    const result = spawnSync(process.execPath, [main, ...argv], {
      env: { ...process.env, ...secrets },
      encoding: 'utf8',
    });
    const printed = result.stdout + result.stderr;
    assert.ok(printed.length > 0);
    assert.doesNotMatch(printed, /sentinel/, argv.join(' '));
    assert.doesNotMatch(printed, /\n {4}at /, argv.join(' '));
  }
});
