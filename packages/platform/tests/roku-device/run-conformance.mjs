// Builds the conformance app, installs it on the Roku named by ROKU_DEV_IP,
// reads the results from the device console and exits non-zero on a failure.
// This replaces whatever is in the device's developer slot. The app that was
// on screen before is brought back afterwards.
//
//   node tests/roku-device/run-conformance.mjs [--keep]
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  launch,
  readConsole,
  rokuDevice,
  sideload,
} from '../../cli/roku-device.mjs';

const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-conformance');
const zip = path.join(out, 'conformance.zip');
const device = rokuDevice();

const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
console.log(`Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`);

rmSync(out, { recursive: true, force: true });
// A release build as apps ship, except that console output is kept: it
// carries the results.
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
    'conformance.roku-config.ts',
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

const previous = await activeApp(device);
const results = [];
let fresh = false;
const reading = readConsole(
  device,
  (line) => {
    // On connecting, the console replays what the last app printed.
    if (!fresh) return false;
    const at = line.indexOf('CONFORMANCE ');
    if (at === -1) return false;
    const text = line.slice(at);
    results.push(text);
    console.log(text);
    return text.startsWith('CONFORMANCE DONE');
  },
  120_000,
);
try {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  fresh = true;
  await sideload(device, zip);
  await reading.done;
} finally {
  reading.stop();
  if (!process.argv.includes('--keep') && previous && previous !== 'dev')
    await launch(device, previous).catch(() => {});
}

const done = results.find((line) => line.startsWith('CONFORMANCE DONE'));
if (!done) {
  console.error('The device never reported a result (did the app start?).');
  process.exit(2);
}
process.exit(/failed=0$/.test(done) ? 0 : 1);
