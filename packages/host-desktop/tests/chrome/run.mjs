// The window chrome test's driver: the scene's own title bar, driven by real
// X events under Xvfb. It starts a window manager when one is available
// (`openbox` on the PATH, or the executable in SOLID_DESKTOP_WM), runs the
// app in each title bar mode, and judges the window's geometry, its frame
// extents, the pixels of a screenshot of the X root, and what the app
// reports from the runtime.
//
//   xvfb-run -a node tests/chrome/run.mjs [out-dir]
//
// Without a window manager the scene, the hit-test classifications, the
// insets, the buttons and closing are still checked; the assertions that a
// press moves or resizes a window are skipped and reported as not proven.
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '../../../platform');
const keep = process.argv[2] !== undefined;
const out = keep
  ? path.resolve(process.argv[2])
  : mkdtempSync(path.join(tmpdir(), 'solid-desktop-chrome-'));
const IDLE_MS = 3000;
const BAR = 40;

const has = (program) =>
  spawnSync('sh', ['-c', `command -v ${program}`]).status === 0;
const wmExecutable = process.env.SOLID_DESKTOP_WM ?? (has('openbox') ? 'openbox' : undefined);
const image = has('magick') ? 'magick' : has('convert') ? 'convert' : undefined;
const screenshots = has('import') && image !== undefined;

mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const file of [
  'Lato-Regular.msdf.json',
  'Lato-Regular.msdf.png',
]) {
  copyFileSync(
    path.join(platform, 'tests/webgl/fonts', file),
    path.join(out, 'fonts', file),
  );
}
writeFileSync(
  path.join(out, 'setup.json'),
  JSON.stringify({ idleMs: IDLE_MS, barHeight: BAR }),
);
const home = path.join(out, 'home');
mkdirSync(path.join(home, 'config'), { recursive: true });
const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  if (
    /^(https?|all|no)_proxy$/i.test(name) ||
    /^(LC_|LANGUAGE$)/.test(name) ||
    /_IM_MODULE$|^XMODIFIERS$/.test(name)
  ) {
    delete environment[name];
  }
}
Object.assign(environment, {
  HOME: home,
  XDG_DATA_HOME: path.join(home, 'data'),
  XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_CONFIG_HOME: path.join(home, 'config'),
  LANG: 'fr_FR.UTF-8',
  SDL_VIDEODRIVER: 'x11',
  LIBGL_ALWAYS_SOFTWARE: '1',
  SOLID_DESKTOP_TEST: '1',
});

