// Builds the host test app (host-app.tsx), installs it on the Roku named by
// ROKU_DEV_IP and drives it as a user and the firmware would: remote keys,
// launch and input deep links, a relaunch, and a launch that throws. Checks
// what the app prints on the console, what is on screen, and which app the
// device says is active. Exits non-zero on a failed probe. This replaces
// whatever is in the device's developer slot. The app that was on screen
// before is brought back afterwards.
//
//   node tests/roku-device/run-host.mjs [--out results/host] [--keep]
//
// `--out` writes <out>-result.txt and <out>-<step>.jpg.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  keyhold,
  keypress,
  launch,
  readConsole,
  rokuDevice,
  screenshot,
  sendInput,
  sideload,
} from '../../cli/roku-device.mjs';
import { decodeImage, imageKind, pixel } from './image.mjs';
import { BUTTONS, MODAL } from './host-cases.mjs';

const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-host');
const zip = path.join(out, 'host.zip');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const target = flag('--out');
const device = rokuDevice();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const output = [];
const say = (line) => {
  output.push(line);
  console.log(line);
};

const info = await deviceInfo(device);
if (!info.developerEnabled)
  throw new Error('Developer mode is off on this Roku.');
say(`Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`);

rmSync(out, { recursive: true, force: true });
execFileSync(
  path.join(project, 'node_modules/.bin/rk'),
  ['build', '--local', '--no-drop-console', '--no-source-map', '--out-dir', out, '--config', 'host.roku-config.ts'],
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

// ---- the console ---------------------------------------------------------------

const notes = [];
const waiters = [];
let fresh = false;
const reading = readConsole(
  device,
  (line) => {
    // On connecting, the console replays what the last app printed.
    if (!fresh) return false;
    const at = line.search(/HOST |ROKU_[A-Z_]+ |\[beacon\./);
    if (at === -1) return false;
    // An input event names the machine that sent it; that is not kept.
    const text = line.slice(at).replace(/(source_ip_addr=)[^&\s]*/g, '$1x');
    notes.push(text);
    for (const waiter of waiters.slice())
      if (waiter.test.test(text)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(text);
      }
    return false;
  },
  240_000,
);
/** The first console line from `from` on that matches, or undefined after `ms`. */
function waitFor(test, ms = 20_000, from = 0) {
  const seen = notes.slice(from).find((note) => test.test(note));
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve) => {
    const waiter = { test, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at !== -1) waiters.splice(at, 1);
      resolve(undefined);
    }, ms);
  });
}
/** Whether the developer app leaves the screen within `ms`. */
async function exited(ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(400))
    if ((await activeApp(device)) !== 'dev') return true;
  return false;
}
/**
 * At the root, Back must exit the channel. A key sent while the channel is
 * still resuming can be dropped by the firmware, so first prove the app takes
 * keys (Play and its handler print) and allow one retry; the detail says so
 * when a retry was needed.
 */
async function exitAtRoot() {
  const mark = notes.length;
  await keypress(device, 'Play');
  const reachable = (await waitFor(/^HOST KEY PlayPause/, 5000, mark)) !== undefined;
  await keypress(device, 'Back');
  if (await exited(6000)) return { ok: true, detail: '' };
  if (!reachable) return { ok: false, detail: 'the app did not take a key before Back' };
  await keypress(device, 'Back');
  return (await exited(8000))
    ? { ok: true, detail: 'needed a second Back (the first was dropped)' }
    : { ok: false, detail: 'the app stayed in front after two Backs' };
}

