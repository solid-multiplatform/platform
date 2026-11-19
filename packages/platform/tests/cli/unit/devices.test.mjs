import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAdbDevices,
  selectDevice,
} from '../../../cli/families/android.mjs';
import { parseSimulators } from '../../../cli/families/apple.mjs';
import { adbListing, machine } from './helpers.mjs';

const emulator = { serial: 'emulator-5554', state: 'device', kind: 'emulator' };
const second = { serial: 'emulator-5556', state: 'device', kind: 'emulator' };
const phone = { serial: 'R58M00EXAMPLE', state: 'device', kind: 'physical' };
const offline = { serial: '192.0.2.10:5555', state: 'offline', kind: 'physical' };

test('adb devices -l is read into serial, state, kind and model', () => {
  assert.deepEqual(parseAdbDevices(adbListing), [
    {
      serial: 'emulator-5554',
      state: 'device',
      kind: 'emulator',
      model: 'sdk_gphone64_x86_64',
      product: 'sdk_gphone64_x86_64',
    },
    {
      serial: 'R58M00EXAMPLE',
      state: 'device',
      kind: 'physical',
      model: 'SM_G973F',
      product: 'beyond1',
    },
    {
      serial: '192.0.2.10:5555',
      state: 'offline',
      kind: 'physical',
      model: 'Example_TV',
      product: 'tv',
    },
    {
      serial: '0A1B2C3D4E',
      state: 'unauthorized',
      kind: 'physical',
      model: undefined,
      product: undefined,
    },
  ]);
});

test('an empty listing, daemon notices and Windows line endings are handled', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), []);
  assert.deepEqual(
    parseAdbDevices(
      '* daemon not running; starting now at tcp:5037\r\n* daemon started successfully\r\nList of devices attached\r\nemulator-5554\tdevice\r\n',
    ),
    [
      {
        serial: 'emulator-5554',
        state: 'device',
        kind: 'emulator',
        model: undefined,
        product: undefined,
      },
    ],
  );
});

test('one ready device is used without --device, emulator or physical', () => {
  assert.equal(selectDevice([emulator]), emulator);
  assert.equal(selectDevice([phone]), phone);
  assert.equal(selectDevice([phone, offline]), phone);
});

test('a physical device is never chosen when an emulator is also attached', () => {
  for (const devices of [
    [emulator, phone],
    [phone, emulator],
  ])
    assert.throws(
      () => selectDevice(devices),
      /^Error: 2 Android devices are attached \(1 emulator, 1 physical\)\. Choose one with --device <id>/,
    );
});

test('an emulator that is not ready yet still stops an implicit physical choice', () => {
  const starting = { serial: 'emulator-5554', state: 'offline', kind: 'emulator' };
  assert.throws(
    () => selectDevice([starting, phone]),
    /2 Android devices are attached \(1 emulator, 1 physical\)/,
  );
  assert.equal(selectDevice([starting, phone], 'R58M00EXAMPLE'), phone);
  // The other way round is safe: the only ready device is the emulator.
  assert.equal(selectDevice([emulator, offline]), emulator);
});

test('more than one device of any kind requires --device', () => {
  assert.throws(() => selectDevice([emulator, second]), /Choose one with --device/);
  assert.equal(selectDevice([emulator, second, phone], 'emulator-5556'), second);
  assert.equal(selectDevice([emulator, phone], 'R58M00EXAMPLE'), phone);
});

test('--device must name an attached, ready device', () => {
  assert.throws(
    () => selectDevice([emulator], 'emulator-9999'),
    /Device emulator-9999 is not attached/,
  );
  assert.throws(
    () => selectDevice([emulator, offline], '192.0.2.10:5555'),
    /is offline, not ready/,
  );
  assert.throws(() => selectDevice([]), /No Android device is attached/);
  assert.throws(() => selectDevice([offline]), /No Android device is attached/);
});

test('devices android lists attached devices by kind, then the AVDs', async () => {
  const m = machine({
    tools: ['corepack', 'adb', 'emulator'],
    exec: (bin, args) =>
      bin.endsWith('adb') && args.join(' ') === 'devices -l'
        ? { stdout: adbListing }
        : bin.endsWith('emulator') && args[0] === '-list-avds'
          ? { stdout: 'INFO    | Storing crashdata in: /tmp\nPixel_9_API_36\nTelevision_1080p\n' }
          : undefined,
  });
  assert.equal(await m.cli('devices', 'android'), 0);
  assert.deepEqual(m.out, [
    'android  emulator  emulator-5554  device  sdk_gphone64_x86_64',
    'android  physical  R58M00EXAMPLE  device  SM_G973F',
    'android  physical  192.0.2.10:5555  offline  Example_TV',
    'android  physical  0A1B2C3D4E  unauthorized',
    'android  avd       Pixel_9_API_36',
    'android  avd       Television_1080p',
  ]);
  assert.deepEqual(m.calls, [
    ['/usr/bin/adb', 'devices', '-l'],
    ['/usr/bin/emulator', '-list-avds'],
  ]);
});

