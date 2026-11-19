#!/usr/bin/env node
// Runs the generated starter app (cli/templates/app/app.tsx, unmodified) on
// an Android emulator and checks it from outside with adb. Run from
// packages/platform:
//
//   node tests/native-device/android-starter.mjs --serial emulator-<port> \
//     --form tv|phone --app <directory> [--build] [--out <directory>]
//
// `--app` is the generated app; `--build` creates it when it does not exist
// (pack, init, install, as tests/cli/android-smoke.sh does) and builds two
// APKs: the starter as generated, and the same file with one effect that
// logs the count. Without `--build` both APKs are expected from an earlier
// run. Checked: no error in the app's log (uncaught ones: a production build
// has no console calls left to report the others), the themed background with a
// title and a button in a screenshot, three presses (remote Enter on a TV, a
// tap on a phone) change the button and the logged count, BACK leaves the app
// on a TV, and on a phone the content stays below the status bar in both
// orientations. The package is uninstalled afterwards. Only emulators are
// accepted.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const framework = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
const adbPath = sdk ? path.join(sdk, 'platform-tools/adb') : 'adb';
const TARGETS = { phone: 'android', tv: 'android-tv' };
// The dark theme of src/sdk/theme.tsx, which the generated config selects.
const THEME = {
  background: 0x0b1118,
  surfaceRaised: 0x1d2937,
  text: 0xf2f6fa,
  focus: 0x60a5fa,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (name === 'build') result.build = true;
    else result[name] = argv[++i];
  }
  return result;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

/**
 * The starter with one effect that logs the count; nothing else changes. It
 * logs through android.util.Log: the build is a production build, whose
 * minifier removes every console call.
 */
export function countingVariant(source) {
  const name = '  createSignal,\n';
  const start = 'export default function App() {';
  const anchor = '  const run = (name: string) =>';
  if (
    !source.includes(name) ||
    !source.includes(start) ||
    source.split(anchor).length !== 2
  )
    throw new Error('src/app.tsx is not the generated starter');
  return source
    .replace(name, name + '  createEffect,\n')
    .replace(
      start,
      'declare const android: {\n  util: { Log: { i(tag: string, message: string): number } };\n};\n' +
        start,
    )
    .replace(
      anchor,
      "  createEffect(() => android.util.Log.i('STARTER', 'count ' + count()));\n" +
        anchor,
    );
}

const apkOf = (app, form, variant) =>
  path.join(app, `starter-${form}${variant ? '-' + variant : ''}.apk`);

function build(app, form) {
  const target = TARGETS[form];
  if (!existsSync(app)) {
    const scratch = path.join(path.dirname(app), path.basename(app) + '-pack');
    mkdirSync(scratch, { recursive: true });
    run('corepack', ['pnpm', 'pack', '--pack-destination', scratch], framework);
    const archive = readdirSync(scratch).find((name) => name.endsWith('.tgz'));
    run('tar', ['-xzf', path.join(scratch, archive), '-C', scratch]);
    run('node', [
      path.join(scratch, 'package/cli/main.mjs'),
      'init',
      app,
      '--targets',
      'android-tv,android',
    ]);
    run('corepack', ['pnpm', 'install'], app);
  }
  const built = path.join(
    app,
    'targets',
    target,
    'platforms/android/app/build/outputs/apk/debug/app-debug.apk',
  );
  const file = path.join(app, 'src/app.tsx');
  const starter = readFileSync(file, 'utf8');
  run('corepack', ['pnpm', 'build', target], app);
  copyFileSync(built, apkOf(app, form));
  try {
    writeFileSync(file, countingVariant(starter));
    run('corepack', ['pnpm', 'build', target], app);
    copyFileSync(built, apkOf(app, form, 'count'));
  } finally {
    writeFileSync(file, starter);
  }
}