const xdo = (...args) =>
  execFileSync('xdotool', args, { encoding: 'utf8', env: environment }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check()` is true, or fails the test. */
async function until(what, check, ms = 6000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (check()) return true;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function geometry(window) {
  const fields = Object.fromEntries(
    xdo('getwindowgeometry', '--shell', window)
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => line.split('=')),
  );
  return {
    x: Number(fields.X),
    y: Number(fields.Y),
    width: Number(fields.WIDTH),
    height: Number(fields.HEIGHT),
  };
}

async function windowFor(name) {
  let window;
  await until(`the window "${name}"`, () => {
    try {
      window = xdo('search', '--name', `^${name}$`).split('\n')[0];
      return window !== undefined && window !== '';
    } catch {
      return false;
    }
  });
  return window;
}

function drag(window, x, y, dx, dy) {
  xdo(
    'mousemove',
    '--window',
    window,
    String(x),
    String(y),
    'mousedown',
    '1',
    'sleep',
    '0.2',
    'mousemove_relative',
    '--',
    String(dx),
    String(dy),
    'sleep',
    '0.2',
    'mouseup',
    '1',
  );
}

function click(window, x, y) {
  xdo('mousemove', '--window', window, String(x), String(y), 'click', '1');
}

function frameExtents(window) {
  const text = execFileSync(
    'xprop',
    ['-id', window, '_NET_FRAME_EXTENTS'],
    { encoding: 'utf8', env: environment },
  );
  const numbers = text.match(/-?\d+/g);
  return numbers === null ? [0, 0, 0, 0] : numbers.slice(0, 4).map(Number);
}

/** The RGB of a point of the X root, as a screenshot sees it. */
function screenshot(x, y, file) {
  importRoot(file);
  const text = execFileSync(
    image,
    [file, '-crop', `1x1+${x}+${y}`, '-depth', '8', 'txt:-'],
    { encoding: 'utf8', env: environment },
  );
  const match = text.match(/#([0-9A-Fa-f]{6})/);
  return match === null
    ? undefined
    : [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
}

function importRoot(file) {
  execFileSync('import', ['-window', 'root', file], {
    env: environment,
    stdio: 'ignore',
  });
}

/** Runs a script in the runtime; resolves with what it printed and how it ended. */
function runtime(args, { extra = {}, onLine = () => {}, timeout = 120000 } = {}) {
  let child;
  const promise = new Promise((resolve) => {
    child = spawn(defaultRuntime, args, {
      cwd: out,
      env: { ...environment, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let line = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      line += chunk;
      for (let end; (end = line.indexOf('\n')) !== -1; line = line.slice(end + 1)) {
        const one = line.slice(0, end);
        try {
          onLine(one, child);
        } catch (error) {
          stderr += `driver: ${error.message}\n`;
          child.kill('SIGKILL');
        }
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status, signal });
    });
  });
  promise.child = child;
  return promise;
}

/**
 * The first line of `kind` printed at or after `from` whose payload matches
 * `predicate`. Reading the array the runtime's listener appends to means an
 * event that arrives before the wait starts is not lost.
 */
async function nextLine(lines, from, kind, predicate = () => true, ms = 6000) {
  for (let waited = 0; waited < ms; waited += 30) {
    const found = lines
      .slice(from)
      .filter((one) => one.startsWith(`${kind} `))
      .map((one) => JSON.parse(one.slice(kind.length + 1)))
      .find(predicate);
    if (found !== undefined) return found;
    await sleep(30);
  }
  throw new Error(`no ${kind} line in ${ms} ms`);
}

let startWm;
async function startWindowManager() {
  if (wmExecutable === undefined) return false;
  const child = spawn(wmExecutable, ['--replace'], {
    env: environment,
    stdio: 'ignore',
  });
  startWm = child;
  // The root's own check is what says a WM is running.
  try {
    await until(
      'a window manager',
      () =>
        execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], {
          encoding: 'utf8',
          env: environment,
        }).includes('window id'),
      5000,
    );
    return true;
  } catch {
    child.kill('SIGTERM');
    startWm = undefined;
    return false;
  }
}

const scripts = {};
scripts.app = await bundle({
  entry: path.join(here, 'app.tsx'),
  outfile: path.join(out, 'app.js'),
});

const notes = [];
try {
  const windowManager = await startWindowManager();
  notes.push(
    windowManager
      ? `a window manager (${wmExecutable}) is running`
      : 'NO window manager: movement and resize assertions are skipped',
  );

  // 1. custom: the scene's bar, the insets, the hit test, and real input.
  const custom = await runCustom(windowManager);
  // 2. native: no scene bar, zero inset, decorated by the WM.
  const nativeRun = await runNative(windowManager);
  // 3. the fallbacks: a refused borderless window and a refused hit test.
  await runFallback('borderless');
  await runFallback('hit-test');
  // 4. idle with the regions settled.
  const idle = await runIdle();

  console.log('chrome: ' + notes.join('; '));
  console.log(`chrome: ${custom} checks in the custom run`);
  console.log(`chrome: native run ${nativeRun.mode}, insets ${nativeRun.viewport.safeAreaTop}`);
  console.log(
    `chrome: idle for ${idle.ms} ms: ${idle.wakeups} wakeup, ${idle.frames} frames, ${idle.presents} presents`,
  );
  if (!screenshots)
    console.log('chrome: screenshots not compared: import or convert is missing');
  console.log('desktop chrome tests passed');
} finally {
  startWm?.kill('SIGTERM');
  if (!keep) rmSync(out, { recursive: true, force: true });
}

async function runCustom(windowManager) {
  let checks = 0;
  const check = (name, ok, detail) => {
    checks++;
    assert.ok(ok, detail === undefined ? name : `${name}: ${detail}`);
  };
  const lines = [];
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  let exited;
  const exit = new Promise((resolve) => (exited = resolve));
  const app = runtime([`--title-bar=custom`, scripts.app], {
    onLine(line) {
      lines.push(line);
      if (line.startsWith('READY ')) readyResolve(JSON.parse(line.slice(6)));
    },
  });
  app.then((result) => exited(result));

  const report = await ready;
  assert.equal(report.mode, 'custom', 'the app did not start in custom mode');
  assert.equal(report.hitTestInstalled, true, 'the hit test is not installed');
  assert.equal(report.viewport.safeAreaTop, BAR, 'the bar did not publish its safe-area inset');
  assert.equal(report.viewport.systemBarTop, BAR, 'the bar did not publish its system-bar inset');
  assert.deepEqual(report.hit, {
    bar: 'draggable',
    titleEdge: 'resize-topleft',
    content: 'normal',
    nested: 'draggable',
    nestedControl: 'normal',
    interactive: 'normal',
    maximize: 'normal',
    close: 'normal',
    leftEdge: 'resize-left',
  });

  const [bar, below, content] = report.pixels;
  check('the bar is drawn at the top of the scene', JSON.stringify(bar) !== JSON.stringify(content), `${bar} vs ${content}`);
  check('the content is below the bar', JSON.stringify(below) === JSON.stringify(content), `${below} vs ${content}`);
  const window = await windowFor('Solid chrome test');
  xdo('windowactivate', '--sync', window);

  if (screenshots) {
    // The scene's own pixels at the same places: what reached the screen is
    // the scene, not a decoration drawn over it.
    const file = path.join(out, 'custom-root.png');
    const top = geometry(window);
    const seen = screenshot(top.x + 2, top.y + 2, file);
    assert.deepEqual(seen, bar.slice(0, 3), 'the screenshot does not show the scene bar');
    const lower = screenshot(top.x + 2, top.y + BAR + 2, file);
    assert.deepEqual(lower, content.slice(0, 3), 'the screenshot does not show the content below the bar');
    notes.push('a screenshot of the X root shows the scene bar and the content under it');
  }

  if (windowManager) {
    // Decoration: none on a borderless custom window.
    assert.deepEqual(frameExtents(window), [0, 0, 0, 0], 'the custom window is decorated');
    notes.push('the custom window has no frame extents');

    // Drag by the title bar.
    let before = geometry(window);
    drag(window, 300, 20, 80, 40);
    await sleep(350);
    let after = geometry(window);
    check('dragging the bar moves the window', after.x === before.x + 80 && after.y === before.y + 40, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    notes.push('a press on the bar moved the window');

    // Each edge and each corner.
    const resize = async (name, x, y, dx, dy, expected) => {
      const start = geometry(window);
      drag(window, x(start), y(start), dx, dy);
      await sleep(350);
      const end = geometry(window);
      const actual = expected(start, end);
      check(`resize ${name}`, actual, `${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
    };
    await resize('right', (g) => g.width - 3, (g) => Math.round(g.height / 2), 40, 0,
      (s, e) => e.width >= s.width + 30 && e.height === s.height);
    await resize('bottom', (g) => Math.round(g.width / 2), (g) => g.height - 3, 0, 40,
      (s, e) => e.height >= s.height + 30 && e.width === s.width);
    await resize('top', (g) => Math.round(g.width / 2), () => 2, 0, 30,
      (s, e) => e.height <= s.height - 20 && e.y >= s.y + 20);
    await resize('left', () => 2, (g) => Math.round(g.height / 2), 30, 0,
      (s, e) => e.width <= s.width - 20 && e.x >= s.x + 20);
    await resize('bottom-right', (g) => g.width - 3, (g) => g.height - 3, 30, 30,
      (s, e) => e.width >= s.width + 20 && e.height >= s.height + 20);
    await resize('top-left', () => 2, () => 2, 30, 30,
      (s, e) => e.width <= s.width - 20 && e.height <= s.height - 20 && e.x > s.x && e.y > s.y);
    await resize('top-right', (g) => g.width - 3, () => 2, 30, 30,
      (s, e) => e.width >= s.width + 20 && e.height <= s.height - 20);
    await resize('bottom-left', () => 2, (g) => g.height - 3, 30, 30,
      (s, e) => e.width <= s.width - 20 && e.height >= s.height + 20);
    notes.push('all four edges and all four corners resized the window');

    // A press on a control is not a drag, and the control keeps the press.
    const still = geometry(window);
    drag(window, still.width - 54, 20, 60, 40);
    await sleep(350);
    const dragged = geometry(window);
    check('a control is not draggable', dragged.x === still.x && dragged.y === still.y, `${JSON.stringify(still)} -> ${JSON.stringify(dragged)}`);
    notes.push('a drag that started on a button did not move the window');

    // A framework control inside a drag region: no explicit WindowNoDrag,
    // still not a drag, and the click reaches the control. The count is not
    // asserted: under Xvfb this SDL build has been seen to deliver one X
    // press and release as two identical pairs (xev sees one), so the app
    // may count two presses for one click.
    let interactiveMark = lines.length;
    click(window, 370, BAR + 130);
    await sleep(200);
    const unmoved = geometry(window);
    check('an interactive node is not draggable', unmoved.x === still.x && unmoved.y === still.y, `${JSON.stringify(still)} -> ${JSON.stringify(unmoved)}`);
    xdo('key', 'F9');
    const controlProbe = await nextLine(lines, interactiveMark, 'PROBE');
    check('the interactive node kept the press', controlProbe.pressed >= 1, `pressed ${controlProbe.pressed}`);
    notes.push('an interactive node inside a drag region kept its own press');
  }

  // Maximize and restore. The buttons are proven by the state events their
  // clicks produce; the edge behaviour is proven through the keyboard
  // (F7 maximizes in the app, F6 restores), because a doubled X delivery
  // (the note above) can toggle a button click twice and even coalesce both
  // toggles into one turn's `windowstate` event. The events are the truth.
  let mark = lines.length;
  let current = geometry(window);
  click(window, current.width - 54, 20);
  const toggled = await nextLine(lines, mark, 'STATE');
  check('the maximize button reaches the window system', toggled !== undefined, JSON.stringify(toggled));
  notes.push('a click on the maximize button arrived back as a state event');

  const edgesFollowState = (probe) => {
    const off =
      probe.state.maximized === true || probe.state.fullscreen === true;
    const title = probe.hit.titleEdge;
    const side = probe.hit.leftEdge;
    return off
      ? title === 'draggable' && side === 'normal'
      : title === 'resize-topleft' && side === 'resize-left';
  };
  // F7 maximizes, F6 restores, wherever the button click left the window.
  mark = lines.length;
  xdo('key', 'F7');
  await sleep(400);
  xdo('key', 'F9');
  const maxProbe = await nextLine(lines, mark, 'PROBE');
  check('a maximized window has no resize edges', maxProbe.state.maximized === true && edgesFollowState(maxProbe), JSON.stringify({ state: maxProbe.state, hit: maxProbe.hit }));
  notes.push('maximize removed the resize edges, read from the state it arrived in');

  mark = lines.length;
  xdo('key', 'F6');
  await sleep(400);
  xdo('key', 'F9');
  const restoredProbe = await nextLine(lines, mark, 'PROBE');
  check('a restored window resizes at its edges again', restoredProbe.state.maximized === false && edgesFollowState(restoredProbe), JSON.stringify({ state: restoredProbe.state, hit: restoredProbe.hit }));
  notes.push('restore brought the resize edges back');

  // Fullscreen hides the bar and removes its inset.
  mark = lines.length;
  xdo('key', 'F8');
  const full = await nextLine(lines, mark, 'STATE', (state) => state.fullscreen === true);
  check('fullscreen arrived as an event', full.fullscreen === true, JSON.stringify(full));
  await nextLine(lines, mark, 'VIEW', (view) => view.safeAreaTop === 0);
  await sleep(300);
  mark = lines.length;
  xdo('key', 'F9');
  const fullProbe = await nextLine(lines, mark, 'PROBE');
  check('the bar is gone in fullscreen', JSON.stringify(fullProbe.pixels[0]) === JSON.stringify(fullProbe.pixels[2]), JSON.stringify(fullProbe.pixels));
  check('fullscreen removes the inset', fullProbe.viewport.safeAreaTop === 0, String(fullProbe.viewport.safeAreaTop));
  notes.push('fullscreen hid the bar and its inset');

  mark = lines.length;
  xdo('key', 'F8');
  const back = await nextLine(lines, mark, 'STATE', (state) => state.fullscreen === false);
  check('leaving fullscreen arrived as an event', back.fullscreen === false, JSON.stringify(back));
  await nextLine(lines, mark, 'VIEW', (view) => view.safeAreaTop === BAR);

  // Close through the framework's button: the app disposes, then exits 0.
  await sleep(200);
  current = geometry(window);
  click(window, current.width - 18, 20);
  const result = await exit;
  check('the close button ended the app with status 0', result.status === 0, `status ${result.status} ${result.signal ?? ''}\n${result.stderr}`);
  const text = result.stdout.split('\n');
  check(
    'closing ran the disposer',
    text.findIndex((one) => one === 'DISPOSED') > text.findIndex((one) => one.startsWith('READY ')) &&
      text.includes('DISPOSED'),
    'no DISPOSED after READY',
  );
  notes.push('the close button ran the app disposal and the process ended with 0');
  return checks;
}

