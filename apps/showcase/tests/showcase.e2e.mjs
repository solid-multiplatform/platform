// The showcase in headless Chromium, Firefox and WebKit, on real WebGL,
// built as `vite build` leaves it:
//
//   (a) a real keyboard and a real mouse go home -> gallery -> services, and
//       the ARIA mirror names the focused control at every step;
//   (b) `?probe=1` reports every service and every UI assertion;
//   (c) once settled, no frame is requested for two seconds.
//
//   node tests/showcase.e2e.mjs dist/web [web] [chromium|firefox|webkit]
//   node tests/showcase.e2e.mjs dist/tizen tizen [engine]
//                                              (SHOWCASE_SCREENSHOTS=<dir> keeps pictures)
//
// A browser-TV bundle runs here in a desktop browser, which says its bundle
// starts and probes on the TV host; it is not evidence from a television.
// Chromium is the default engine. The fourth argument (or SHOWCASE_BROWSER)
// picks the engine, so CI can run the same walk on all three.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(process.argv[2] ?? 'dist/web');
const target = process.argv[3] ?? 'web';
const engine = process.argv[4] ?? process.env.SHOWCASE_BROWSER ?? 'chromium';
const engines = { chromium, firefox, webkit };
if (!engines[engine])
  throw new Error(
    `unknown engine ${engine}; expected chromium, firefox or webkit`,
  );
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

// Browser policy, not the service: Chromium is granted the clipboard through
// the context above; an unattended Firefox needs user activation to write it,
// and an unattended WebKit needs a permission nobody can click. Both refuse.
const EXPECTED_BY_ENGINE = {
  chromium: {
    // Headless Chromium refuses the screen wake lock ("Wake Lock
    // permission request denied"): there is no screen to keep awake.
    keepAwake: ['denied', 'headless Chromium denies the screen wake lock'],
  },
  firefox: {
    clipboard: [
      'denied',
      'Firefox needs user activation to write the clipboard',
    ],
  },
  webkit: {
    keepAwake: ['denied', 'headless WebKit denies the screen wake lock'],
    clipboard: [
      'denied',
      'WebKit needs the clipboard permission, which nobody can grant here',
    ],
  },
};

