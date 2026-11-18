// The packaging test. Packages the shared fixture (cli/package.mjs), checks
// what is in the package, unpacks its archive somewhere else, deletes the
// directory it was built in, and runs the app from the new place: the first
// frame's pixels, the idle counters, where it found its resources and the
// link it was opened with (app.ts). Then the CLI's entry points.
//
//   xvfb-run -a node tests/package/run.mjs [out-dir]
//
// The runtime packaged is SOLID_DESKTOP_RUNTIME if set (a build with SDL
// linked in, say), else the one this checkout builds.
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultRuntime } from '../../cli/bundle.mjs';
import {
  buildDesktop,
  doctorDesktop,
  findRuntime,
  packageDesktop,
  runDesktop,
  runtimeDiagnostics,
} from '../../cli/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '../../../platform');
const keep = process.argv[2] !== undefined;
const out = realpathSync(
  keep
    ? (mkdirSync(path.resolve(process.argv[2]), { recursive: true }),
      path.resolve(process.argv[2]))
    : mkdtempSync(path.join(tmpdir(), 'solid-desktop-package-')),
);
const runtime = process.env.SOLID_DESKTOP_RUNTIME ?? defaultRuntime;
const NAME = 'solid-packaged-test';
const APP_ID = 'solid.test.packaged';
const LINK = 'solidtest://open/item?id=7';

// What the runtime is made of: both of Linux's window systems must be in it.
const made = runtimeDiagnostics(runtime);
for (const driver of ['x11', 'wayland']) {
  assert.ok(
    made.videoDrivers.includes(driver),
    `the runtime's SDL has no ${driver} video driver: ${made.videoDrivers}`,
  );
}
assert.match(
  execFileSync(runtime, ['--version'], { encoding: 'utf8' }),
  /^solid-desktop \d+\.\d+\.\d+\n$/,
);

const built = path.join(out, 'built-here');
const result = await packageDesktop({
  entry: path.join(here, 'app.ts'),
  appId: APP_ID,
  name: NAME,
  version: '1.2.3',
  title: 'Solid packaged test',
  icon: path.resolve(here, '../../native/tests/fixtures/colours.png'),
  assets: [path.join(platform, 'tests/webgl/fonts')],
  scheme: 'solidtest',
  outDir: built,
  bytecode: true,
  runtime,
});

// The layout.
const files = (directory, prefix = '') =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [prefix + entry.name],
  );