test('devices android without adb is one line, exit code 1', async () => {
  const m = machine();
  assert.equal(await m.cli('devices', 'android-tv'), 1);
  assert.deepEqual(m.err, [
    'adb not found. Install the Android SDK platform-tools and add them to PATH.',
  ]);
});

const rokuEnv = {
  ROKU_DEV_IP: '192.0.2.44',
  ROKU_DEV_USERNAME: 'sentinel-user',
  ROKU_DEV_PASSWORD: 'sentinel-password',
};
const rokuModule = (overrides = {}) => ({
  rokuDevice: (env) => ({ ip: env.ROKU_DEV_IP, password: env.ROKU_DEV_PASSWORD }),
  deviceInfo: async () => ({
    model: 'Roku Ultra',
    softwareVersion: '15.0.4',
    developerEnabled: true,
  }),
  ...overrides,
});

test('devices roku shows the model and OS of the configured device, never its address', async () => {
  const m = machine({ env: rokuEnv, rokuDevice: rokuModule() });
  assert.equal(await m.cli('devices', 'roku'), 0);
  assert.deepEqual(m.out, [
    'roku  configured device  Roku Ultra  Roku OS 15.0.4  developer mode on',
  ]);
  assert.doesNotMatch(m.text(), /192\.0\.2\.44|sentinel/);
});

test('devices roku says what to set when no device is configured', async () => {
  const m = machine({ rokuDevice: rokuModule() });
  assert.equal(await m.cli('devices', 'roku'), 0);
  assert.deepEqual(m.out, [
    'roku  no device configured; set ROKU_DEV_IP and ROKU_DEV_PASSWORD',
  ]);
});

test('an unreachable Roku is reported without the address in the network error', async () => {
  const m = machine({
    env: rokuEnv,
    rokuDevice: rokuModule({
      deviceInfo: async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED 192.0.2.44:8060'), {
            code: 'ECONNREFUSED',
          }),
        });
      },
    }),
  });
  assert.equal(await m.cli('devices', 'roku'), 1);
  assert.deepEqual(m.err, [
    'Reading the Roku failed: the configured Roku did not answer (ECONNREFUSED).',
  ]);

  const leaky = machine({
    env: rokuEnv,
    rokuDevice: rokuModule({
      deviceInfo: async () => {
        throw new Error('GET http://192.0.2.44:8060/query/device-info: 403');
      },
    }),
  });
  assert.equal(await leaky.cli('devices', 'roku'), 1);
  assert.deepEqual(leaky.err, [
    'Reading the Roku failed: GET http://[hidden]:8060/query/device-info: 403',
  ]);
});

const simctl = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
      { udid: 'AAAA-1111', name: 'iPhone 17', state: 'Shutdown' },
      { udid: 'AAAA-2222', name: 'iPad Air', state: 'Booted' },
    ],
    'com.apple.CoreSimulator.SimRuntime.tvOS-26-2': [
      { udid: 'BBBB-1111', name: 'Apple TV 4K', state: 'Shutdown' },
    ],
  },
});

test('Apple simulators are listed per runtime on macOS', async () => {
  assert.deepEqual(
    parseSimulators(simctl, 'tvOS').map((s) => s.udid),
    ['BBBB-1111'],
  );
  const m = machine({
    platform: 'darwin',
    exec: (bin, args) =>
      bin === 'xcrun' && args.join(' ') === 'simctl list devices available -j'
        ? { stdout: simctl }
        : undefined,
  });
  assert.equal(await m.cli('devices', 'ios'), 0);
  assert.deepEqual(m.out, [
    'ios  simulator  AAAA-1111  shutdown  iPhone 17 (iOS-26-2)',
    'ios  simulator  AAAA-2222  booted  iPad Air (iOS-26-2)',
  ]);
});

test('Apple devices away from macOS say so', async () => {
  const m = machine();
  assert.equal(await m.cli('devices', 'apple-tv'), 0);
  assert.deepEqual(m.out, ['apple-tv  needs macOS']);
  assert.deepEqual(m.calls, []);
});

test('devices without a target covers each device family once and keeps going', async () => {
  const m = machine({
    tools: ['corepack', 'adb'],
    exec: (bin, args) =>
      bin.endsWith('adb') && args[0] === 'devices'
        ? { stdout: 'List of devices attached\n' }
        : undefined,
  });
  assert.equal(await m.cli('devices'), 0);
  assert.deepEqual(m.out, [
    'roku  no device configured; set ROKU_DEV_IP and ROKU_DEV_PASSWORD',
    'android  no device attached',
    'android  avd       emulator tool not found',
    'ios  needs macOS',
  ]);
});