// Installed on the web and not `ok` in an unattended run, each with the
// reason. Anything else that is installed must report `ok`.
const EXPECTED = {
  ...EXPECTED_BY_ENGINE[engine],
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
    // nothing about the service. Playwright grants these two in Chromium
    // only; Firefox and WebKit ignore the grant and probe the clipboard on
    // their own terms.
    ...(engine === 'chromium'
      ? { permissions: ['clipboard-read', 'clipboard-write'] }
      : {}),
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
  // A shape whose shader the host did not register draws nothing and says
  // so: rounded corners, borders and gradients (the Effects screen) must not.
  page.on('console', (message) => {
    if (/Shader type .* is not registered/.test(message.text()))
      errors.push(new Error(message.text()));
  });
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

/** The screen's result line, which the ARIA mirror carries as a status. */
async function expectStatus(page, expected, what) {
  let lines;
  for (let attempt = 0; attempt < 60; attempt++) {
    lines = await page.evaluate(() =>
      [...document.querySelectorAll('[role="status"]')].map((el) =>
        el.getAttribute('aria-label'),
      ),
    );
    if (lines.some((line) => expected.test(line ?? ''))) return;
    await sleep(50);
  }
  assert.fail(`${what}: status is ${JSON.stringify(lines)}, expected ${expected}`);
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

/** A real mouse click, sent at once: the scene is not waited for. */
async function click(page, point) {
  await page.mouse.click(point.x, point.y);
}

/**
 * A click on Back sent the moment the Controls screen opens. A screen's
 * column places its rows once its text lines have been measured, a frame or
 * more after it mounts; until then every row is at the column's origin, and
 * the click used to activate the last one (the text field). Now it either
 * arrives before the rows are placed and does nothing, or lands on Back:
 * never on another row.
 */
async function clickBackWhileOpening(page) {
  await expectFocus(page, 'button:Controls', 'home, on the Controls tile');
  await page.keyboard.press('Enter');
  await page.mouse.click(backButton.x, backButton.y);
  await sleep(300);
  // A click that reached no node leaves the browser's focus on the page
  // body (null here): the scene's focus has not moved from Back.
  const name = await focusedName(page);
  assert.ok(
    name === null || name === 'button:Back' || name === 'button:Controls',
    `a click while the screen opened put focus on ${name}`,
  );
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('input').length),
    0,
    'a click while the screen opened started the text field',
  );
  if (name === 'button:Controls') return 'back';
  await page.mouse.click(backButton.x, backButton.y);
  await expectFocus(page, 'button:Controls', 'the click on Back');
  return 'none';
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

  // Select and Menu with the keyboard only: Enter opens on the current
  // choice, arrows move, Enter chooses and focus returns to the opener.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:Language', 'Down to the select');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'menuitem:English', 'the select opens on its value');
  await shot(page, '2a-select');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'menuitem:French', 'Down in the select');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Language', 'focus returns to the select');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute('aria-valuetext'),
    ),
    'French',
  );
  await expectStatus(page, /, fr\. Last: nothing yet$/, 'select result');
  // Back closes the select and keeps the value.
  await page.keyboard.press('Enter');
  await expectFocus(page, 'menuitem:French', 'the select reopens on French');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expectFocus(page, 'button:Language', 'Back closes the select');
  await expectStatus(page, /, fr\. Last: nothing yet$/, 'select after Back');

  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:Open menu', 'Down to the menu button');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'menuitem:Rename', 'the menu opens on its first item');
  await shot(page, '2b-menu');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'menuitem:Share', 'Down in the menu');
  // Delete is disabled: Down stays on Share.
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'menuitem:Share', 'Down at the last enabled item');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Open menu', 'focus returns to the opener');
  await expectStatus(page, /Last: menu: Share$/, 'menu result');

  // The text field: the browser's own input while it is open; when it
  // closes, the browser's focus is back on the button that opened it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:Text field: empty', 'Down to the text field');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.tagName === 'INPUT',
    undefined,
    { polling: 50, timeout: 3000 },
  );
  await page.keyboard.type('ab');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Text field: ab', 'the text field closed');

  // The mouse: Back, then the Services tile. Focus returns to the tile left.
  await click(page, backButton);
  await expectFocus(page, 'button:Controls', 'mouse click on Back');
  const early = [];
  for (let i = 0; i < 5; i++) early.push(await clickBackWhileOpening(page));
  console.log(`ok  clicks on Back while Controls opened: ${early.join(', ')}`);
  const services = homeTile(SECTIONS.indexOf('Services'));
  await click(page, services);
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

  // Alert and DatePicker with the keyboard only.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'button:Dialogs', 'Left, Left');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Back', 'dialogs screen');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:Open alert', 'Down to the alert button');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:OK', 'the alert opens on its confirm action');
  await shot(page, '3a-alert');
  await page.keyboard.press('ArrowLeft');
  await expectFocus(page, 'button:Cancel', 'Left in the alert');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'button:OK', 'Right in the alert');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Open alert', 'focus returns from the alert');
  await expectStatus(page, /^Last result: alert: confirmed$/, 'alert result');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:OK', 'the alert opens again');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Open alert', 'focus returns from Cancel');
  await expectStatus(page, /^Last result: alert: cancelled$/, 'alert cancel');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectFocus(page, 'button:Pick a date', 'Down to the date button');
  await page.keyboard.press('Enter');
  // The picker opens on today; Right is tomorrow, in the next month if today
  // is the last day of this one.
  const { today, tomorrow, result } = await page.evaluate(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      today: now.getDate(),
      tomorrow: next.getDate(),
      result: `${next.getFullYear()}-${next.getMonth() + 1}-${next.getDate()}`,
    };
  });
  await expectFocus(page, `button:${today}`, 'the picker opens on today');
  await shot(page, '3b-date');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, `button:${tomorrow}`, 'Right in the calendar');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-selected') === 'true',
    undefined,
    { polling: 50, timeout: 3000 },
  );
  // Down the weeks, then past the last one to the actions: Done.
  for (let i = 0; i < 6; i++) {
    if ((await focusedName(page)) === 'button:Done') break;
    await page.keyboard.press('ArrowDown');
    await sleep(100);
  }
  await expectFocus(page, 'button:Done', 'Down to the actions');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expectFocus(page, 'button:Previous month', 'Up to the month row');
  await page.keyboard.press('ArrowRight');
  await expectFocus(page, 'button:Next month', 'Right in the month row');
  for (let i = 0; i < 8; i++) {
    if ((await focusedName(page)) === 'button:Done') break;
    await page.keyboard.press('ArrowDown');
    await sleep(100);
  }
  await expectFocus(page, 'button:Done', 'Down to the actions again');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'button:Pick a date', 'focus returns from the picker');
  await expectStatus(
    page,
    new RegExp(`^Last result: date: ${result}$`),
    'date result',
  );
  await page.keyboard.press('Backspace');
  await expectFocus(page, 'button:Dialogs', 'Back from the dialogs screen');

  // (c) on every screen: opened by mouse, left alone, closed by the Back key.
  for (const [index, name] of SECTIONS.entries()) {
    await click(page, homeTile(index));
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
  // Headless Chromium has no GPU: run WebGL on SwiftShader. Firefox and
  // WebKit draw in software themselves and reject Chromium's switches. A CI
  // runner has no GPU either, and Firefox refuses WebGL there unless told
  // otherwise, so allow software WebGL explicitly for it.
  browser = await engines[engine].launch(
    engine === 'chromium'
      ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
      : engine === 'firefox'
        ? {
            firefoxUserPrefs: {
              'webgl.disabled': false,
              'webgl.force-enabled': true,
              'webgl.out-of-process': false,
              'gfx.webrender.software': true,
            },
            env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' },
          }
        : {},
  );
  // The mouse path is laid out for the web host, where scene units are CSS
  // pixels; a TV host scales a fixed stage, and mirrors no ARIA by default.
  if (target === 'web') await interactive(browser);
  await probe(browser);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