/** adb against one emulator. Anything else is refused. */
function device(serial) {
  if (!/^emulator-\d+$/.test(serial ?? ''))
    throw new Error('Expected an emulator serial (emulator-<port>)');
  const adb = (args, encoding = 'utf8') =>
    execFileSync(adbPath, ['-s', serial, ...args], {
      encoding,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const shell = (command) => adb(['shell', command]);
  const tryShell = (command) => {
    try {
      return shell(command);
    } catch (error) {
      return String(error.stdout ?? '');
    }
  };
  return { adb, shell, tryShell };
}

/** A screenshot as pixels (`screencap` without -p: a header, then RGBA). */
function capture({ adb }) {
  const raw = adb(['exec-out', 'screencap'], 'buffer');
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  const offset = raw.length - width * height * 4;
  if (raw.readUInt32LE(8) !== 1 || offset < 12 || offset > 16)
    throw new Error('Unexpected screencap format');
  return {
    width,
    height,
    at: (x, y) => raw.readUInt32BE(offset + (y * width + x) * 4) >>> 8,
  };
}

const near = (a, b, tolerance = 10) =>
  Math.abs((a >> 16) - (b >> 16)) <= tolerance &&
  Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= tolerance &&
  Math.abs((a & 255) - (b & 255)) <= tolerance;

/** How many pixels of `rect` are `colour`, and the box around them. */
function find(shot, colour, rect = {}, tolerance) {
  const { left = 0, top = 0, right = shot.width, bottom = shot.height } = rect;
  const box = { left: right, top: bottom, right: left, bottom: top, count: 0 };
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      if (!near(shot.at(x, y), colour, tolerance)) continue;
      box.count++;
      if (x < box.left) box.left = x;
      if (x >= box.right) box.right = x + 1;
      if (y < box.top) box.top = y;
      if (y >= box.bottom) box.bottom = y + 1;
    }
  return box;
}

/** The starter's screen in a screenshot, or why it is not one. */
function inspect(shot, top = 0) {
  const total = shot.width * (shot.height - top);
  const background = find(shot, THEME.background, { top }).count / total;
  if (background < 0.5)
    return { error: `background covers ${(background * 100).toFixed(1)}%` };
  // The button is focused where the target has focus; raised otherwise.
  let button = find(shot, THEME.focus, { top });
  if (button.count < 500) button = find(shot, THEME.surfaceRaised, { top });
  const area = (button.right - button.left) * (button.bottom - button.top);
  if (button.count < 500 || button.count / area < 0.5)
    return { error: `no button (${button.count} pixels in ${area})` };
  const title = find(shot, THEME.text, { top, bottom: button.top }, 24);
  if (title.count < 100)
    return { error: `no title above the button (${title.count} pixels)` };
  return { background, button, title };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('ok   ' + message);
}

async function until(read, timeout, what) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await sleep(500);
  }
}