async function runNative(windowManager) {
  const lines = [];
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  const run = runtime([`--title-bar=native`, scripts.app], {
    onLine(line) {
      lines.push(line);
      if (line.startsWith('READY ')) readyResolve(JSON.parse(line.slice(6)));
    },
  });
  const report = await ready;
  assert.equal(report.mode, 'native', 'native mode was not reported');
  assert.equal(report.hitTestInstalled, false, 'native mode installed a hit test');
  assert.equal(report.viewport.safeAreaTop, 0, 'native mode has an inset');
  assert.equal(report.viewport.systemBarTop, 0, 'native mode has a system-bar inset');
  const [top, , content] = report.pixels;
  assert.deepEqual(top, content, 'native mode draws a scene title bar');
  const window = await windowFor('Solid chrome test');
  if (windowManager) {
    const extents = frameExtents(window);
    assert.ok(extents[2] > 0, `the native window has no top decoration: ${extents}`);
    notes.push(`the native window is decorated (frame extents ${extents.join(',')})`);
  }
  if (screenshots) {
    const shot = geometry(window);
    const seen = screenshot(shot.x + 2, shot.y + 2, path.join(out, 'native-root.png'));
    assert.deepEqual(seen, content.slice(0, 3), 'the native client area is not the scene content');
    notes.push('a screenshot shows the native client area starting with the scene content');
  }
  // The app waits; end it the way the window's close button would.
  run.child.kill('SIGTERM');
  const result = await run;
  assert.equal(result.status, 0, `native run exit ${result.status} ${result.signal ?? ''}\n${result.stderr}`);
  assert.ok(result.stdout.includes('DISPOSED'), 'native run did not dispose');
  return report;
}

