// Measures Roku frame pacing on a physical device through the existing
// developer installer and console (no `rk dev`/`rk sideload`): builds
// tests/roku-device/pacing-app.tsx, installs it, relaunches it with launch
// parameters for one fixed workload, collects the timestamps it prints, and
// analyses them.
//
//   node tests/performance/run-pacing.mjs --case steady --seconds 60 \
//     --out /path/to/roku-pacing/steady
//
// The case is `steady`, `animation` or `block`; `--seconds` defaults to 60.
// Results go to <out>-pacing.json (raw samples + analysis) and
// <out>-pacing.txt (the readable report). Without --out, only the report is
// printed. The app that was on screen before is restored afterwards, also on
// failure. Never prints the device address, serial or credentials.
//
// THIS IS A PROXY. The samples are JavaScript-thread frame callbacks on the
// device; the firmware's real render/swapBuffers timing is only in a Perfetto
// trace (docs/performance.md, "Measure on Roku"). The analysis says so.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  keypress,
  launch,
  readConsole,
  rokuDevice,
  sideload,
} from '../../cli/roku-device.mjs';
import { analyzePacing, formatPacingReport } from './analyze-roku-pacing.mjs';
import {
  CASES,
  DEFAULT_SECONDS,
  PERIOD_MS,
} from '../roku-device/pacing-cases.mjs';

const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-pacing');
const zip = path.join(out, 'pacing.zip');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requested = flag('--case') ?? 'steady';
if (!CASES.includes(requested)) {
  console.error(`--case must be one of ${CASES.join(', ')}; got ${requested}`);
  process.exit(2);
}
const seconds = Math.max(
  1,
  Number(flag('--seconds') ?? DEFAULT_SECONDS) || DEFAULT_SECONDS,
);
const target = flag('--out');
const maxOverBudget = flag('--max-over-budget');
const keep = args.includes('--keep');

const device = rokuDevice();
const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
console.log(
  `Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`,
);
console.log(
  `Workload ${requested} for ${seconds}s (JavaScript-thread proxy at ${Math.round(1000 / PERIOD_MS)} Hz)`,
);

// ---- build and install ------------------------------------------------------

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
    'pacing.roku-config.ts',
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

// ---- read the console while the app runs ------------------------------------

const markers = [];
let fresh = false;
const previous = await activeApp(device);
const reading = readConsole(
  device,
  (line) => {
    // On connecting, the console replays the previous app's lines; discard
    // the first 1.5 s (the same rule the other runners use).
    if (!fresh) return false;
    const at = line.indexOf('PACING ');
    if (at === -1) return false;
    const text = line.slice(at + 'PACING '.length);
    markers.push(text);
    console.log('MARK ' + text);
    return text.startsWith('DONE');
  },
  (seconds + 90) * 1000,
);

try {
  await sleep(1500);
  fresh = true;
  await sideload(device, zip);
  // The installer launches once without parameters; relaunch with the case.
  await sleep(1000);
  await launch(device, 'dev', {
    contentId: 'pacing',
    case: requested,
    seconds: String(seconds),
  });
  await reading.done;
} finally {
  reading.stop();
  // The home screen's id is not stable ("Roku", then a number on the same
  // TV), so relaunch the recorded id and fall back to Home if the dev channel
  // is still in front. Any other id is an installed channel.
  if (!keep && previous && previous !== 'dev') {
    await launch(device, previous).catch(() => {});
    await sleep(1500);
    const now = await activeApp(device).catch(() => undefined);
    if (now === 'dev') await keypress(device, 'Home').catch(() => {});
  }
}

// ---- parse the markers ------------------------------------------------------

const frames = [];
const idle = [];
const blocks = [];
const events = [];
const samples = [];
let start = null;
let rawSummary = null;

for (const text of markers) {
  const space = text.indexOf(' ');
  const kind = space === -1 ? text : text.slice(0, space);
  const body = space === -1 ? undefined : text.slice(space + 1);
  let value;
  try {
    value = body === undefined ? undefined : JSON.parse(body);
  } catch {
    continue;
  }
  if (kind === 'START') start = value;
  else if (kind === 'SAMPLE') {
    samples.push(value);
    for (const frame of value.frames ?? []) frames.push(frame);
    for (const at of value.idle ?? []) idle.push(at);
  } else if (kind === 'BLOCK') blocks.push(value);
  else if (kind === 'EVENT') events.push(value);
  else if (kind === 'SUMMARY') rawSummary = value;
}

// A BUILD of the app may report its deliberate blocks only in the summary.
// Prefer the dedicated markers but never lose the block span.
if (blocks.length === 0 && Array.isArray(rawSummary?.blocks))
  blocks.push(...rawSummary.blocks);

if (!start) {
  console.error(
    'The app never reported a START marker (did it launch with parameters?).',
  );
  process.exit(2);
}
if (samples.length === 0) {
  console.error('The app reported no SAMPLE markers.');
  process.exit(2);
}

const analysis = analyzePacing({
  case: requested,
  frames,
  idle,
  blocks,
  durationMs: rawSummary?.durationMs,
});
const report = formatPacingReport(analysis);

if (target) {
  const base = path.resolve(target).replace(/\.(txt|json)$/i, '');
  mkdirSync(path.dirname(base), { recursive: true });
  writeFileSync(
    base + '-pacing.json',
    JSON.stringify(
      {
        case: requested,
        seconds,
        start,
        rawSummary,
        frames,
        idle,
        blocks,
        events,
        samples,
        analysis,
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(base + '-pacing.txt', report + '\n');
  console.log('Results: ' + base + '-pacing.json');
}

console.log(report);
console.log(JSON.stringify(analysis));

if (maxOverBudget !== undefined) {
  const limit = Number(maxOverBudget);
  if (!(analysis.overBudget <= limit)) {
    console.error(
      `Proxy gate failed: ${analysis.overBudget} intervals over budget, limit ${limit}.`,
    );
    process.exit(1);
  }
}
