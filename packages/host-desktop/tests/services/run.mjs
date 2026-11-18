// The test of the services that live on a bus: notifications (the session
// bus) and connectivity (NetworkManager on the system bus). Starts a bus of
// its own, which stands in for both, and runs app.ts and network.ts in the
// runtime (without a window) while a stand-in for each service is on that
// bus, and when none is: the service must then be absent.
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
/** Starts a program and resolves with the first line it prints. */
function start(program, args) {
  const child = spawn(program, args, {
    env: environment,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  started.push(child);
  return new Promise((resolve, reject) => {
    let text = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) resolve({ child, line: text.split('\n')[0] });
    });
    child.on('exit', (code) =>
      reject(new Error(`${program} exited with ${code}`)),
    );
  });
}
function runApp(script) {
  const result = spawnSync(defaultRuntime, ['--headless', script], {
    env: environment,
    encoding: 'utf8',
    timeout: 30000,
  });
  const line = result.stdout.split('\n').find((l) => l.startsWith('SERVICES '));
  assert.ok(
    line,
    `no result (exit ${result.status}):\n${result.stdout}${result.stderr}`,
  );
  assert.equal(result.stderr, '', 'unexpected output on standard error');
  assert.equal(result.status, 0);
  return JSON.parse(line.slice(9));
}

try {
  const script = await bundle({
    entry: path.join(here, 'app.ts'),
    outfile: path.join(out, 'services.js'),
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
} finally {
  await stopped();
  rmSync(out, { recursive: true, force: true });
}
