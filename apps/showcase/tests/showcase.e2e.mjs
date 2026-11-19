// The showcase in headless Chromium, on real WebGL (SwiftShader), built as
// `vite build` leaves it:
//
//   (a) a real keyboard and a real mouse go home -> gallery -> services, and
//       the ARIA mirror names the focused control at every step;
//   (b) `?probe=1` reports every service and every UI assertion;
//   (c) once settled, no frame is requested for two seconds.
//
//   node tests/showcase.e2e.mjs dist/web          (SHOWCASE_SCREENSHOTS=<dir> keeps pictures)
//   node tests/showcase.e2e.mjs dist/tizen tizen  a browser-TV bundle: (b) and (c) only.
//
// A browser-TV bundle runs here in desktop Chromium, which says its bundle
// starts and probes on the TV host; it is not evidence from a television.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2] ?? 'dist/web');
const target = process.argv[3] ?? 'web';
const shots = process.env.SHOWCASE_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// What `webHost` installs: webServices (the device, media and sensors
// manifests in packages/platform/src/hosts/web-services) plus
// webAppServices(namespace) without a service worker, which adds `settings`.
const WEB_SERVICES = [
  // device.manifest.ts
  'clipboard',
  'share',
  'openExternal',
  'orientation',
  'keepAwake',
  'notifications',
  'memory',
  'systemBars',
  'locale',
  'colorScheme',
  'keyEvents',
  'haptics',
  'deviceInfo',
  'battery',
  'lifecycle',
  'connectivity',
  'links',
  'request',
  // media.manifest.ts
  'audio',
  'fullscreen',
  'filePicker',
  'download',
  'camera',
  'microphone',
  'mediaSession',
  'thumbnails',
  'mediaCapabilities',
  // sensors.manifest.ts
  'geolocation',
  'sensors',
  // webAppServices
  'settings',
].sort();

// Installed on the web and not `ok` in an unattended run, each with the
// reason. Anything else that is installed must report `ok`.
const EXPECTED = {
  // Headless Chromium refuses the screen wake lock ("Wake Lock permission
  // request denied"): there is no screen to keep awake.
  keepAwake: ['denied', 'headless Chromium denies the screen wake lock'],
  share: ['unverified', 'opens the system share sheet'],
  openExternal: ['unverified', 'opens another application'],
  orientation: ['unverified', 'rotates the screen'],
  notifications: ['unverified', 'asks for permission and shows a notification'],
  haptics: ['unverified', 'only a person can feel a vibration'],
  audio: ['unverified', 'plays sound'],
  fullscreen: ['unverified', 'changes the window and needs a user gesture'],
  filePicker: ['unverified', 'opens the file picker'],
  download: ['unverified', 'saves a file'],
  camera: ['unverified', 'asks for the camera'],
  microphone: ['unverified', 'asks for the microphone'],
  mediaSession: ['unverified', 'changes the system media controls'],
  thumbnails: ['unverified', 'needs a video to decode'],
  geolocation: ['unverified', 'asks for the location permission'],
};

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(file);
    response
      .writeHead(200, {
        'Content-Type':
          contentTypes[path.extname(file)] || 'application/octet-stream',
      })
      .end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The scene's layout, from apps/showcase/src/ui.tsx and screens/Home.tsx, at
// 1280 by 720 (four tiles to a row): where the mouse has to go.
const MARGIN = 32;
const backButton = { x: MARGIN + 80, y: 76 + 24 };
const homeTile = (index) => ({
  x: MARGIN + (index % 4) * (280 + 16) + 140,
  y: 110 + Math.floor(index / 4) * (110 + 16) + 55,
});
const SECTIONS = [
  'Layout',
  'Text',
  'Images',
  'Effects',
  'States',
  'Transitions',
  'Row, Column, Grid',
  'Virtual list',
  'Dialogs',
  'Controls',
  'Services',
  'Diagnostics',
];

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    // What a person grants with one click: without it the clipboard probe
    // reports `denied`, which is true of an unattended browser but says
    // nothing about the service.
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Before the app starts: count every animation frame the page runs.
  await context.addInitScript(() => {
    window.__frames = 0;
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      request((time) => {
        window.__frames++;
        callback(time);
      });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  return { page, errors };
}

/** The accessible name of what the browser has focused: the mirror's item. */
const focusedName = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body
      ? `${el.getAttribute('role')}:${el.getAttribute('aria-label')}`
      : null;
  });

