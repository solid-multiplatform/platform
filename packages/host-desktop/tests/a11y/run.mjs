// The accessibility test, end to end. This is the assistive technology: it
// starts a session bus of its own with the system's accessibility bus
// launcher on it, runs app.ts in the runtime, switches accessibility on,
// reads the app's tree from the accessibility bus (AT-SPI, with busctl) and
// asks for actions; the app prints what reached it.
//
//   xvfb-run -a node tests/a11y/run.mjs [out-dir]
//
// Skips, saying so, where the runtime was built without accessibility or
// the machine has no at-spi-bus-launcher, dbus-daemon or busctl. Nothing
// here is the user's: the bus, its configuration, the runtime directory the
// accessibility bus puts its socket in and the home directory are made for
// the test, and the launcher marks only the display in DISPLAY, which
// run.sh makes a virtual one.
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';
import { runtimeDiagnostics } from '../../cli/runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv[2] !== undefined;
const has = (program) =>
  spawnSync('sh', ['-c', `command -v ${program}`]).status === 0;
const launcher = [
  '/usr/libexec/at-spi-bus-launcher',
  '/usr/lib/at-spi-bus-launcher',
  '/usr/lib/at-spi2-core/at-spi-bus-launcher',
].find((file) => existsSync(file));
const registryDaemon = [
  '/usr/libexec/at-spi2-registryd',
  '/usr/lib/at-spi2-registryd',
  '/usr/lib/at-spi2-core/at-spi2-registryd',
].find((file) => existsSync(file));

const skip = (why) => {
  // Where the test must run (CI), not being able to is a failure.
  if (process.env.SOLID_DESKTOP_REQUIRE_A11Y === '1') {
    console.error(`a11y: cannot run: ${why}`);
    process.exit(1);
  }
  console.log(`a11y: SKIPPED, not verified here: ${why}`);
  process.exit(0);
};
if (runtimeDiagnostics(defaultRuntime).accessibility !== 'at-spi') {
  skip('the runtime was built without the accessibility feature');
}
if (process.env.SOLID_DESKTOP_VIRTUAL === '0') {
  skip('it runs only on a virtual display');
}
if (launcher === undefined || registryDaemon === undefined) {
  skip('there is no at-spi-bus-launcher or no at-spi2-registryd');
}
for (const program of ['dbus-daemon', 'busctl']) {
  if (!has(program)) skip(`there is no ${program}`);
}

// A short path: a socket's is limited to about a hundred bytes.
const out = mkdtempSync(path.join(tmpdir(), 'solid-a11y-'));
const artifacts = keep ? path.resolve(process.argv[2]) : out;
mkdirSync(artifacts, { recursive: true });
const home = path.join(out, 'home');
const runtimeDirectory = path.join(out, 'run');
const services = path.join(out, 'services');
for (const directory of [home, runtimeDirectory, services]) {
  mkdirSync(directory, { recursive: true });
}
chmodSync(runtimeDirectory, 0o700);
// The one service this bus can start: the accessibility bus launcher.
writeFileSync(
  path.join(services, 'org.a11y.Bus.service'),
  `[D-BUS Service]\nName=org.a11y.Bus\nExec=${launcher}\n`,
);
writeFileSync(
  path.join(out, 'session.conf'),
  `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=${out}</listen>
  <servicedir>${services}</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`,
);

const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  if (/^(AT_SPI_|DBUS_|GTK_MODULES$|NO_AT_BRIDGE$)/.test(name)) {
    delete environment[name];
  }
}
Object.assign(environment, {
  HOME: home,
  XDG_DATA_HOME: path.join(home, 'data'),
  XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_CONFIG_HOME: path.join(home, 'config'),
  XDG_RUNTIME_DIR: runtimeDirectory,
  // Settings in memory: nothing of dconf is read or written.
  GSETTINGS_BACKEND: 'memory',
});