// ---- probes ----------------------------------------------------------------------

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  say(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const shots = {};
async function shoot(name) {
  const shot = await screenshot(device);
  shots[name] = shot;
  if (target) {
    mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    writeFileSync(`${target}-${name}.${imageKind(shot)}`, shot);
  }
  return decodeImage(shot);
}
const centre = (box) => [box.x + box.w / 2, box.y + box.h / 2];
const isGreen = ([r, g, b]) => g > 140 && r < 90 && b < 90;
const isGrey = ([r, g, b]) => Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 35 && r < 100;
const isBlue = ([r, , b]) => b > 180 && r < 90;
const at = (image, box) => pixel(image, ...centre(box));

const previous = await activeApp(device);
try {
  await sleep(1500);
  fresh = true;

  // ---- first launch: services, beacon, keys ----
  await sideload(device, zip);
  if (!(await waitFor(/^HOST START/, 15_000))) await launch(device, 'dev');
  const ready = await waitFor(/^HOST (READY|ERROR)/, 90_000);
  check('started through startApp(rokuHost())', /^HOST READY/.test(ready ?? ''), ready ?? 'no READY on the console');
  const line = (test, from = 0) => notes.slice(from).find((note) => test.test(note)) ?? '';

  const globals = line(/^HOST GLOBALS /);
  check('no browser globals on the device', /document=undefined window=undefined navigator=undefined localStorage=undefined history=undefined location=undefined/.test(globals), globals);
  const services = line(/^HOST SERVICES /);
  check('registry lists the host providers', ['connectivity', 'deviceInfo', 'keyEvents', 'lifecycle', 'links', 'locale', 'memory', 'request', 'secureStorage', 'settings'].every((name) => services.split(/[ ,]/).includes(name)), services);
  const deviceLine = line(/^HOST DEVICE /);
  check('deviceInfo answers from the device', /platform=roku model=true osVersion=\d+\.\d+\.\d+ appVersion=\d+\.\d+\.\d+ displayMode=\S+/.test(deviceLine) && deviceLine.includes('osVersion=' + info.softwareVersion), deviceLine.replace(/^HOST DEVICE /, ''));
  const localeLine = line(/^HOST LOCALE /);
  check('locale is a BCP 47 tag', /^HOST LOCALE [a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(localeLine), localeLine);
  check('no launch deep link without launch parameters', line(/^HOST LINK initial /) === 'HOST LINK initial null', line(/^HOST LINK initial /));
  const wrote = /wrote=(\d+)/.exec(line(/^HOST SETTINGS wrote=/))?.[1];
  check('settings write reads back', wrote !== undefined, line(/^HOST SETTINGS before=/) + ', ' + line(/^HOST SETTINGS wrote=/));
  check('a setting never written reads as null', line(/^HOST SETTINGS missing=/) === 'HOST SETTINGS missing=null', line(/^HOST SETTINGS missing=/));
  const secureLine = line(/^HOST SECURE wrote=/);
  check('secure storage reads back and the registry holds cipher text', secureLine.startsWith(`HOST SECURE wrote=host-secret-${wrote} storedHex=true`) && secureLine.endsWith('holdsPlainText=false'), secureLine);
  check('memory answers', line(/^HOST MEMORY \{/) === 'HOST MEMORY {"lowMemory":false}' && /[=,]normal(,|$)/i.test(line(/^HOST MEMORY levels=/)), line(/^HOST MEMORY \{/) + ', ' + line(/^HOST MEMORY levels=/));
  check('connectivity answers', line(/^HOST CONNECTIVITY online=/) === 'HOST CONNECTIVITY online=true', line(/^HOST CONNECTIVITY /));
  check('lifecycle is active', line(/^HOST LIFECYCLE active=/) === 'HOST LIFECYCLE active=true', line(/^HOST LIFECYCLE /));
  const page = line(/^HOST FETCH page /);
  check('fetch of a public HTTPS page', page === 'HOST FETCH page status=200 ok=true body=true', page);
  const missing = line(/^HOST FETCH missing /);
  check('fetch of a host that does not exist fails', /^HOST FETCH missing (rejected|status=(0|[45]\d\d) ok=false)/.test(missing), missing);
  const beacon = await waitFor(/AppLaunchComplete/, 5000);
  check('AppLaunchComplete beacon', beacon !== undefined, beacon ?? 'not on the console');

  let image = await shoot('focus-0');
  check('first button has focus on screen', isGreen(at(image, BUTTONS[0])) && isGrey(at(image, BUTTONS[1])), `b0 ${at(image, BUTTONS[0])} b1 ${at(image, BUTTONS[1])}`);

  await keypress(device, 'Right');
  check('Right moves focus', (await waitFor(/^HOST FOCUS b1/, 5000)) !== undefined);
  check('the keyEvents service raises the key', (await waitFor(/^HOST KEYEVENTS keyup ArrowRight/, 5000)) !== undefined);
  await sleep(700);
  image = await shoot('focus-1');
  check('second button has focus on screen', isGreen(at(image, BUTTONS[1])) && isGrey(at(image, BUTTONS[0])), `b0 ${at(image, BUTTONS[0])} b1 ${at(image, BUTTONS[1])}`);

  // A held key: one press, whatever repeats the firmware sends (none on
  // Roku OS 16), and one release. The host adds no repeats of its own.
  let held = notes.length;
  await keyhold(device, 'Left', 2000);
  await sleep(700);
  const repeats = notes.slice(held).filter((note) => note === 'HOST REPEAT ArrowLeft').length;
  const moves = notes.slice(held).filter((note) => /^HOST FOCUS /.test(note));
  check('a held key is one press', moves.join() === 'HOST FOCUS b0', `${moves.length} focus moves, ${repeats} firmware repeats in 2 s`);
  check('the release is reported', notes.slice(held).filter((note) => note === 'HOST RELEASE ArrowLeft').length === 1);
  held = notes.length;
  await keypress(device, 'Right');
  await waitFor(/^HOST FOCUS b1/, 5000, held);

  await keypress(device, 'Select');
  check('Select activates', (await waitFor(/^HOST SELECT b1/, 5000)) !== undefined);
  await sleep(700);
  image = await shoot('modal');
  check('modal is on screen', isBlue(at(image, MODAL)), `${at(image, MODAL)}`);

  await keypress(device, 'Play');
  check('Play reaches onPlayPause through rokuKeyMap', (await waitFor(/^HOST KEY PlayPause/, 5000)) !== undefined);

  // ---- Back ----
  await keypress(device, 'Back');
  const consumed = await waitFor(/^HOST BACK consumed/, 5000);
  await sleep(1500);
  const afterModal = await activeApp(device);
  check('Back inside the modal is consumed', consumed !== undefined && afterModal === 'dev', `active app ${afterModal}`);

  // ---- text entry on the device keyboard ----
  await keypress(device, 'Right');
  await waitFor(/^HOST FOCUS b2/, 5000);
  let mark = notes.length;
  await keypress(device, 'Select');
  check('the editor opens the device keyboard', (await waitFor(/^HOST EDITOR open/, 5000, mark)) !== undefined);
  await sleep(2000);
  await keypress(device, ['Lit_a', 'Lit_b'], 400);
  check('typing reaches onChange', (await waitFor(/^HOST EDITOR change ab$/, 5000, mark)) !== undefined, line(/^HOST EDITOR change /, mark));
  // Not saved: the dialog shows a pairing code for the owner's phone.
  image = decodeImage(await screenshot(device));
  check('the keyboard dialog is on screen', !isGrey(at(image, BUTTONS[0])) && !isGrey(at(image, BUTTONS[1])), `b0 ${at(image, BUTTONS[0])} b1 ${at(image, BUTTONS[1])}`);
  // Below the keys are the dialog's two buttons: down to the last (Cancel),
  // up one to the first, which confirms.
  await keypress(device, ['Down', 'Down', 'Down', 'Down', 'Down', 'Down', 'Up'], 300);
  await keypress(device, 'Select');
  const submitted = await waitFor(/^HOST EDITOR submit /, 5000, mark);
  if (!submitted) await keypress(device, 'Back');
  check('confirming submits the text', submitted === 'HOST EDITOR submit ab', submitted ?? notes.slice(mark).filter((note) => /EDITOR/.test(note)).join(' | '));
  check('the editor closes', (await waitFor(/^HOST EDITOR closed/, 5000, mark)) !== undefined);
  await sleep(1500);
  check('the app is still in front after text entry', (await activeApp(device)) === 'dev');
  // The dialog takes the remote: the release of the Select that opened it
  // never reaches the app, and the release of the key that closed it does.
  // Neither may show: the next Select is a fresh press, and the app sees no
  // release of a key it was not given.
  mark = notes.length;
  await keypress(device, 'Select');
  await waitFor(/^HOST EDITOR open/, 5000, mark);
  await sleep(2000);
  await keypress(device, 'Back');
  check('Back in the keyboard cancels it', (await waitFor(/^HOST EDITOR closed/, 5000, mark)) !== undefined);
  await sleep(1500);
  await keypress(device, 'Select');
  const reopened = await waitFor(/^HOST EDITOR open/, 5000, notes.indexOf('HOST EDITOR closed', mark));
  await sleep(2000);
  await keypress(device, 'Back');
  await waitFor(/^HOST EDITOR closed/, 5000, notes.lastIndexOf('HOST EDITOR open'));
  await sleep(1500);
  const stray = notes.slice(mark).filter((note) => /^HOST (REPEAT|RELEASE) /.test(note));
  check('no false repeat and no stray release around the keyboard', reopened !== undefined && stray.length === 0, stray.join(' | '));
  check('the app is still in front', (await activeApp(device)) === 'dev');

  const rootExit = await exitAtRoot();
  check('Back at the root exits the channel', rootExit.ok, rootExit.detail);

  // ---- relaunch with a deep link ----
  let from = notes.length;
  await launch(device, 'dev', { contentId: 'host-42', mediaType: 'movie' });
  const again = await waitFor(/^HOST (READY|ERROR)/, 90_000, from);
  const initial = line(/^HOST LINK initial /, from);
  check('launch deep link reaches the links service', /^HOST READY/.test(again ?? '') && /^HOST LINK initial roku:\/\/deeplink\?/.test(initial) && initial.includes('contentId=host-42') && initial.includes('mediaType=movie'), initial);
  const before = line(/^HOST SETTINGS before=/, from);
  check('settings survive a relaunch', wrote !== undefined && before === 'HOST SETTINGS before=' + wrote, before);
  check('secure storage survives a relaunch', line(/^HOST SECURE before=/, from) === 'HOST SECURE before=host-secret-' + wrote, line(/^HOST SECURE before=/, from));

  await sendInput(device, { contentId: 'host-43', mediaType: 'episode' });
  const event = await waitFor(/^HOST LINK event .*contentId=host-43/, 8000, from);
  check('running deep link reaches the links service', event !== undefined && event.includes('mediaType=episode'), event ?? 'no event');

  // ---- idle ----
  await sleep(1500);
  await sendInput(device, { contentId: 'idle-check', mediaType: 'movie' });
  const idle = await waitFor(/^HOST IDLE timers=/, 8000, from);
  check('nothing scheduled in 2 s once settled', idle === 'HOST IDLE timers=0', idle ?? 'no idle report');

  // ---- suspend and resume (the manifest opts in to Instant Resume) ----
  if (previous && previous !== 'dev') {
    mark = notes.length;
    await launch(device, previous);
    check('leaving the app suspends it', (await waitFor(/^HOST LIFECYCLE event active=false/, 15_000, mark)) !== undefined);
    await sleep(3000);
    await launch(device, 'dev', { contentId: 'host-44', mediaType: 'movie' });
    const resumed = await waitFor(/^HOST LIFECYCLE event active=true/, 20_000, mark);
    check('coming back resumes the same app', resumed !== undefined && line(/^HOST START/, mark) === '', resumed ?? line(/^HOST START/, mark));
    const link = await waitFor(/^HOST LINK event .*contentId=host-44/, 5000, mark);
    check('a deep link that resumes the app reaches the links service', link !== undefined && notes.slice(mark).filter((note) => /^HOST LINK event .*contentId=host-44/.test(note)).length === 1, link ?? 'no event');
    await sleep(1500);
    check('the app is in front again', (await activeApp(device)) === 'dev');
  }

  // ---- an app that throws while starting ----
  const againExit = await exitAtRoot();
  check('Back at the root exits again', againExit.ok, againExit.detail);
  from = notes.length;
  await launch(device, 'dev', { contentId: 'boot-error', mediaType: 'movie' });
  const failure = await waitFor(/^ROKU_BOOT_ERROR .*deliberate boot error/, 30_000, from);
  check(
    'boot error is on the console',
    failure !== undefined,
    failure ? '' : 'the throw did not reach the host; start ' + (line(/^HOST START/, from) ? 'ran' : 'did not run'),
  );
  await sleep(2000);
  image = await shoot('boot-error');
  const corner = pixel(image, 1800, 1000);
  let ink = 0;
  for (let y = 110; y < 200; y++) for (let x = 110; x < 900; x++) if (pixel(image, x, y)[1] > 150) ink++;
  check('boot error screen is drawn', corner[0] > 50 && corner[1] < 40 && corner[2] < 40 && ink > 300, `corner ${corner}, ${ink} px of text`);
  check('app is still up showing the error', (await activeApp(device)) === 'dev');
} finally {
  reading.stop();
  if (!args.includes('--keep') && previous && previous !== 'dev')
    await launch(device, previous).catch(() => {});
}

// The device takes a moment to report the app it switched to.
if (!args.includes('--keep')) await sleep(3000);
const failed = results.filter((ok) => !ok).length;
say(`HOST RESULT passed=${results.length - failed} failed=${failed}`);
say(`Restored: ${args.includes('--keep') ? 'no (--keep)' : (await activeApp(device)) === previous ? 'yes' : 'NO'}`);
if (target) writeFileSync(target + '-result.txt', output.concat(notes).join('\n') + '\n');
process.exit(failed ? 1 : 0);