async function expectFocus(page, expected, what) {
  const matches = (name) =>
    name !== null &&
    (expected instanceof RegExp ? expected.test(name) : name === expected);
  let name;
  for (let attempt = 0; attempt < 100; attempt++) {
    name = await focusedName(page);
    if (matches(name)) return name;
    await sleep(50);
  }
  assert.fail(`${what}: focus is on ${name}, expected ${expected}`);
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, name + '.png') });
}

const frames = (page) => page.evaluate(() => window.__frames);

/** Waits until no frame has run for `rounds` tenths of a second. */
async function settle(page, where, rounds = 5) {
  let last = await frames(page);
  let quiet = 0;
  for (let attempt = 0; attempt < 100 && quiet < rounds; attempt++) {
    await sleep(100);
    const now = await frames(page);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  assert.equal(quiet, rounds, `${where}: the scene never settled`);
}

/**
 * A real mouse click, once the scene has drawn what the last keys changed.
 *
 * Without the wait, a click on Back sent some tens of milliseconds after the
 * Controls screen opened (straight after two key presses) activated the
 * column's last row instead, in 3 runs of 25; with 300 ms before the click,
 * in none of 25. The cause is not established (see the README's known gaps).
 */
async function click(page, point, where) {
  await settle(page, where, 2);
  await page.mouse.click(point.x, point.y);
}

/** (c) Waits for the scene to settle, then requires two seconds without a frame. */
async function expectIdle(page, where) {
  await settle(page, where);
  const before = await frames(page);
  // The count is the app's: it drew to get here, so zero would mean the
  // instrumentation sees nothing and the check below proves nothing.
  assert.ok(before > 0, `${where}: no frame was ever counted`);
  await sleep(2000);
  const after = await frames(page);
  assert.equal(
    after - before,
    0,
    `${where}: ${after - before} frames ran in 2 s of idle`,
  );
}

async function interactive(browser) {
  const { page, errors } = await newPage(browser);
  await page.goto(origin);
  await page.waitForSelector('canvas');
  // Every section is a button named by its text, with no code in the app.
  for (const name of SECTIONS)
    await page
      .getByRole('button', { name, exact: true })
      .waitFor({ state: 'attached', timeout: 5000 });

  // Keyboard on the home grid.
  await expectFocus(page, 'button:Layout', 'home autofocus');
  await shot(page, '1-home');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'button:Text', 'Right');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'button:Layout', 'Left');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'button:Controls', 'Down, Down, Right');

  // Gallery: the controls screen, by keyboard.
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Back', 'controls screen');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'checkbox:Subtitles', 'Down to the checkbox');
  const checkbox = page.getByRole('checkbox', { name: 'Subtitles' });
  assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-checked') === 'false' &&
      document.activeElement?.getAttribute('aria-label') === 'Subtitles',
    undefined,
    { polling: 50, timeout: 3000 },
  );
  await shot(page, '2-controls');

  // The mouse: Back, then the Services tile. Focus returns to the tile left.
  await click(page, backButton, 'before the click on Back');
  await expectFocus(page, 'button:Controls', 'mouse click on Back');
  const services = homeTile(SECTIONS.indexOf('Services'));
  await click(page, services, 'before the click on the Services tile');
  await expectFocus(page, 'button:Back', 'mouse click on the Services tile');
  await page
    .getByRole('button', { name: 'Run every unattended probe' })
    .waitFor({ state: 'attached', timeout: 3000 });

  // Services by keyboard: the rows are named by service and state.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:appReview: unavailable', 'first row');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:battery: Enter to run', 'third row');
  await page.keyboard.press('Enter');
  await expectFocus(page, /^button:battery: ok/, 'battery probe by Enter');
  await shot(page, '3-services');

  await expectIdle(page, 'services screen');

  // Back key: home again, on the tile it left.
  await page.keyboard.press('Backspace');
  await expectFocus(page, 'button:Services', 'Back key');
  await expectIdle(page, 'home screen');

  // (c) on every screen: opened by mouse, left alone, closed by the Back key.
  for (const [index, name] of SECTIONS.entries()) {
    await click(page, homeTile(index), `before the click on ${name}`);
    await expectFocus(page, 'button:Back', `mouse click on ${name}`);
    await expectIdle(page, `${name} screen`);
    await page.keyboard.press('Backspace');
    await expectFocus(page, `button:${name}`, `Back from ${name}`);
  }

  assert.deepEqual(errors, [], 'page errors');
  await page.context().close();
  console.log(
    'ok  keyboard, mouse and the ARIA mirror: home, gallery, services',
  );
  console.log(
    `ok  idle: no frame in 2 s on home and each of ${SECTIONS.length} screens`,
  );
}

