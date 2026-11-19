import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfig, validateConfig } from '../../../cli/config.mjs';
import { project } from '../../../cli/files.mjs';
import { packageTV } from '../../../cli/tv-package.mjs';
import { scratch } from './helpers.mjs';

const good = {
  id: 'com.example.app',
  name: 'my-app',
  version: '1.4.0',
  targets: ['web', 'roku', 'android-tv'],
  app: {
    fonts: [{ family: 'Lato', atlas: 'Lato-Regular.msdf', file: 'Lato.ttf' }],
    designSize: { width: 1920, height: 1080 },
    theme: 'dark',
  },
  icons: { default: 'assets/icon.png' },
  splash: 'assets/splash.png',
  deepLinks: { schemes: ['myapp'], hosts: ['example.com'] },
  services: ['storage', 'network'],
  signing: {
    'android-tv': {
      keystore: 'release.jks',
      alias: 'upload',
      storePasswordEnv: 'STORE_PASSWORD',
      keyPasswordEnv: 'KEY_PASSWORD',
    },
    tizen: { profile: 'release' },
  },
};

// assert.throws matches a pattern against "Error: message"; these patterns
// are anchored to the message itself.
const throwsMessage = (fn, pattern) =>
  assert.throws(fn, (error) => {
    assert.match(error.message, pattern);
    return true;
  });

test('a complete config is returned as written, with its source', () => {
  assert.deepEqual(validateConfig(good, 'solid-platform.config.json'), {
    ...good,
    desktop: { titleBar: undefined },
    source: 'solid-platform.config.json',
  });
});

test('the desktop title bar mode is validated', () => {
  for (const titleBar of ['native', 'custom', 'hidden'])
    assert.deepEqual(
      validateConfig({ ...good, desktop: { titleBar } }).desktop,
      { titleBar },
    );
  assert.throws(
    () => validateConfig({ ...good, desktop: 'custom' }),
    /desktop: expected \{ titleBar \}/,
  );
  assert.throws(
    () => validateConfig({ ...good, desktop: { titlebar: 'custom' } }),
    /desktop\.titlebar: unknown key \(known: titleBar\)/,
  );
  assert.throws(
    () => validateConfig({ ...good, desktop: { titleBar: 'frameless' } }),
    /desktop\.titleBar: expected one of native, custom, hidden/,
  );
});

test('optional sections get empty defaults', () => {
  const config = validateConfig({ name: 'my-app', targets: ['web'] });
  assert.deepEqual(config.deepLinks, { schemes: [], hosts: [] });
  assert.deepEqual(config.services, []);
  assert.deepEqual(config.signing, {});
  // No desktop section: the native title bar, the runtime's default.
  assert.deepEqual(config.desktop, { titleBar: undefined });
  // No `app` section: fonts by convention, no design size, the system theme.
  assert.deepEqual(config.app, {
    fonts: undefined,
    designSize: undefined,
    theme: undefined,
  });
  assert.equal(config.id, undefined);
  assert.equal(config.version, undefined);
});