async function drive({ serial, form, app, out }) {
  const emulator = device(serial);
  const { adb, shell, tryShell } = emulator;
  const id = JSON.parse(
    readFileSync(path.join(app, 'solid-platform.config.json'), 'utf8'),
  ).id;
  if (
    shell('pm list packages')
      .split('\n')
      .includes('package:' + id)
  )
    throw new Error(id + ' is already installed on ' + serial);
  mkdirSync(out, { recursive: true });
  const save = (name) => {
    const file = path.join(out, `starter-${form}-${name}.png`);
    writeFileSync(file, adb(['exec-out', 'screencap', '-p'], 'buffer'));
    console.log('     ' + file);
  };
  const log = () => {
    const pid = tryShell('pidof ' + id).trim();
    return pid ? adb(['logcat', '-d', '--pid=' + pid]) : '';
  };
  const resumed = () =>
    shell('dumpsys activity activities')
      .split('\n')
      .some((line) => /ResumedActivity/.test(line) && line.includes(id));
  const launch = async (apk) => {
    adb(['install', '-r', apk]);
    shell('input keyevent KEYCODE_WAKEUP');
    if (form === 'phone') shell('wm dismiss-keyguard');
    shell(`am start -W -n ${id}/com.tns.NativeScriptActivity`);
    await until(resumed, 20000, 'the activity');
  };
  const statusBar = () => {
    const frame = /type=statusBars frame=\[0,0\]\[\d+,(\d+)\]/.exec(
      shell('dumpsys window'),
    );
    return frame ? Number(frame[1]) : 0;
  };
  const screen = async (top) => {
    let seen;
    await until(
      () => !(seen = inspect(capture(emulator), top)).error,
      30000,
      'the starter screen',
    ).catch((error) => {
      throw new Error(`${error.message}: ${seen.error}`);
    });
    return seen;
  };
  const errors = () =>
    log()
      .split('\n')
      .filter((line) =>
        /FATAL EXCEPTION| E (JS|AndroidRuntime|TNS[.\w]*)\s*:|startup failed|Font load failed/.test(
          line,
        ),
      );
  const press = async (button) => {
    for (let i = 0; i < 3; i++) {
      shell(
        form === 'tv'
          ? 'input keyevent KEYCODE_DPAD_CENTER'
          : `input tap ${Math.round((button.left + button.right) / 2)} ${Math.round((button.top + button.bottom) / 2)}`,
      );
      await sleep(400);
    }
  };
  const rotation =
    form === 'phone'
      ? {
          auto: shell('settings get system accelerometer_rotation').trim(),
          user: shell('settings get system user_rotation').trim(),
        }
      : undefined;
  try {
    // The starter as generated.
    await launch(apkOf(app, form));
    const top = form === 'phone' ? statusBar() : 0;
    const first = await screen(top);
    save('launch');
    assert(
      true,
      `themed background (${(first.background * 100).toFixed(0)}%), title and button at ${JSON.stringify(first.button)}`,
    );
    if (form === 'phone') {
      const clear = find(capture(emulator), THEME.background, {
        top,
        bottom: top + 4,
      }).count;
      assert(
        first.title.top >= top + 4 && clear === 4 * capture(emulator).width,
        `content starts below the status bar (${top}px): title at ${first.title.top}px`,
      );
    }
    const before = capture(emulator);
    await press(first.button);
    await sleep(600);
    const after = capture(emulator);
    save('pressed');
    let changed = 0;
    for (let y = first.button.top; y < first.button.bottom; y++)
      for (let x = first.button.left; x < first.button.right; x++)
        if (!near(before.at(x, y), after.at(x, y))) changed++;
    assert(
      changed > 0,
      `the button changed after three presses (${changed} pixels)`,
    );
    if (form === 'phone') {
      shell('settings put system accelerometer_rotation 0');
      shell('settings put system user_rotation 1');
      await until(
        () => {
          const shot = capture(emulator);
          return shot.width > shot.height;
        },
        10000,
        'landscape',
      );
      await sleep(1500);
      const bar = statusBar();
      const landscape = await screen(bar);
      save('landscape');
      assert(
        landscape.title.top >= bar + 4,
        `landscape content starts below the status bar (${bar}px): title at ${landscape.title.top}px`,
      );
      shell('settings put system user_rotation 0');
      await until(
        () => {
          const shot = capture(emulator);
          return shot.height > shot.width;
        },
        10000,
        'portrait',
      );
      await sleep(1500);
    }
    const failed = errors();
    assert(failed.length === 0, ['no error in the log', ...failed].join('\n'));
    if (form === 'tv') {
      shell('input keyevent KEYCODE_BACK');
      await until(() => !resumed(), 5000, 'BACK to leave the app');
      assert(true, 'BACK at the root leaves the app');
    }
    shell('am force-stop ' + id);

    // The same starter logging its count.
    await launch(apkOf(app, form, 'count'));
    const second = await screen(form === 'phone' ? statusBar() : 0);
    const count = () => {
      const lines = log().match(/STARTER\s*: count \d+/g);
      return lines ? Number(lines.at(-1).split(' ').at(-1)) : undefined;
    };
    await until(() => count() === 0, 10000, 'STARTER: count 0');
    await press(second.button);
    await until(() => count() === 3, 5000, 'STARTER: count 3').catch(
      (error) => {
        throw new Error(`${error.message} (saw ${count()})`);
      },
    );
    assert(true, 'three presses counted: STARTER: count 3');
    const late = errors();
    assert(late.length === 0, ['no error in the log', ...late].join('\n'));
  } finally {
    if (rotation) {
      tryShell('settings put system user_rotation ' + rotation.user);
      tryShell('settings put system accelerometer_rotation ' + rotation.auto);
    }
    tryShell('am force-stop ' + id);
    tryShell('pm uninstall ' + id);
    tryShell('input keyevent KEYCODE_HOME');
  }
}

const given = options(process.argv.slice(2));
if (!TARGETS[given.form] || !given.app || !given.serial) {
  console.error(
    'Usage: android-starter.mjs --serial emulator-<port> --form tv|phone --app <directory> [--build] [--out <directory>]',
  );
  process.exit(2);
}
given.app = path.resolve(given.app);
given.out = path.resolve(given.out ?? path.join(given.app, 'evidence'));
try {
  device(given.serial);
  if (given.build) build(given.app, given.form);
  await drive(given);
  console.log(`PASS starter on ${given.form} (${given.serial})`);
} catch (error) {
  console.error('FAIL ' + (error.stack ?? error));
  process.exit(1);
}
