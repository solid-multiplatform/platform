// Builds the device motion test app, installs it on the Roku named by
// ROKU_DEV_IP, and checks that x/alpha animations run natively: known pauses,
// completion and interrupt positions from screenshots, plus the timer counts
// the app prints. Exits non-zero on a failed probe. This replaces whatever is
// in the device's developer slot; the app that was on screen before is
// brought back afterwards.
//
//   node tests/roku-device/run-motion.mjs [--out results/motion] [--keep]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  launch,
  readConsole,
  rokuDevice,
  screenshot,
  sideload,
} from '../../cli/roku-device.mjs';
import { decodeImage, imageKind, sample } from './image.mjs';
import { BG, FADE, MOVE, SCREEN, rgb } from './motion-cases.mjs';

const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-motion');
const zip = path.join(out, 'motion.zip');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const target = flag('--out');
const device = rokuDevice();

const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
console.log(
  `Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`,
);

rmSync(out, { recursive: true, force: true });
execFileSync(
  path.join(project, 'node_modules/.bin/rk'),
  [
    'build',
    '--local',
    '--no-drop-console',
    '--no-source-map',
    '--out-dir',
    out,
    '--config',
    'motion.roku-config.ts',
  ],
  { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] },
);
if (!existsSync(path.join(out, 'pkg-dir/manifest')))
  throw new Error('The Roku build produced no package directory.');
execFileSync(
  'python3',
  [
    '-c',
    'import sys,zipfile,pathlib\n' +
      'root=pathlib.Path(sys.argv[1])\n' +
      'with zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n' +
      '    [z.write(f,f.relative_to(root)) for f in sorted(root.rglob("*")) if f.is_file()]',
    path.join(out, 'pkg-dir'),
    zip,
  ],
  { stdio: 'inherit' },
);

// ---- console markers -------------------------------------------------------

const notes = [];
const seen = new Map();
const waiters = [];
let fresh = false;
const mark = (line) => {
  const at = line.indexOf('MOTION ');
  if (at === -1) return;
  const text = line.slice(at + 'MOTION '.length);
  if (!fresh) return;
  notes.push(text);
  console.log('MARK ' + text);
  const name = text.split(' ')[0];
  seen.set(name, text);
  for (let i = waiters.length - 1; i >= 0; i--) {
    // An app error means no later marker will come: fail every waiter now.
    if (waiters[i].name !== name && name !== 'ERROR') continue;
    const waiter = waiters.splice(i, 1)[0];
    if (name === 'ERROR') waiter.reject?.(new Error(text));
    else waiter.resolve(text);
  }
};
const waitFor = (name, timeout = 60_000) => {
  if (seen.has(name)) return Promise.resolve(seen.get(name));
  return new Promise((resolve, reject) => {
    const waiter = { name, resolve, reject };
    waiters.push(waiter);
    setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at >= 0) waiters.splice(at, 1);
      reject(new Error('The app never reported MOTION ' + name));
    }, timeout);
  });
};

const previous = await activeApp(device);
const shots = {};
const reading = readConsole(
  device,
  (line) => {
    mark(line);
    return line.includes('MOTION DONE');
  },
  90_000,
);
try {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  fresh = true;
  await sideload(device, zip);
  await waitFor('START');
  // Each marker follows a state the app holds long enough to capture.
  for (const [marker, key] of [
    ['PAUSED', 'paused'],
    ['MOVE_DONE', 'moveDone'],
    ['INTERRUPT_DONE', 'interrupt'],
    ['FADE_PAUSED', 'fadePaused'],
    ['RESTORED', 'restored'],
    ['CHAIN_DONE', 'chain'],
  ]) {
    await waitFor(marker);
    shots[key] = await screenshot(device);
  }
  await waitFor('DONE');
  await reading.done;
} finally {
  reading.stop();
  if (!args.includes('--keep') && previous && previous !== 'dev')
    await launch(device, previous).catch(() => {});
}

// ---- probes ---------------------------------------------------------------

const failures = [];
const report = [];
const fail = (line) => {
  failures.push(line);
  report.push('FAIL ' + line);
};
const pass = (line) => report.push('PASS ' + line);

const image = (key) => {
  if (!shots[key]) throw new Error('no screenshot for ' + key);
  return decodeImage(shots[key]);
};
const bg = rgb(BG);
const red = rgb(MOVE.color);
const green = rgb(FADE.color);
const worst = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const at = (img, x, y) => sample(img, Math.round(x), Math.round(y));