async function probe(browser) {
  const { page, errors } = await newPage(browser);
  let marker;
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('SHOWCASE_RESULT '))
      marker = JSON.parse(text.slice('SHOWCASE_RESULT '.length));
  });
  await page.goto(origin + '/?probe=1');
  await page.waitForFunction(
    () => window.__showcaseResult !== undefined,
    undefined,
    {
      polling: 100,
      timeout: 60000,
    },
  );
  const result = await page.evaluate(() => window.__showcaseResult);
  await shot(page, '4-probe');
  console.log(JSON.stringify(result, null, 2));

  // One document, the same through both channels.
  assert.deepEqual(marker, result, 'console marker and window result differ');
  assert.equal(result.target, target);
  assert.equal(result.capabilities.target, target);

  // The registry: what is installed is what the manifests say, and the table
  // has a row for all of it.
  assert.deepEqual(result.installedServices, WEB_SERVICES);
  for (const name of result.installedServices)
    assert.ok(name in result.services, `${name} is missing from the table`);

  const lines = [];
  for (const [name, outcome] of Object.entries(result.services)) {
    const installed = WEB_SERVICES.includes(name);
    const expected = !installed ? 'unavailable' : (EXPECTED[name]?.[0] ?? 'ok');
    assert.equal(
      outcome.status,
      expected,
      `${name}: ${outcome.status} ${outcome.detail ?? ''}`,
    );
    lines.push(`${name}=${outcome.status}`);
  }
  for (const name of Object.keys(EXPECTED))
    assert.ok(WEB_SERVICES.includes(name), `${name}: stale exception`);

  assert.deepEqual(Object.keys(result.ui).sort(), [
    'focusMovesWithKeys',
    'modalTrapsFocus',
    'virtualListScrolls',
  ]);
  for (const [name, outcome] of Object.entries(result.ui))
    assert.equal(outcome.status, 'ok', `${name}: ${outcome.detail}`);

  await expectIdle(page, 'after the probe');
  assert.deepEqual(errors, [], 'page errors');
  await page.context().close();
  console.log('ok  probe: ' + lines.join(' '));
  console.log('ok  probe UI: ' + Object.keys(result.ui).join(', '));
  console.log('ok  idle: no frame in 2 s after the probe');
}

let browser;
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  // The mouse path is laid out for the web host, where scene units are CSS
  // pixels; a TV host scales a fixed stage, and mirrors no ARIA by default.
  if (target === 'web') await interactive(browser);
  await probe(browser);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