async function runFallback(failure) {
  const lines = [];
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  const run = runtime([`--title-bar=custom`, scripts.app], {
    extra: { SOLID_DESKTOP_CHROME_FAIL: failure },
    onLine(line) {
      lines.push(line);
      if (line.startsWith('READY ')) readyResolve(JSON.parse(line.slice(6)));
    },
  });
  const report = await ready;
  assert.equal(report.mode, 'native', `a refused ${failure} did not fall back to native`);
  assert.equal(report.hitTestInstalled, false, `a refused ${failure} left hit testing on`);
  assert.equal(report.viewport.safeAreaTop, 0, `a refused ${failure} kept the scene bar's inset`);
  run.child.kill('SIGTERM');
  const result = await run;
  assert.equal(result.status, 0, `${failure} fallback exit ${result.status} ${result.signal ?? ''}\n${result.stderr}`);
  notes.push(`a refused ${failure} recreated a native window and reported native`);
}

async function runIdle() {
  const lines = [];
  let idleResolve;
  const idle = new Promise((resolve) => (idleResolve = resolve));
  const run = runtime([`--title-bar=custom`, scripts.app, '--', 'idle'], {
    onLine(line) {
      lines.push(line);
      if (line.startsWith('IDLE ')) idleResolve(JSON.parse(line.slice(5)));
    },
  });
  const result = await idle;
  assert.ok(result.wakeups <= 1, `${result.wakeups} wakeups while idle`);
  assert.equal(result.frames, 0, `${result.frames} frames while idle`);
  assert.equal(result.presents, 0, `${result.presents} presents while idle`);
  const done = await run;
  assert.equal(done.status, 0, `idle run exit ${done.status} ${done.signal ?? ''}\n${done.stderr}`);
  return result;
}
