import test from 'node:test';
import assert from 'node:assert/strict';
import { machine } from './helpers.mjs';

const build = ['build', 'desktop', false, false];

test('build desktop goes through the desktop target', async () => {
  const m = machine();
  assert.equal(await m.cli('build', 'desktop'), 0);
  assert.deepEqual(m.calls, [build]);
});

test('run desktop --no-build runs the built bytecode in the host runtime', async () => {
  const m = machine({
    files: ['/app/targets/desktop/work/bundle/app.hbc'],
    exec: () => ({ status: 0 }),
  });
  assert.equal(await m.cli('run', 'desktop', '--no-build'), 0);
  assert.equal(m.calls.length, 1);
  const [bin, ...args] = m.calls[0];
  assert.equal(bin, process.execPath);
  assert.match(args[0], /host-desktop\/cli\/index\.mjs$/);
  assert.deepEqual(args.slice(1), [
    'run',
    '/app/targets/desktop/work/bundle/app.hbc',
  ]);
});

test('run desktop without a build refuses with the build command', async () => {
  const m = machine();
  assert.equal(await m.cli('run', 'desktop', '--no-build'), 1);
  assert.match(m.err[0], /No desktop build at targets\/desktop\/work\/bundle/);
  assert.deepEqual(m.calls, []);
});

test('package desktop builds, then hands the entry and app metadata to package.mjs', async () => {
  const m = machine({ exec: () => ({ status: 0 }) });
  assert.equal(await m.cli('package', 'desktop'), 0);
  assert.deepEqual(m.calls[0], build);
  const [bin, ...args] = m.calls[1];
  assert.equal(bin, process.execPath);
  assert.match(args[0], /host-desktop\/cli\/package\.mjs$/);
  for (const part of [
    '--app-id',
    'com.example.demo',
    '--name',
    'demo-app',
    '--version',
    '1.2.3',
    '--out',
    '/app/targets/desktop/dist',
  ])
    assert.ok(args.includes(part), part);
});