const started = [];
const stopAll = () => {
  for (const child of started.reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
};
process.on('exit', stopAll);

/** Starts the session bus; resolves with its address. */
function startBus() {
  const daemon = spawn(
    'dbus-daemon',
    [
      `--config-file=${path.join(out, 'session.conf')}`,
      '--nofork',
      '--print-address',
    ],
    { env: environment, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  started.push(daemon);
  return new Promise((resolve, reject) => {
    let text = '';
    daemon.stdout.setEncoding('utf8').on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) resolve(text.split('\n')[0]);
    });
    daemon.on('exit', (code) =>
      reject(new Error(`dbus-daemon exited ${code}`)),
    );
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Until `probe` returns something, for a few seconds: this is the test waiting, not the app. */
async function eventually(what, probe, ms = 8000) {
  let last;
  for (const start = Date.now(); Date.now() - start < ms; ) {
    try {
      const found = probe();
      if (found !== undefined && found !== false) return found;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(
    `${what}: not within ${ms} ms${last ? ` (${last.message})` : ''}`,
  );
}

const session = await startBus();
environment.DBUS_SESSION_BUS_ADDRESS = session;
const busctl = (address, ...args) =>
  JSON.parse(
    execFileSync('busctl', [`--address=${address}`, '--json=short', ...args], {
      env: environment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }) || 'null',
  );

// AT-SPI, as much of it as the test reads.
const ACCESSIBLE = 'org.a11y.atspi.Accessible';
const STATE = {
  checked: 4,
  enabled: 8,
  focusable: 11,
  focused: 12,
  pressed: 20,
};
const ROLE = {
  23: 'frame',
  39: 'panel',
  43: 'button',
  51: 'slider',
  62: 'toggle button',
  75: 'application',
  83: 'heading',
};
/** A switch is a toggle button to AT-SPI, and one that is on is pressed. */
const on = (node) =>
  node.states.includes('checked') || node.states.includes('pressed');
let accessibility;
const call = (object, iface, method, ...args) =>
  busctl(accessibility, 'call', object[0], object[1], iface, method, ...args)
    .data;
const property = (object, iface, name) =>
  busctl(accessibility, 'get-property', object[0], object[1], iface, name).data;
/** One node and everything under it, as plain data. */
function read(object) {
  const [states] = call(object, ACCESSIBLE, 'GetState');
  const interfaces = call(object, ACCESSIBLE, 'GetInterfaces')[0];
  const node = {
    object,
    name: property(object, ACCESSIBLE, 'Name'),
    description: property(object, ACCESSIBLE, 'Description'),
    role: ((role) => ROLE[role] ?? role)(
      call(object, ACCESSIBLE, 'GetRole')[0],
    ),
    states: Object.keys(STATE).filter(
      (state) => (states[STATE[state] >> 5] >>> (STATE[state] & 31)) & 1,
    ),
    interfaces: interfaces.map((name) => name.replace('org.a11y.atspi.', '')),
  };
  if (node.interfaces.includes('Component')) {
    // Relative to the window (1).
    node.extents = call(
      object,
      'org.a11y.atspi.Component',
      'GetExtents',
      'u',
      '1',
    )[0];
  }
  if (node.interfaces.includes('Value')) {
    node.range = ['MinimumValue', 'CurrentValue', 'MaximumValue'].map((name) =>
      property(object, 'org.a11y.atspi.Value', name),
    );
  }
  if (node.interfaces.includes('Action')) {
    node.actions = property(object, 'org.a11y.atspi.Action', 'NActions');
  }
  node.children = call(object, ACCESSIBLE, 'GetChildren')[0].map(read);
  return node;
}
const find = (node, name) =>
  node.name === name
    ? node
    : node.children.reduce(
        (found, child) => found ?? find(child, name),
        undefined,
      );
const outline = (node, depth = 0) =>
  `${'  '.repeat(depth)}${node.role} "${node.name}" [${node.states}]` +
  `${node.extents ? ` @${node.extents}` : ''}${node.range ? ` range ${node.range}` : ''}` +
  `${node.actions ? ` actions ${node.actions}` : ''}\n` +
  node.children.map((child) => outline(child, depth + 1)).join('');

/** How often each thread of a process but its first has slept and woken: `{ "name tid": count }`. */
function threadWakeups(pid) {
  const tasks = `/proc/${pid}/task`;
  return Object.fromEntries(
    readdirSync(tasks)
      .filter((thread) => thread !== String(pid))
      .map((thread) => {
        const status = readFileSync(`${tasks}/${thread}/status`, 'utf8');
        return [
          `${/^Name:\s*(.*)$/m.exec(status)[1]} ${thread}`,
          Number(/^voluntary_ctxt_switches:\s*(\d+)/m.exec(status)[1]),
        ];
      }),
  );
}

let app;
try {
  // The accessibility bus, which the launcher starts when first asked for
  // its address, and the registry on it. The registry is started here and
  // not by the bus: where the launcher's bus is dbus-broker it would ask
  // systemd to, and the user's systemd is not the test's.
  const STATUS = ['org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Status'];
  accessibility = busctl(
    session,
    'call',
    'org.a11y.Bus',
    '/org/a11y/bus',
    'org.a11y.Bus',
    'GetAddress',
  ).data[0];
  const registry = [
    'org.a11y.atspi.Registry',
    '/org/a11y/atspi/accessible/root',
  ];
  started.push(
    spawn(registryDaemon, [], {
      env: { ...environment, AT_SPI_BUS_ADDRESS: accessibility },
      stdio: 'ignore',
    }),
  );
  await eventually('the registry', () => {
    const owner = busctl(
      accessibility,
      'call',
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'NameHasOwner',
      's',
      registry[0],
    );
    return owner.data[0];
  });

  const script = await bundle({
    entry: path.join(here, 'app.ts'),
    outfile: path.join(artifacts, 'a11y.js'),
  });
  app = spawn(defaultRuntime, [script], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(app);
  const lines = [];
  let stderr = '';
  let partial = '';
  app.stdout.setEncoding('utf8').on('data', (chunk) => {
    partial += chunk;
    const parts = partial.split('\n');
    partial = parts.pop();
    lines.push(...parts);
  });
  app.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const ended = new Promise((resolve) =>
    app.on('close', (status, signal) => resolve({ status, signal })),
  );
  const line = (prefix, ms) =>
    eventually(
      `the app's "${prefix}" (it printed: ${lines.join(' | ')}; ${stderr})`,
      () => lines.find((l) => l.startsWith(prefix)),
      ms,
    );

  // The app has described its nodes and nobody listens: the launcher is
  // there (the adapter asked it) and says accessibility is off.
  const registered = JSON.parse((await line('REGISTERED ')).slice(11));
  assert.deepEqual(
    registered,
    { before: false, active: false },
    'the tree was built with no assistive technology running',
  );
  assert.equal(
    busctl(session, 'get-property', ...STATUS, 'IsEnabled').data,
    false,
  );
  // The adapter's threads are there now and wait on the bus: they come to
  // rest, so that in a second none of them wakes more than once. (A helper
  // thread of the D-Bus client lingers for half a second after connecting
  // and then ends, hence the few tries. The JavaScript thread is left out:
  // the app is counting time until this test goes on.)
  let waiting;
  let woken;
  for (let tries = 0; tries < 4 && woken?.length !== 0; tries++) {
    waiting = threadWakeups(app.pid);
    await sleep(1000);
    woken = Object.entries(threadWakeups(app.pid))
      .map(([thread, count]) => [thread, count - (waiting[thread] ?? 0)])
      .filter(([, count]) => count > 1);
  }
  assert.deepEqual(woken, [], 'threads that keep waking while nothing happens');
  waiting = threadWakeups(app.pid);

  // Assistive technology arrives.
  busctl(session, 'set-property', ...STATUS, 'IsEnabled', 'b', 'true');
  assert.deepEqual(JSON.parse((await line('READY ')).slice(6)), {
    active: true,
  });
  const application = await eventually(
    'the app on the accessibility bus',
    () => {
      const [applications] = call(registry, ACCESSIBLE, 'GetChildren');
      return applications[0];
    },
  );
  if (has('xdotool')) {
    // Give the window the keyboard, so that focus is reported.
    const window = execFileSync(
      'xdotool',
      ['search', '--name', '^Solid a11y test$'],
      { encoding: 'utf8' },
    ).split('\n')[0];
    execFileSync('xdotool', ['windowfocus', window]);
  }

  const first = await eventually('the tree', () => {
    const tree = read(application);
    return find(tree, 'Play') && tree;
  });
  writeFileSync(path.join(artifacts, 'tree-before.txt'), outline(first));
  if (process.env.SOLID_A11Y_DUMP) console.log(outline(first));

  const window = find(first, 'Solid a11y test');
  assert.ok(window, `no window in:\n${outline(first)}`);
  assert.deepEqual(
    window.children.map((child) => child.name),
    ['Player controls'],
  );
  const group = window.children[0];
  assert.deepEqual(
    group.children.map((child) => child.name),
    ['Now playing', 'Play', 'Mute', 'Volume', 'Next'],
    'the nodes, in the order they were registered',
  );
  const [heading, play, mute, volume, next] = group.children;
  assert.equal(heading.role, 'heading');
  assert.equal(play.role, 'button');
  assert.equal(play.description, 'Starts the film');
  assert.deepEqual(play.extents, [10, 50, 100, 40]);
  assert.ok(
    play.states.includes('enabled') && play.states.includes('focusable'),
  );
  assert.equal(play.actions, 1);
  assert.equal(group.role, 'panel');
  assert.equal(mute.role, 'toggle button');
  assert.ok(!on(mute));
  assert.equal(volume.role, 'slider');
  assert.deepEqual(volume.range, [0, 7, 10]);
  assert.ok(!next.states.includes('enabled'), 'Next is disabled');
  assert.ok(!next.actions, 'a disabled node offers no action');
  const focusReported = has('xdotool');
  if (focusReported) {
    await eventually('Play to be focused', () =>
      find(read(application), 'Play').states.includes('focused'),
    );
  }

  // Actions: focus, then the default action. Each reaches the app once.
  const ACTION = 'org.a11y.atspi.Action';
  assert.equal(
    call(mute.object, 'org.a11y.atspi.Component', 'GrabFocus')[0],
    true,
  );
  await line('ACTION focus mute');
  assert.equal(call(play.object, ACTION, 'DoAction', 'i', '0')[0], true);
  await line('ACTION click play');

  // The app changed four things in one turn; the tree follows, and reading
  // it does not wake the app's loop, which is idle meanwhile.
  await line('UPDATED');
  const second = await eventually('the updated tree', () => {
    const tree = read(application);
    return find(tree, 'Pause') && !find(tree, 'Next') && tree;
  });
  writeFileSync(path.join(artifacts, 'tree-after.txt'), outline(second));
  assert.equal(find(second, 'Play'), undefined);
  assert.equal(find(second, 'Pause').description, '');
  assert.ok(on(find(second, 'Mute')), 'Mute is not reported as on');
  if (focusReported) {
    assert.ok(find(second, 'Mute').states.includes('focused'));
    assert.ok(!find(second, 'Pause').states.includes('focused'));
  }
  assert.deepEqual(
    find(second, 'Player controls').children.map((child) => child.name),
    ['Now playing', 'Pause', 'Mute', 'Volume'],
  );
  const idle = JSON.parse((await line('IDLE ', 10000)).slice(5));
  assert.ok(idle.wakeups <= 1, `idle: ${idle.wakeups} wakeups`);
  assert.equal(idle.frames, 0);
  assert.equal(idle.presents, 0);

  // The app still hears actions after its update, and none reached it
  // that was not asked for.
  assert.equal(call(mute.object, ACTION, 'DoAction', 'i', '0')[0], true);
  await line('ACTION click mute');
  assert.deepEqual(
    lines.filter((l) => l.startsWith('ACTION ')),
    ['ACTION focus mute', 'ACTION click play', 'ACTION click mute'],
  );

  app.kill('SIGTERM');
  const end = await ended;
  assert.equal(
    end.status,
    0,
    `exit ${end.status} ${end.signal ?? ''}\n${stderr}`,
  );
  assert.ok(lines.includes('DISPOSED'));
  assert.equal(stderr, '', 'unexpected output on standard error');
  console.log(
    `a11y: ${1 + 1 + group.children.length} nodes read from the accessibility bus (window, group, ${group.children.map((child) => child.role).join(', ')})`,
  );
  console.log(
    `a11y: nothing built and ${Object.keys(waiting).length} other threads asleep before assistive technology arrived; focus and click delivered; one batch updated the tree${focusReported ? '; focus reported' : ' (focus not checked: no xdotool)'}`,
  );
  console.log(
    `a11y: idle for ${idle.ms} ms with the tree being read: ${idle.wakeups} wakeup, ${idle.frames} frames, ${idle.presents} presents`,
  );
} finally {
  stopAll();
  rmSync(out, { recursive: true, force: true });
}