const packaged = files(result.directory).sort();
assert.equal(result.directory, path.join(built, NAME));
for (const file of [
  `bin/${NAME}`,
  'resources/app.hbc',
  'resources/fonts/Lato-Regular.msdf.json',
  'resources/fonts/Lato-Regular.msdf.png',
  `${APP_ID}.desktop`,
  `${APP_ID}.png`,
  'README.txt',
]) {
  assert.ok(packaged.includes(file), `${file} is not in ${packaged}`);
}
assert.ok(!packaged.includes('resources/app.js'), 'the source was shipped');
assert.ok(statSync(result.executable).mode & 0o111, 'not executable');
const entry = readFileSync(
  path.join(result.directory, `${APP_ID}.desktop`),
  'utf8',
);
for (const line of [
  '[Desktop Entry]',
  'Type=Application',
  'Name=Solid packaged test',
  `Exec=${NAME} %U`,
  `Icon=${APP_ID}`,
  'MimeType=x-scheme-handler/solidtest;',
]) {
  assert.ok(entry.split('\n').includes(line), `no "${line}" in:\n${entry}`);
}
const readme = readFileSync(path.join(result.directory, 'README.txt'), 'utf8');
assert.equal(result.sdl, made.sdlLinkage);
if (made.sdlLinkage === 'dynamic') {
  assert.match(readme, /Needs SDL 3 installed \(libSDL3\.so\.0/);
} else {
  assert.match(readme, /SDL .* is part of the executable/);
}
assert.equal(result.appImage, undefined);
// Nothing in the package names where it was built or this checkout. (The
// runtime's own executable is the same file wherever it is packaged.)
const checkout = path.resolve(here, '../../../..');
for (const file of packaged.filter((name) => !name.startsWith('bin/'))) {
  const bytes = readFileSync(path.join(result.directory, file));
  for (const place of [out, checkout]) {
    assert.ok(!bytes.includes(place), `${file} contains the path ${place}`);
  }
}

// Somewhere else, from the archive; the place it was built in is gone.
const moved = path.join(out, 'moved to', 'another place');
mkdirSync(moved, { recursive: true });
execFileSync('tar', ['-xzf', result.archive, '-C', moved]);
const archiveBytes = statSync(result.archive).size;
rmSync(built, { recursive: true });
const app = path.join(moved, NAME);
assert.deepEqual(files(app).sort(), packaged, 'the archive is not the package');

const home = path.join(out, 'home');
mkdirSync(home, { recursive: true });
const environment = {
  ...process.env,
  HOME: home,
  XDG_DATA_HOME: path.join(home, 'data'),
  XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_CONFIG_HOME: path.join(home, 'config'),
  // Not the user's session: no portal, no input method, no notifications.
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/solid-desktop-test',
};
delete environment.SOLID_DESKTOP_RUNTIME;
// From a directory that is neither the package nor the build.
const ran = spawnSync(path.join(app, 'bin', NAME), [LINK], {
  cwd: home,
  env: environment,
  encoding: 'utf8',
  timeout: 60000,
});
const line = ran.stdout.split('\n').find((l) => l.startsWith('PACKAGED '));
assert.ok(
  line,
  `no result from the packaged app (exit ${ran.status}):\n${ran.stdout}${ran.stderr}`,
);
const report = JSON.parse(line.slice(9));
assert.deepEqual(report.problems, [], 'the packaged app found problems');
assert.equal(ran.status, 0, ran.stderr);
assert.equal(report.appDir, path.join(app, 'resources'));
assert.deepEqual(report.args, [LINK]);
assert.equal(report.link, LINK);
assert.ok(report.idle.wakeups <= 1 && report.idle.frames === 0);
assert.equal(report.idle.presents, 0);
assert.match(report.stack, /\(app\.js:\d+:\d+\)/, 'the stack names no script');
assert.ok(
  !report.stack.includes(out) && !report.stack.includes(checkout),
  `the stack names a build path:\n${report.stack}`,
);
assert.deepEqual(
  ran.stderr
    .split('\n')
    .filter(
      (l) => l !== '' && !l.startsWith('[SolidTV] Image worker count is 0'),
    ),
  [],
  'unexpected output on standard error',
);

// The CLI's entry points, for the platform CLI: the lookup, the doctor, a
// build and a run without a window.
process.env.SOLID_DESKTOP_RUNTIME = runtime;
assert.equal(findRuntime(), path.resolve(runtime));
const doctor = doctorDesktop();
assert.ok(doctor.ok, JSON.stringify(doctor.checks));
assert.equal(doctor.runtime, path.resolve(runtime));
process.env.SOLID_DESKTOP_RUNTIME = path.join(out, 'no-such-runtime');
assert.throws(
  () => findRuntime(),
  /SOLID_DESKTOP_RUNTIME names .* does not exist/,
);
assert.equal(doctorDesktop().ok, false);
process.env.SOLID_DESKTOP_RUNTIME = runtime;

const build = await buildDesktop({
  entry: path.resolve(here, '../../native/tests/timers.js'),
  outDir: path.join(out, 'cli-build'),
  bytecode: true,
});
assert.equal(build.script, path.join(out, 'cli-build', 'app.hbc'));
assert.ok(existsSync(path.join(out, 'cli-build', 'app.js')));
for (const options of [
  { script: build.script },
  { entry: path.resolve(here, '../../native/tests/timers.js') },
]) {
  const running = await runDesktop({
    ...options,
    headless: true,
    args: ['an argument'],
    env: environment,
    stdio: 'ignore',
  });
  assert.equal(await running.exit, 0, `runDesktop(${Object.keys(options)})`);
}
await assert.rejects(runDesktop({}), /either "entry" or "script"/);

console.log(
  `package: ${packaged.length} files, archive ${(archiveBytes / 1e6).toFixed(1)} MB, ` +
    `runtime ${(statSync(runtime).size / 1e6).toFixed(1)} MB with SDL ${made.sdl} ${made.sdlLinkage} (${made.videoDrivers.join(' ')})`,
);
console.log(
  `package: moved and run from "${path.relative(out, app)}": the fixture's frame matches, link ${report.link}`,
);
console.log(
  `package: idle for ${report.idle.ms} ms: ${report.idle.wakeups} wakeup, ${report.idle.frames} frames, ${report.idle.presents} presents`,
);
console.log('package: doctor, build and run entry points work');
if (!keep) rmSync(out, { recursive: true });
