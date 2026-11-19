import test from 'node:test';
import assert from 'node:assert/strict';
import { commandNames, help } from '../../../cli/cli.mjs';
import { targets, targetNames } from '../../../cli/targets/index.mjs';
import { available } from '../../../cli/files.mjs';
import { allTargets, config, machine } from './helpers.mjs';

const verbs = ['run', 'package', 'devices', 'logs', 'screenshot'];

test('the registry holds one complete definition per target', () => {
  assert.deepEqual([...targetNames].sort(), [...available].sort());
  assert.deepEqual([...targetNames].sort(), [...allTargets].sort());
  for (const target of targets) {
    assert.equal(typeof target.doctor, 'function', target.name);
    assert.equal(typeof target.build, 'function', target.name);
    assert.ok(target.family && target.summary, target.name);
    for (const verb of verbs)
      assert.ok(
        target[verb] === undefined || typeof target[verb] === 'function',
        `${target.name}.${verb}`,
      );
  }
});

test('help lists every command and every target from the registry', async () => {
  const m = machine();
  assert.equal(await m.cli('--help'), 0);
  assert.equal(m.out.join('\n'), help());
  for (const name of commandNames)
    assert.match(m.out[0], new RegExp(`solid-platform ${name}\\b`));
  for (const name of targetNames)
    assert.match(m.out[0], new RegExp(`^  ${name} `, 'm'));
  assert.equal(await machine().cli(), 0);
});

test('every command describes itself with --help and runs nothing', async () => {
  for (const name of commandNames) {
    const m = machine();
    assert.equal(await m.cli(name, '--help'), 0, name);
    assert.match(m.out[0], new RegExp(`^solid-platform ${name}\\b`));
    assert.deepEqual(m.calls, []);
    assert.deepEqual(m.err, []);
  }
});

test('an unknown command is one line and exit code 1', async () => {
  const m = machine();
  assert.equal(await m.cli('deploy', 'web'), 1);
  assert.deepEqual(m.err, [
    'Unknown command: deploy. Run `solid-platform --help`.',
  ]);
  assert.deepEqual(m.out, []);
});

test('an unknown target is one line naming the targets, exit code 1', async () => {
  for (const command of ['build', 'run', 'logs', 'package', 'devices']) {
    const m = machine();
    assert.equal(await m.cli(command, 'playstation'), 1, command);
    assert.equal(m.err.length, 1);
    assert.match(m.err[0], /^Unknown target: playstation\. Targets: web, /);
    assert.deepEqual(m.calls, []);
  }
});

test('a command a target does not implement exits 2 with one line naming both', async () => {
  const unsupported = [
    ['logs', 'web'],
    ['screenshot', 'desktop', 'shot.png'],
    ['package', 'roku'],
    ['package', 'vizio'],
    ['run', 'tizen'],
    ['devices', 'web'],
    ['screenshot', 'ios', 'shot.png'],
  ];
  for (const [command, target, ...rest] of unsupported) {
    const m = machine();
    assert.equal(await m.cli(command, target, ...rest), 2, command + ' ' + target);
    assert.equal(m.err.length, 1);
    assert.ok(
      m.err[0].startsWith(`${target} does not implement ${command}.`),
      m.err[0],
    );
    assert.ok(!m.err[0].includes('\n') && !m.err[0].includes('    at '));
    assert.deepEqual(m.out, []);
    assert.deepEqual(m.calls, []);
  }
});

test('every target and command pair either runs or is refused, never ignored', async () => {
  for (const target of targets)
    for (const verb of verbs) {
      if (typeof target[verb] === 'function') continue;
      const m = machine();
      const args = verb === 'screenshot' ? [target.name, 'a.png'] : [target.name];
      assert.equal(await m.cli(verb, ...args), 2, `${verb} ${target.name}`);
      assert.match(m.err[0], new RegExp(`^${target.name} does not implement ${verb}`));
    }
});

test('wrong arguments and unknown options are usage errors without a stack', async () => {
  for (const argv of [
    ['build'],
    ['build', 'web', 'extra'],
    ['screenshot', 'roku'],
    ['plugin', 'create', 'x'],
    ['plugins', 'run', 'web'],
    ['add', 'audio', 'x.tgz'],
    ['run', 'web', '--port', 'eighty'],
    ['build', 'web', '--frobnicate'],
  ]) {
    const m = machine();
    assert.equal(await m.cli(...argv), 1, argv.join(' '));
    assert.equal(m.err.length, 1);
    assert.ok(!m.err[0].includes('    at '), m.err[0]);
  }
});

test('build, dev and plugins run reach the pipeline through the registry', async () => {
  const m = machine();
  assert.equal(await m.cli('build', 'web'), 0);
  assert.equal(await m.cli('build', 'tizen', '--legacy'), 0);
  assert.equal(await m.cli('dev', 'web'), 0);
  assert.equal(await m.cli('plugins', 'run', 'desktop'), 0);
  assert.equal(await m.cli('build', 'android-tv'), 0);
  assert.deepEqual(m.calls, [
    ['build', 'web', false, false],
    ['build', 'tizen', false, true],
    ['build', 'web', true, false],
    ['build', 'desktop', 'plugins', false],
    ['build', 'android-tv', false, false],
  ]);
});

test('package routes to the packaging build and run desktop opens the app', async () => {
  const m = machine();
  assert.equal(await m.cli('package', 'tizen'), 0);
  assert.equal(await m.cli('package', 'webos', '--legacy'), 0);
  assert.equal(await m.cli('run', 'desktop'), 0);
  assert.deepEqual(m.calls, [
    ['build', 'tizen', false, false],
    ['build', 'webos', false, true],
    ['build', 'desktop', true, false],
  ]);
  assert.match(m.out[0], /unsigned app/);
  assert.match(m.out[1], /dist-legacy-package/);
});

test('a target the app does not list is refused before anything runs', async () => {
  const m = machine({ config: config({ targets: ['web', 'tizen'] }) });
  assert.equal(await m.cli('build', 'roku'), 1);
  assert.equal(
    m.err[0],
    'Target roku is not in the targets of solid-platform.config.json (web, tizen).',
  );
  assert.equal(await m.cli('run', 'android', '--no-build'), 1);
  assert.deepEqual(m.calls, []);
});

test('a build failure is its message and exit code 1', async () => {
  const m = machine({
    buildProject() {
      throw new Error('corepack failed (1)');
    },
  });
  assert.equal(await m.cli('build', 'web'), 1);
  assert.deepEqual(m.err, ['corepack failed (1)']);
});