/** The left edge of the red block at the row through its middle. */
function leftEdge(img) {
  const y = MOVE.y + MOVE.h / 2;
  for (let x = 0; x < SCREEN.w - 1; x++)
    if (worst(at(img, x, y), red) <= 40) return x;
  return -1;
}
function expectNear(what, got, want, tolerance) {
  if (!(Math.abs(got - want) <= tolerance))
    fail(`${what}: got ${got}, want ${want} +-${tolerance}`);
  else pass(`${what}: ${got}`);
}

const paused = leftEdge(image('paused'));
const half =
  MOVE.x0 + ((MOVE.x1 - MOVE.x0) * (MOVE.duration / 2)) / MOVE.duration;
expectNear('paused x', paused, half, 170);

const landed = leftEdge(image('moveDone'));
expectNear('move land x', landed, MOVE.x1, 14);

const interrupted = leftEdge(image('interrupt'));
expectNear('interrupt land x', interrupted, MOVE.x1, 14);

// A paused fade at half duration: alpha is halfway from 1 to a1.
const fadeImg = image('fadePaused');
const halfAlpha = FADE.a0 + (FADE.a1 - FADE.a0) * 0.5;
const wantFade = bg.map((v, i) => v + (green[i] - v) * halfAlpha);
const gotFade = at(fadeImg, FADE.x + FADE.w / 2, FADE.y + FADE.h / 2);
if (worst(gotFade, wantFade) > 45)
  fail(
    `paused alpha colour: got [${gotFade.map(Math.round)}], want [${wantFade.map(Math.round)}] +-45`,
  );
else pass(`paused alpha colour: [${gotFade.map(Math.round)}]`);

// Restored: the fade is back at full opacity.
const restored = at(
  image('restored'),
  FADE.x + FADE.w / 2,
  FADE.y + FADE.h / 2,
);
if (worst(restored, green) > 24)
  fail(
    `restored colour: got [${restored.map(Math.round)}], want [${green.map(Math.round)}] +-24`,
  );
else pass(`restored colour: [${restored.map(Math.round)}]`);

const chained = leftEdge(image('chain'));
expectNear('chain land x', chained, MOVE.x1, 14);

// Timer accounting: a native animation must not arm a per-frame timer.
const idle = notes.find((line) => line.startsWith('IDLE '));
const numbers = Object.fromEntries(
  (idle ?? '')
    .split(' ')
    .slice(1)
    .map((pair) => [pair.split('=')[0], Number(pair.split('=')[1])]),
);
if (idle === undefined) fail('no IDLE line on the console');
else {
  if (!(numbers.during === 0))
    fail(`the backend armed ${numbers.during} timers while animating`);
  else pass('no timers armed while animating');
  if (!(numbers.idle === 0))
    fail(`the backend armed ${numbers.idle} timers after settling`);
  else pass('no timers armed after settling');
}
const done = notes.find((line) => line.startsWith('MOVE_DONE '));
const elapsed = Number((done ?? '').match(/\bms=(\d+)/)?.[1] ?? NaN);
// The measured span includes the 3 s the app holds while paused; the animation
// itself is still expected to take its configured duration after resuming.
const expected = MOVE.duration + 3000;
if (!(elapsed >= expected - 200 && elapsed <= expected + 1200))
  fail(
    `a ${MOVE.duration}ms native animation held ${3000}ms mid-way ended after ${elapsed}ms, want ${expected} +-1200`,
  );
else
  pass(`native animation ended after ${elapsed}ms (paused half-way by design)`);

for (const note of notes) report.push('NOTE ' + note);
for (const line of report) console.log(line);
if (target) {
  const base = path.resolve(target).replace(/\.(txt|jpe?g|png)$/i, '');
  mkdirSync(path.dirname(base), { recursive: true });
  writeFileSync(base + '-result.txt', report.join('\n') + '\n');
  for (const [key, shot] of Object.entries(shots)) {
    if (shot) writeFileSync(`${base}-${key}.${imageKind(shot)}`, shot);
  }
  console.log('Results: ' + base + '-result.txt');
}
console.log(
  `MOTION RESULT passed=${report.filter((l) => l.startsWith('PASS')).length} failed=${failures.length}`,
);
process.exit(failures.length ? 1 : 0);
