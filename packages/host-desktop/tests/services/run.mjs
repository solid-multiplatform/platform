// The test of the services that live on a bus: notifications and secure
// storage (the session bus) and connectivity (NetworkManager on the system
// bus). Starts a bus of its own, which stands in for all of them, and runs
// app.ts, secrets.ts and network.ts in the runtime (without a window) while
// a stand-in for each service is on that bus, and when none is: the service
// must then be absent.
//
//   node tests/services/run.mjs
//
// Nothing here reaches the user's session: the bus is the test's, it can
// start no service, and the stand-in shows nothing. Skips, saying so, where
// the runtime has no notifications or the machine lacks dbus-daemon or
// Python's GLib bindings (the stand-in is written with them).
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';
import { runtimeDiagnostics } from '../../cli/runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (why) => {
  // Where the test must run (CI), not being able to is a failure.
  if (process.env.SOLID_DESKTOP_REQUIRE_DBUS === '1') {
    console.error(`services: cannot run: ${why}`);
    process.exit(1);
  }
  console.log(`services: SKIPPED, not verified here: ${why}`);
  process.exit(0);
};
if (runtimeDiagnostics(defaultRuntime).notifications !== 'dbus') {
  skip('the runtime was built without notifications');
}
if (runtimeDiagnostics(defaultRuntime).secureStorage !== 'dbus') {
  skip('the runtime was built without secure storage');
}
if (spawnSync('sh', ['-c', 'command -v dbus-daemon']).status !== 0) {
  skip('there is no dbus-daemon');
}
if (
  spawnSync('python3', ['-c', 'from gi.repository import Gio, GLib']).status !==
  0
) {
  skip("Python's GLib bindings (python3-gi) are not installed");
}

const NOWHERE = 'unix:path=/nonexistent/solid-desktop-test';
// A short path: a socket's is limited to about a hundred bytes.
const out = mkdtempSync(path.join(tmpdir(), 'solid-bus-'));
const home = path.join(out, 'home');
mkdirSync(home, { recursive: true });
writeFileSync(
  path.join(out, 'session.conf'),
  `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=${out}</listen>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`,
);
const environment = {
  ...process.env,
  HOME: home,
  XDG_DATA_HOME: path.join(home, 'data'),
  XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_CONFIG_HOME: path.join(home, 'config'),
  XDG_RUNTIME_DIR: home,
  // Until the test's own bus stands in for it.
  DBUS_SYSTEM_BUS_ADDRESS: NOWHERE,
};
delete environment.DBUS_SESSION_BUS_ADDRESS;

const started = [];
const running = (child) => child.exitCode === null && child.signalCode === null;
const stopAll = () => {
  for (const child of [...started].reverse()) {
    if (running(child)) child.kill();
  }
};
process.on('exit', stopAll);
/** Stops what was started and waits until it is gone: a bus removes its
 * socket as it ends, and the directory must not be removed under it. */
const stopped = () =>
  Promise.all(
    started.map(
      (child) =>
        new Promise((resolve) => {
          if (!running(child)) return resolve();
          child.once('close', resolve);
          child.kill();
        }),
    ),
  );
/** Starts a program and resolves with the first line it prints. A helper
 * that never prints fails the test instead of hanging the whole run. */
