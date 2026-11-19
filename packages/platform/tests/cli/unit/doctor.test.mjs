import test from 'node:test';
import assert from 'node:assert/strict';
import { config, java21, machine } from './helpers.mjs';

const sdk = '/opt/android-sdk';
const android = (extra = {}) =>
  machine({
    env: { ANDROID_SDK_ROOT: sdk, JAVA_HOME: '/opt/jdk21' },
    tools: ['corepack', 'adb'],
    dirs: { [sdk]: [], [sdk + '/ndk']: ['27.1.12297006', '28.2.13676358'] },
    exec: java21,
    ...extra,
  });
const line = (m, target, name) =>
  m.out.find((l) => new RegExp(`^\\w+ +${target} +${name} `).test(l));

test('a ready Android machine passes, one line per check', async () => {
  const m = android();
  assert.equal(await m.cli('doctor', 'android'), 0);
  assert.deepEqual(
    m.out.map((l) => l.split(/\s+/).slice(0, 3).join(' ')),
    [
      'ok all node',
      'ok all pnpm',
      'ok android java',
      'ok android android-sdk',
      'ok android android-ndk',
      'ok android adb',
    ],
  );
  assert.match(line(m, 'android', 'android-ndk'), /NDK 28\.2\.13676358$/);
  assert.deepEqual(m.err, []);
});

test('the wrong JDK is missing, with the fix, and fails the target', async () => {
  const m = android({
    exec: (bin, args) =>
      args[0] === '-version'
        ? { stderr: 'openjdk version "17.0.13" 2024-10-15\n' }
        : undefined,
  });
  assert.equal(await m.cli('doctor', 'android-tv'), 1);
  assert.match(
    line(m, 'android-tv', 'java'),
    /^missing .*JDK 17 found; install JDK 21 and point JAVA_HOME at it$/,
  );
  assert.deepEqual(m.err, ['Cannot build: android-tv']);
});

test('no SDK fails the build; no adb or NDK only limits device commands', async () => {
  const none = machine({ exec: java21, tools: ['corepack', 'java'] });
  assert.equal(await none.cli('doctor', 'android'), 1);
  assert.match(
    line(none, 'android', 'android-sdk'),
    /^missing .*set ANDROID_SDK_ROOT/,
  );

  const bare = android({ tools: ['corepack'], dirs: { [sdk]: [] } });
  assert.equal(await bare.cli('doctor', 'android'), 0);
  assert.match(line(bare, 'android', 'adb'), /^missing /);
  assert.match(line(bare, 'android', 'android-ndk'), /^missing /);
});

test('adb inside the SDK counts when it is not on PATH', async () => {
  const m = android({
    tools: ['corepack'],
    files: [sdk + '/platform-tools/adb'],
  });
  assert.equal(await m.cli('doctor', 'android'), 0);
  assert.match(line(m, 'android', 'adb'), /^ok /);
});

test('an old Node or a missing pnpm fails every target', async () => {
  const old = machine({ nodeVersion: '20.11.0' });
  assert.equal(await old.cli('doctor', 'web'), 1);
  assert.match(
    old.out[0],
    /^missing +all +node +Node 20\.11\.0 found; install Node 24/,
  );

  const noPnpm = machine({ tools: [] });
  assert.equal(await noPnpm.cli('doctor', 'web', 'vizio'), 1);
  assert.match(noPnpm.out[1], /^missing +all +pnpm /);
  assert.equal(noPnpm.out.length, 2);
  assert.deepEqual(noPnpm.err, ['Cannot build: web, vizio']);
});

test('Apple targets need macOS: fatal when named, skipped when only listed by the app', async () => {
  const named = machine();
  assert.equal(await named.cli('doctor', 'ios'), 1);
  assert.deepEqual(named.out, [
    'skipped ios         xcode               needs macOS',
  ]);

  const listed = machine({
    config: config({ targets: ['web', 'apple-tv'] }),
    files: ['/app/solid-platform.config.json'],
  });
  assert.equal(await listed.cli('doctor'), 0);
  assert.match(listed.out.at(-1), /^skipped apple-tv +xcode +needs macOS$/);
});

test('on macOS the Apple targets check Xcode and the simulator', async () => {
  const m = machine({
    platform: 'darwin',
    exec: (bin, args) =>
      bin === 'xcodebuild'
        ? { stdout: 'Xcode 26.3\nBuild version 17C52\n' }
        : bin === 'xcrun' && args[0] === 'simctl'
          ? {}
          : undefined,
  });
  assert.equal(await m.cli('doctor', 'ios'), 0);
  assert.match(line(m, 'ios', 'xcode'), /^ok .*Xcode 26\.3$/);
  assert.match(line(m, 'ios', 'simulator'), /^ok /);

  const without = machine({ platform: 'darwin' });
  assert.equal(await without.cli('doctor', 'apple-tv'), 1);
  assert.match(line(without, 'apple-tv', 'xcode'), /^missing .*install Xcode/);
});