test('each mistake is reported with the file and the key path', () => {
  const cases = [
    [null, /^app\.json: expected an object$/],
    [{ targets: ['web'] }, /^app\.json: name: required string$/],
    [{ name: 'My App', targets: ['web'] }, /^app\.json: name: Use a lowercase/],
    [{ name: 'my-app' }, /^app\.json: targets: required non-empty array/],
    [{ name: 'my-app', targets: 'web' }, /^app\.json: targets: required/],
    [{ name: 'my-app', targets: [] }, /^app\.json: targets: required/],
    [
      { name: 'my-app', targets: ['web', 'playstation'] },
      /^app\.json: targets\[1\]: unknown target "playstation" \(available: web, /,
    ],
    [{ name: 'my-app', targets: ['web', 7] }, /^app\.json: targets\[1\]: unknown target 7/],
    [{ name: 'my-app', targets: ['web', 'web'] }, /targets: lists a target twice/],
    [{ ...good, id: 'not an id' }, /^app\.json: id: expected a reverse-DNS/],
    [{ ...good, version: 2 }, /^app\.json: version: expected a version/],
    [{ ...good, version: 'two' }, /^app\.json: version: /],
    [{ ...good, icons: 4 }, /^app\.json: icons: expected a file path/],
    [{ ...good, icons: { large: 1 } }, /^app\.json: icons\.large: expected a string/],
    [{ ...good, deepLinks: [] }, /^app\.json: deepLinks: expected/],
    [
      { ...good, deepLinks: { schemes: 'myapp' } },
      /^app\.json: deepLinks\.schemes: expected an array of strings/,
    ],
    [
      { ...good, deepLinks: { schemes: ['myapp://'] } },
      /^app\.json: deepLinks\.schemes\[0\]: expected a URL scheme/,
    ],
    [{ ...good, deepLinks: { hosts: [5] } }, /^app\.json: deepLinks\.hosts\[0\]: /],
    [{ ...good, deepLinks: { paths: [] } }, /^app\.json: deepLinks\.paths: unknown key/],
    [{ ...good, services: {} }, /^app\.json: services: expected an array/],
    [{ ...good, services: ['ok', ''] }, /^app\.json: services\[1\]: /],
    [{ ...good, signing: [] }, /^app\.json: signing: expected an object/],
    [{ ...good, signing: { xbox: {} } }, /^app\.json: signing\.xbox: unknown target/],
    [{ ...good, signing: { android: 'yes' } }, /^app\.json: signing\.android: expected an object/],
    [
      { ...good, signing: { android: { alias: 3 } } },
      /^app\.json: signing\.android\.alias: expected a string/,
    ],
    [
      { ...good, signing: { android: { storePassword: 'hunter2' } } },
      /^app\.json: signing\.android\.storePassword: do not store credentials/,
    ],
    [{ ...good, colour: 'red' }, /^app\.json: colour: unknown key/],
    [{ ...good, app: [] }, /^app\.json: app: expected \{ fonts, designSize, theme \}$/],
    [{ ...good, app: { font: [] } }, /^app\.json: app\.font: unknown key/],
    [
      { ...good, app: { fonts: [{ atlas: 'Lato.msdf' }] } },
      /^app\.json: app\.fonts\[0\]\.family: required string$/,
    ],
    [
      { ...good, app: { fonts: [{ family: 'Lato' }] } },
      /^app\.json: app\.fonts\[0\]: needs an atlas/,
    ],
    [
      { ...good, app: { fonts: [{ family: 'Lato', atlas: '../Lato.msdf' }] } },
      /^app\.json: app\.fonts\[0\]\.atlas: expected a file name without a directory$/,
    ],
    [
      { ...good, app: { designSize: { width: 1920 } } },
      /^app\.json: app\.designSize: expected \{ width, height \}/,
    ],
    [
      { ...good, app: { designSize: { width: 0, height: 1080 } } },
      /^app\.json: app\.designSize: expected \{ width, height \}/,
    ],
    [{ ...good, app: { theme: 'blue' } }, /^app\.json: app\.theme: expected one of system, light, dark$/],
  ];
  for (const [raw, expected] of cases)
    throwsMessage(() => validateConfig(raw, 'app.json'), expected);
});

test('a rejected credential is not repeated in the error', () => {
  assert.throws(
    () =>
      validateConfig({
        ...good,
        signing: { android: { password: 'SENTINEL-CONFIG-PASSWORD' } },
      }),
    (error) => !error.message.includes('SENTINEL-CONFIG-PASSWORD'),
  );
});

test('json, mjs and js config files load, in that order of preference', (t) => {
  const json = scratch(t, {
    'solid-platform.config.json': JSON.stringify(good),
  });
  assert.equal(loadConfig(json).name, 'my-app');
  assert.equal(loadConfig(json).source, 'solid-platform.config.json');
  assert.deepEqual(project(json), loadConfig(json));

  const mjs = scratch(t, {
    'solid-platform.config.mjs': `export default { name: 'from-mjs', targets: ['web'] };\n`,
    'solid-platform.config.json': JSON.stringify(good),
  });
  assert.equal(loadConfig(mjs).name, 'from-mjs');
  assert.equal(loadConfig(mjs).source, 'solid-platform.config.mjs');

  const js = scratch(t, {
    'package.json': '{"type":"module"}',
    'solid-platform.config.js': `const targets = ['web', 'desktop'];\nexport default { name: 'from-js', targets };\n`,
  });
  assert.deepEqual(loadConfig(js).targets, ['web', 'desktop']);
});

test('an app from before the config file still loads from solid-platform.json', (t) => {
  const root = scratch(t, {
    'solid-platform.json': '{"name":"old-app","targets":["web","tizen"]}',
  });
  const config = project(root);
  assert.equal(config.name, 'old-app');
  assert.deepEqual(config.targets, ['web', 'tizen']);
  assert.equal(config.id, undefined);
  assert.equal(config.source, 'solid-platform.json');
});

test('loading reports a missing, unreadable or invalid file by name', (t) => {
  throwsMessage(() => loadConfig(scratch(t)), /^No solid-platform\.config\.json in /);
  throwsMessage(
    () => loadConfig(scratch(t, { 'solid-platform.config.json': '{oops' })),
    /^solid-platform\.config\.json: /,
  );
  throwsMessage(
    () =>
      loadConfig(
        scratch(t, {
          'solid-platform.config.mjs': `export default { name: 'x', targets: ['nope'] };\n`,
        }),
      ),
    /^solid-platform\.config\.mjs: targets\[0\]: unknown target "nope"/,
  );
  throwsMessage(
    () =>
      loadConfig(
        scratch(t, {
          'solid-platform.config.mjs': `await 1;\nexport default {};\n`,
        }),
      ),
    /^solid-platform\.config\.mjs: /,
  );
});

test('the Tizen package takes its version from the config, else the old constant', (t) => {
  const saved = process.env.TIZEN_SECURITY_PROFILE;
  delete process.env.TIZEN_SECURITY_PROFILE;
  t.after(() => {
    if (saved !== undefined) process.env.TIZEN_SECURITY_PROFILE = saved;
  });
  const root = scratch(t);
  const xml = () => readFileSync(path.join(root, 'dist/config.xml'), 'utf8');
  packageTV(root, 'tizen', 'my-app', false);
  assert.match(xml(), / version="0\.2\.0" /);
  packageTV(root, 'tizen', 'my-app', false, { version: '3.1.4-beta.2' });
  assert.match(xml(), / version="3\.1\.4" /);
  assert.match(xml(), /id="https:\/\/solid\.app\/my-app"/);
});