function start(program, args, timeout = 30_000, extraEnv = {}) {
  const child = spawn(program, args, {
    env: { ...environment, ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  started.push(child);
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () =>
        reject(new Error(`${program} printed no line within ${timeout} ms`)),
      timeout,
    );
    timer.unref?.();
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) {
        clearTimeout(timer);
        resolve({ child, line: text.split('\n')[0] });
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${program} exited with ${code}`));
    });
  });
}
function runApp(script, prefix = 'SERVICES ', extra = []) {
  const result = spawnSync(defaultRuntime, ['--headless', script, ...extra], {
    env: environment,
    encoding: 'utf8',
    timeout: 30000,
  });
  const line = result.stdout.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(
    line,
    `no result (exit ${result.status}):\n${result.stdout}${result.stderr}`,
  );
  assert.equal(result.stderr, '', 'unexpected output on standard error');
  assert.equal(result.status, 0);
  return JSON.parse(line.slice(prefix.length));
}

try {
  const script = await bundle({
    entry: path.join(here, 'app.ts'),
    outfile: path.join(out, 'services.js'),
  });
  const secrets = await bundle({
    entry: path.join(here, 'secrets.ts'),
    outfile: path.join(out, 'secrets.js'),
  });
  const bus = (
    await start('dbus-daemon', [
      `--config-file=${path.join(out, 'session.conf')}`,
      '--nofork',
      '--print-address',
    ])
  ).line;
  environment.DBUS_SESSION_BUS_ADDRESS = bus;

  // A bus with nothing on it that shows notifications: no such service.
  const without = runApp(script);
  assert.equal(without.available, 'unavailable');
  assert.match(without.rejects, /CapabilityError.*notifications/);

  // The same bus has no Secret Service either: `secureStorage` is absent
  // rather than a provider that fails on use, and nothing reached a keyring.
  const secretsLog = path.join(out, 'secrets.jsonl');
  const readLog = (file) =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  const readSecrets = () => readLog(secretsLog);
  const absentSecrets = runApp(secrets, 'SECRETS ', ['check']);
  assert.equal(absentSecrets.available, 'unavailable');
  assert.match(absentSecrets.rejects, /CapabilityError.*secureStorage/);
  assert.equal(readSecrets().length, 0, 'a keyring was used without one');

  // The same bus with a notification service on it.
  const log = path.join(out, 'notified.jsonl');
  const stub = await start('python3', [
    path.join(here, 'notifications-stub.py'),
    log,
  ]);
  assert.equal(stub.line, 'READY');
  const withService = runApp(script);
  assert.equal(withService.available, 'available');
  assert.deepEqual(withService.permission, ['granted', 'granted']);
  const notified = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
  assert.deepEqual(
    notified.map(({ id, replaces, title, body }) => [
      id,
      replaces,
      title,
      body,
    ]),
    [
      [1, 0, 'First', 'héllo "wörld"'],
      [2, 0, 'Downloading', ''],
      // The same id: in place of the one before.
      [2, 2, 'Downloaded', ''],
    ],
  );
  assert.ok(
    notified.every(
      ({ app, timeout }) => app === 'solid.test.services' && timeout === -1,
    ),
    JSON.stringify(notified),
  );
  assert.ok(
    withService.idleWakeups <= 1,
    `the loop woke ${withService.idleWakeups} times after notifying`,
  );

  // The same bus with a Secret Service on it. Installing the host and asking
  // whether the service is there reaches the bus but builds nothing: the
  // stand-in has seen no session opened and no search.
  const keyring = await start('python3', [
    path.join(here, 'secrets-stub.py'),
    secretsLog,
  ]);
  assert.equal(keyring.line, 'READY');
  const checked = runApp(secrets, 'SECRETS ', ['check']);
  assert.equal(checked.available, 'available');
  assert.equal(
    readSecrets().length,
    0,
    'a keyring session was built before the first use',
  );
  // Round trip, overwrite, a key with odd characters, removal, and removing
  // a key that is not there.
  const stored = runApp(secrets, 'SECRETS ', ['run']);
  assert.equal(stored.available, 'available');
  assert.equal(stored.missing, true, 'an absent key was not null');
  assert.equal(stored.roundTrip, true, 'the value did not read back');
  assert.equal(stored.overwritten, true, 'the overwrite was not what read');
  assert.equal(stored.oddKey, true, 'a key with odd characters did not read');
  assert.equal(stored.removed, true, 'the key read back after removal');
  const operations = readSecrets();
  assert.equal(
    operations[0]?.op,
    'open-session',
    JSON.stringify(operations[0]),
  );
  const kinds = new Set(operations.map((one) => one.op));
  for (const kind of [
    'read-alias',
    'search',
    'create-item',
    'get-secret',
    'set-secret',
    'delete-item',
  ])
    assert.ok(kinds.has(kind), `no ${kind} in ${[...kinds].join(', ')}`);
  const written = operations.filter(
    (one) => one.op === 'create-item' || one.op === 'replace-item',
  );
  assert.equal(written.length, 2, JSON.stringify(written));
  for (const one of written) {
    assert.equal(one.app, 'solid.test.services', JSON.stringify(one));
    assert.equal(one.service, 'solid-platform', JSON.stringify(one));
    assert.ok(
      typeof one.account === 'string' && one.account.length > 0,
      JSON.stringify(one),
    );
    assert.equal(typeof one.valueLength, 'number', JSON.stringify(one));
  }
  assert.ok(
    written.some((one) => one.account === 'odd key !@#$%^&*() é'),
    'the odd key was not stored under its own attributes',
  );
  // The stand-in's file holds lengths and hashes, not the values: nothing
  // here ever wrote a secret to it in the clear.
  const persisted = readFileSync(secretsLog, 'utf8');
  for (const secret of [
    'plain-secret-value',
    'plain-secret-value-replaced',
    'välue with spaces and "quotes"',
  ])
    assert.ok(
      !persisted.includes(secret),
      `plaintext in the keyring file: ${secret}`,
    );
  assert.equal(operations.at(-1)?.items, 0, 'items were left behind');

  // A locked collection: the service is there, but it will not create the
  // default collection without a prompt, and this host shows no prompt.
  const keyringClosed = new Promise((resolve) =>
    keyring.child.once('close', resolve),
  );
  keyring.child.kill();
  await keyringClosed;
  const lockedLog = path.join(out, 'secrets-locked.jsonl');
  const lockedKeyring = await start(
    'python3',
    [path.join(here, 'secrets-stub.py'), lockedLog],
    30_000,
    { SECRETS_LOCKED: '1' },
  );
  assert.equal(lockedKeyring.line, 'READY');
  const locked = runApp(secrets, 'SECRETS ', ['locked']);
  assert.equal(locked.available, 'available');
  assert.match(
    String(locked.error),
    /locked|CreateCollection|prompt|Secret not available/,
    String(locked.error),
  );
  assert.ok(
    readLog(lockedLog).some((one) => one.op === 'create-collection-refused'),
    'a locked collection did not refuse to be created',
  );

  // No session bus at all, as in the host test's world: absent again.
  environment.DBUS_SESSION_BUS_ADDRESS = NOWHERE;
  assert.equal(runApp(script).available, 'unavailable');

  // Connectivity. The test's bus stands in for the system bus; with no
  // NetworkManager on it the service is absent.
  const network = await bundle({
    entry: path.join(here, 'network.ts'),
    outfile: path.join(out, 'network.js'),
  });
  environment.DBUS_SYSTEM_BUS_ADDRESS = bus;
  const absent = spawnSync(defaultRuntime, ['--headless', network], {
    env: environment,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(absent.stdout + absent.stderr, 'ABSENT\n');
  // With the stand-in for NetworkManager: connected; then it goes offline
  // and comes back, and the app hears both from the signal alone.
  const manager = (await start('python3', [path.join(here, 'network-stub.py')]))
    .child;
  const heard = [];
  const app = spawn(defaultRuntime, ['--headless', network], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(app);
  let errors = '';
  app.stderr.setEncoding('utf8').on('data', (chunk) => (errors += chunk));
  let partial = '';
  app.stdout.setEncoding('utf8').on('data', (chunk) => {
    partial += chunk;
    const lines = partial.split('\n');
    partial = lines.pop();
    for (const line of lines) {
      heard.push(line);
      // Each state the app reports is answered with the next change.
      if (line === 'ONLINE true' || line === 'CHANGED false false') {
        manager.kill('SIGUSR1');
      }
    }
  });
  const timer = setTimeout(() => app.kill('SIGKILL'), 30000);
  const status = await new Promise((resolve) => app.on('close', resolve));
  clearTimeout(timer);
  assert.equal(status, 0, `${heard.join(' | ')}\n${errors}`);
  assert.equal(errors, '', 'unexpected output on standard error');
  assert.deepEqual(heard.slice(0, 3), [
    'ONLINE true',
    'CHANGED false false',
    'CHANGED true true',
  ]);
  const idleWakeups = Number(/^IDLE (\d+)$/.exec(heard[3] ?? '')?.[1] ?? NaN);
  assert.ok(idleWakeups <= 1, `the loop: ${heard[3]}`);

  console.log(
    `services: notifications absent without a notification service or a bus; with one, ${notified.length} shown through it, one replaced by id`,
  );
  console.log(
    `services: asking the bus took ${withService.installMs.toFixed(1)} ms of the start (${without.installMs.toFixed(1)} ms with no service); idle afterwards`,
  );
  console.log(
    'services: connectivity absent without NetworkManager; with it, online, then offline and online again from its signal; idle afterwards',
  );
  console.log(
    `services: secureStorage absent without a Secret Service; with one, ${operations.length} keyring operations stored, read, overwrote and removed keys (one with odd characters), nothing plaintext on disk, nothing asked before first use; a locked collection refuses`,
  );
  console.log(
    `services: secureStorage cost ${checked.installMs.toFixed(1)} ms of the start (${absentSecrets.installMs.toFixed(1)} ms with no service)`,
  );
} finally {
  await stopped();
  rmSync(out, { recursive: true, force: true });
}
