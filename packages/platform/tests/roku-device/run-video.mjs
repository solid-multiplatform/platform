// The device test of the Roku video adapter. Serves a clip over the LAN,
// installs tests/roku-device/video-app.tsx, and drives it with launch
// parameters and the remote: open paused at a start position, play, pause,
// resume, seek forward, end, an unreachable URL (error mapping), an opaque bar
// over the player, and teardown with a timer count. Exits non-zero on a
// failed probe and restores the app that was active before.
//
//   node tests/roku-device/run-video.mjs [--out results/video] [--keep]
//
// `--out` writes <out>-result.txt and <out>-<step>.jpg.
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeApp,
  deviceInfo,
  keypress,
  launch,
  readConsole,
  rokuDevice,
  screenshot,
  sideload,
} from '../../cli/roku-device.mjs';
import { decodeImage, imageKind, sample } from './image.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('../../examples/roku/', import.meta.url));
const out = path.join(project, 'dist-video');
const zip = path.join(out, 'video.zip');
const clip = path.join(here, '../cli/media/clip.mp4');
const evidence = '/mnt/ALPH/code/solid-multiplatform/handoff/roku-video';
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- a LAN the TV can reach, without naming the machine --------------------

// The address on the same subnet as the TV (so it can reach us), else the
// interface the default route uses. Never printed as evidence.
function lanAddress() {
  const prefix = (process.env.ROKU_DEV_IP ?? '').split('.').slice(0, 3).join('.');
  if (prefix) {
    for (const list of Object.values(os.networkInterfaces()))
      for (const address of list ?? [])
        if (
          address.family === 'IPv4' &&
          !address.internal &&
          address.address.startsWith(prefix + '.')
        )
          return Promise.resolve(address.address);
  }
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.connect(9, '8.8.8.8', () => {
      const address = socket.address().address;
      socket.close();
      resolve(address);
    });
  });
}