test('Roku reports only whether the device variables are set', async () => {
  const unset = machine({ tools: ['corepack', 'python3'] });
  assert.equal(await unset.cli('doctor', 'roku'), 0);
  assert.match(line(unset, 'roku', 'ROKU_DEV_IP'), /^missing .*not set/);
  assert.match(line(unset, 'roku', 'ROKU_DEV_PASSWORD'), /^missing .*not set/);

  const set = machine({
    tools: ['corepack', 'python3'],
    env: {
      ROKU_DEV_IP: '192.0.2.44',
      ROKU_DEV_USERNAME: 'sentinel-user',
      ROKU_DEV_PASSWORD: 'sentinel-password',
    },
  });
  assert.equal(await set.cli('doctor', 'roku'), 0);
  assert.match(
    line(set, 'roku', 'ROKU_DEV_IP'),
    /^ok +roku +ROKU_DEV_IP +set$/,
  );
  assert.match(line(set, 'roku', 'ROKU_DEV_PASSWORD'), /^ok .* set$/);
  assert.doesNotMatch(set.text(), /192\.0\.2\.44|sentinel/);

  const noPython = machine();
  assert.equal(await noPython.cli('doctor', 'roku'), 1);
});

test('the Tizen CLI is needed only when a signing profile is set', async () => {
  const unsigned = machine();
  assert.equal(await unsigned.cli('doctor', 'tizen'), 0);
  assert.match(line(unsigned, 'tizen', 'tizen-cli'), /^skipped /);

  const fromConfig = machine({
    config: config({ signing: { tizen: { profile: 'release' } } }),
  });
  assert.equal(await fromConfig.cli('doctor', 'tizen'), 1);
  assert.match(
    line(fromConfig, 'tizen', 'tizen-cli'),
    /^missing .*Tizen Studio/,
  );

  const fromEnv = machine({
    env: { TIZEN_SECURITY_PROFILE: 'release' },
    tools: ['corepack', 'tizen'],
  });
  assert.equal(await fromEnv.cli('doctor', 'tizen'), 0);
  assert.match(line(fromEnv, 'tizen', 'tizen-cli'), /^ok /);
});

test('webOS finds ares-package in the target once a build installed it', async () => {
  const before = machine();
  assert.equal(await before.cli('doctor', 'webos'), 0);
  assert.match(line(before, 'webos', 'webos-cli'), /^skipped /);
  const after = machine({
    files: ['/app/targets/webos/node_modules/.bin/ares-package'],
  });
  assert.equal(await after.cli('doctor', 'webos'), 0);
  assert.match(line(after, 'webos', 'webos-cli'), /^ok /);
});

test('desktop checks the runtime the host package resolves', async () => {
  const saved = process.env.SOLID_DESKTOP_RUNTIME;
  try {
    process.env.SOLID_DESKTOP_RUNTIME = process.execPath;
    const named = machine();
    assert.equal(await named.cli('doctor', 'desktop'), 0);
    assert.match(line(named, 'desktop', 'runtime'), /^ok .*environment/);
  } finally {
    if (saved === undefined) delete process.env.SOLID_DESKTOP_RUNTIME;
    else process.env.SOLID_DESKTOP_RUNTIME = saved;
  }

  const none = machine();
  assert.equal(await none.cli('doctor', 'desktop'), 1);
  assert.match(line(none, 'desktop', 'runtime'), /^missing .*add desktop none/);
});

test('without arguments doctor checks the app targets, or all targets outside an app', async () => {
  const inApp = machine({
    config: config({ targets: ['web', 'vizio'] }),
    files: ['/app/solid-platform.config.mjs'],
  });
  assert.equal(await inApp.cli('doctor'), 0);
  assert.equal(inApp.out.length, 2);

  const outside = machine({ tools: ['corepack', 'python3'] });
  await outside.cli('doctor');
  for (const target of [
    'roku',
    'android',
    'android-tv',
    'ios',
    'apple-tv',
    'desktop',
  ])
    assert.ok(
      outside.out.some((l) => l.split(/\s+/)[1] === target),
      target,
    );
});

test('doctor refuses a target it does not know', async () => {
  const m = machine();
  assert.equal(await m.cli('doctor', 'web', 'xbox'), 1);
  assert.match(m.err[0], /^Unknown target: xbox\./);
  assert.deepEqual(m.out, []);
});