const clipSize = statSync(clip).size;
const server = http.createServer((request, response) => {
  // The path and range only: the runner's output carries no address.
  console.log(`REQ ${request.method} ${request.url} range=${request.headers.range ?? '-'}`);
  if (request.url === '/missing.mp4') {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('missing');
    return;
  }
  if (request.url !== '/clip.mp4') {
    response.writeHead(404);
    response.end();
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : clipSize - 1;
    response.writeHead(206, {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${clipSize}`,
      'content-length': end - start + 1,
    });
    createReadStream(clip, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'content-length': clipSize,
  });
  createReadStream(clip).pipe(response);
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const lan = await lanAddress();
const clipUrl = `http://${lan}:${port}/clip.mp4`;

// A port nothing listens on: the TV connects and is refused.
const closed = http.createServer();
await new Promise((resolve) => closed.listen(0, '0.0.0.0', resolve));
const closedPort = closed.address().port;
await new Promise((resolve) => closed.close(resolve));
const unreachableUrl = `http://${lan}:${closedPort}/clip.mp4`;

// ---- build, install, read the console --------------------------------------

const device = rokuDevice();
const output = [];
const results = [];
const say = (line) => {
  output.push(line);
  console.log(line);
};
const check = (what, ok, detail = '') => {
  results.push({ what, ok });
  say(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`);
};

let previous;
let reading;
try {
  const info = await deviceInfo(device);
  if (!info.developerEnabled)
    throw new Error('Developer mode is off on this Roku.');
  say(`Roku ${info.model}, OS ${info.softwareVersion}, ${info.uiResolution}`);
  previous = await activeApp(device);

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
      'video.roku-config.ts',
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

  const notes = [];
  const waiters = [];
  let fresh = false;
  reading = readConsole(
    device,
    (line) => {
      // On connecting, the console replays what the last app printed.
      if (!fresh) return false;
      const at = line.search(/VIDEO |ROKU_VIDEO /);
      if (at === -1) return false;
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
  const waitFor = (test, ms = 20_000, from = 0) => {
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
  };
  const states = (from = 0) =>
    notes
      .slice(from)
      .map((note) => /^VIDEO STATE (\w+) position=([\d.]+) duration=(\S+)/.exec(note))
      .filter(Boolean)
      .map((match) => ({
        state: match[1],
        position: Number(match[2]),
        duration: match[3] === 'null' ? null : Number(match[3]),
      }));
  const lastState = (from = 0) => states(from).at(-1);

  async function openWith(params) {
    const from = notes.length;
    await launch(device, 'dev', {
      contentId: 'video',
      mediaType: 'movie',
      ...params,
    });
    const ready = await waitFor(/^VIDEO READY/, 25_000, from);
    return { from, ready };
  }

  function writeShot(name, data) {
    mkdirSync(evidence, { recursive: true });
    const file = path.join(evidence, name + '.' + imageKind(data));
    writeFileSync(file, data);
    return file;
  }

  // ---- case 1: open paused at a start position ---------------------------
  await sleep(1500);
  fresh = true;
  await sideload(device, zip);
  await sleep(1000);
  let mark = await openWith({ url: clipUrl, mode: 'paused', start: '3' });
  const opened = await waitFor(/^VIDEO OPENED/, 25_000, mark.from);
  check('app starts and opens the clip', opened !== undefined, opened ?? 'no OPENED');
  const paused = await waitFor(
    /^VIDEO STATE paused position=[\d.]+/,
    15_000,
    mark.from,
  );
  check('opens paused', paused !== undefined, paused ?? 'no paused state');
  const pausedState = lastState(mark.from);
  check(
    'opens at the requested start position',
    pausedState !== undefined && Math.abs(pausedState.position - 3) <= 1.25,
    JSON.stringify(pausedState),
  );
  const shot = await screenshot(device);
  const image = decodeImage(shot);
  const center = sample(image, 960, 540);
  const colourful =
    Math.max(...center) - Math.min(...center) > 30 && Math.max(...center) > 40;
  check('a video frame is visible while paused', colourful, 'center=' + center);
  say('Screenshot: ' + writeShot('2026-11-18-video-paused', shot));

  // ---- case 2: the Video node is below the app's UI ----------------------
  await keypress(device, 'Select');
  const covered = await waitFor(/^VIDEO COVER on/, 8000, mark.from);
  await sleep(400);
  const coverShot = await screenshot(device);
  const cover = sample(decodeImage(coverShot), 960, 540);
  check(
    'an opaque UI bar covers the player',
    covered !== undefined && cover[0] > 170 && cover[1] < 90 && cover[2] < 90,
    'center=' + cover,
  );
  say('Screenshot: ' + writeShot('2026-11-18-video-covered', coverShot));
  await keypress(device, 'Select');
  await waitFor(/^VIDEO COVER off/, 8000, mark.from);

  // ---- case 3: play, then pause and resume ------------------------------
  await keypress(device, 'Play');
  const playing = await waitFor(/^VIDEO STATE playing/, 12_000, mark.from);
  check('play starts the video', playing !== undefined, playing ?? 'no playing state');
  await sleep(2500);
  const advanced = lastState(mark.from);
  check(
    'position advances while playing',
    advanced !== undefined &&
      advanced.state === 'playing' &&
      advanced.position >= 4.25,
    JSON.stringify(advanced),
  );
  await keypress(device, 'Pause');
  const pausedAgain = await waitFor(/^VIDEO STATE paused/, 8000, mark.from);
  check('pause stops playback', pausedAgain !== undefined, pausedAgain ?? 'no paused state');
  await sleep(500);
  const held = lastState(mark.from);
  const still = await sleep(900).then(() => lastState(mark.from));
  check(
    'position holds while paused',
    held !== undefined && still !== undefined && Math.abs(still.position - held.position) < 0.5,
    `${held?.position} -> ${still?.position}`,
  );
  await keypress(device, 'Play');
  const resumed = await waitFor(/^VIDEO STATE playing/, 8000, mark.from);
  check('resume plays again', resumed !== undefined, resumed ?? 'no playing state');

  // ---- case 4: seek forward with Fwd ------------------------------------
  await keypress(device, 'Pause');
  await waitFor(/^VIDEO STATE paused/, 8000, mark.from);
  const beforeSeek = lastState(mark.from);
  const seekFrom = notes.length;
  await keypress(device, 'Fwd');
  await sleep(1200);
  const afterSeek = lastState(seekFrom) ?? lastState(mark.from);
  check(
    'Fwd seeks forward',
    beforeSeek !== undefined &&
      afterSeek !== undefined &&
      afterSeek.position > beforeSeek.position + 0.5,
    `${beforeSeek?.position} -> ${afterSeek?.position}`,
  );

  // ---- case 5: play to the end ------------------------------------------
  await keypress(device, 'Play');
  const ended = await waitFor(/^VIDEO STATE ended/, 15000, seekFrom);
  check('the clip ends', ended !== undefined, ended ?? 'no ended state');
  const endShot = await screenshot(device);
  say('Screenshot: ' + writeShot('2026-11-18-video-ended', endShot));

  // ---- case 6: an unreachable URL is mapped to an adapter error ---------
  mark = await openWith({ url: unreachableUrl, mode: 'paused', start: '0' });
  const failed = waitFor(
    /^VIDEO (OPEN_FAILED|STATE error)/,
    25_000,
    mark.from,
  );
  await failed;
  const failureLine =
    notes.slice(mark.from).find((note) => /^VIDEO (OPEN_FAILED|STATE error)/.test(note)) ?? '';
  check(
    'an unreachable URL fails with a mapped error',
    /connection-failed|expired-source|prepare-failed/.test(failureLine),
    failureLine,
  );
  check(
    'the error carries the firmware code and message',
    /firmware=\{"firmwareCode":\d+/.test(failureLine) &&
      /"firmwareMessage":"[^"]+"/.test(failureLine),
    failureLine,
  );

  // ---- case 7: teardown leaves no timers --------------------------------
  mark = await openWith({ url: clipUrl, mode: 'paused', start: '0' });
  await waitFor(/^VIDEO STATE paused/, 20_000, mark.from);
  await keypress(device, 'Info');
  const teardown = await waitFor(/^VIDEO TEARDOWN pending=/, 10_000, mark.from);
  const pending = /pending=(\d+)/.exec(teardown ?? '')?.[1];
  check(
    'teardown leaves no pending timer',
    pending === '0',
    teardown ?? 'no TEARDOWN line',
  );

  const passed = results.filter((result) => result.ok).length;
  say(`VIDEO RESULT passed=${passed} failed=${results.length - passed}`);
} catch (error) {
  say('VIDEO ERROR ' + (error instanceof Error ? error.message : String(error)));
  results.push({ what: 'device run', ok: false });
} finally {
  reading?.stop();
  await new Promise((resolve) => server.close(resolve));
  if (!args.includes('--keep')) {
    if (previous && previous !== 'dev')
      await launch(device, previous).catch(() => {});
    else if (!previous)
      // Nothing was active: leave the TV on its home screen, not the test app.
      await keypress(device, 'Home').catch(() => {});
  }
  const target = flag('--out');
  if (target) {
    mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    writeFileSync(
      target.replace(/\.txt$/i, '') + '-result.txt',
      output.join('\n') + '\n',
    );
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}
