// The host test's driver. Bundles test.tsx, small.tsx and headless.ts, gives
// them a world of their own (a home directory, a language, a local HTTP
// server, stand-ins for the programs the system would start), runs them in
// the desktop runtime and judges what they report.
//
//   xvfb-run -a node tests/host/run.mjs [out-dir]
//
// Needs a display for the runtime's window; run.sh gives it a virtual one.
// With `xdotool` installed the test is also driven by real X events (keys,
// typing, the mouse, hiding the window); without it only by
// events put on SDL's queue, and this says so.
//
// Nothing here reaches the user's own session: the session D-Bus address is
// replaced (no portal dialog, no input method, no screen saver inhibit on
// the real desktop), `xdg-open` and `zenity` are scripts of this test, and
// `xdotool` acts on the display in DISPLAY, which is the virtual one.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  : mkdtempSync(path.join(tmpdir(), 'solid-desktop-host-'));
const IDLE_MS = 3000;
const APP = 'solid.test.host';
const LINK = 'solidtest://open/item?id=7';

const has = (program) =>
  spawnSync('sh', ['-c', `command -v ${program}`]).status === 0;
const xdotool = has('xdotool') && process.env.SOLID_DESKTOP_XDOTOOL !== '0';

// The app's world.
const home = path.join(out, 'home');
const data = path.join(home, 'data', APP, 'data');
const outsideDirectory = path.join(out, 'outside');
const bin = path.join(out, 'bin');
for (const directory of [
  data,
  outsideDirectory,
  bin,
  path.join(home, 'config'),
]) {
  mkdirSync(directory, { recursive: true });
}
cpSync(path.join(platform, 'tests/webgl/fonts'), path.join(out, 'fonts'), {
  recursive: true,
});
writeFileSync(path.join(outsideDirectory, 'secret.txt'), 'secret');
// A way out of the app's data directory, if the runtime followed it.
if (!existsSync(path.join(data, 'escape'))) {
  symlinkSync(outsideDirectory, path.join(data, 'escape'));
}
writeFileSync(
  path.join(home, 'config', 'user-dirs.dirs'),
  'XDG_DOCUMENTS_DIR="$HOME/Documents"\n',
);
mkdirSync(path.join(home, 'Documents'), { recursive: true });
const opened = path.join(out, 'opened.log');
const dialogs = path.join(out, 'dialogs.log');
const saved = path.join(out, 'saved-by-dialog.txt');
for (const file of [opened, dialogs, saved]) rmSync(file, { force: true });
// What the system would start. SDL's dialog runs `zenity` and reads the
// chosen paths from its output; this one says what the test told it to.
writeFileSync(
  path.join(bin, 'zenity'),
  `#!/bin/sh
case "$*" in *--version*) echo 4.0.0; exit 0;; esac
echo "$*" >> "${dialogs}"
reply=$(cat "${path.join(data, 'dialog-reply')}")
[ "$reply" = CANCEL ] && exit 1
printf '%s\\n' "$reply"
`,
);
writeFileSync(
  path.join(bin, 'xdg-open'),
  `#!/bin/sh\necho "$1" >> "${opened}"\n`,
);
for (const program of ['zenity', 'xdg-open']) {
  chmodSync(path.join(bin, program), 0o755);
}

const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  // The user's proxies, input method and language are not the test's.
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
  PATH: `${bin}:${process.env.PATH}`,
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/solid-desktop-test',
  SDL_FILE_DIALOG_DRIVER: 'zenity',
  SOLID_DESKTOP_TEST: '1',
});

// A 1 x 1 PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const JSON_BODY = JSON.stringify({ greeting: 'héllo wörld', list: [1, 2, 3] });
const pending = new Set();
function serve(request, response) {
  const url = new URL(request.url, 'http://x');
  const text = (status, body, headers = {}) => {
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    });
    response.end(body);
  };
  switch (url.pathname) {
    case '/hello':
      return text(
        200,
        `hello ${request.method} ${request.url} ${request.headers['x-ask'] ?? ''}`.trim(),
        { 'x-test': 'yes' },
      );
    case '/missing':
      return text(404, 'nope');
    case '/bytes':
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      return response.end(
        Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      );
    case '/echo': {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        response.writeHead(200, {
          'content-type':
            request.headers['content-type'] ?? 'application/octet-stream',
          'x-method': request.method,
        });
        response.end(Buffer.concat(chunks));
      });
      return undefined;
    }
    case '/json':
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON_BODY);
    case '/gzip':
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      return response.end(zlib.gzipSync('x'.repeat(5000)));
    case '/redirect':
      response.writeHead(302, { location: '/hello' });
      return response.end();
    case '/slow': {
      // Answers long after the test has given up on it.
      const timer = setTimeout(() => text(200, 'late'), 4000);
      pending.add(timer);
      return undefined;
    }
    case '/pixel.png':
      response.writeHead(200, { 'content-type': 'image/png' });
      return response.end(PIXEL);
    default:
      return text(404, 'no such path');
  }
}
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
const server = http.createServer(serve);
const port = await listen(server);
// A port that refuses: one that was just closed.
const closed = http.createServer();
const refused = await listen(closed);
await new Promise((resolve) => closed.close(resolve));
// HTTPS with a certificate nobody signed, which the runtime must refuse.
let secure;
let untrusted;
if (has('openssl')) {
  const key = path.join(out, 'key.pem');
  const certificate = path.join(out, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      certificate,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-days',
      '2',
    ],
    { stdio: 'ignore' },
  );
  secure = https.createServer(
    { key: readFileSync(key), cert: readFileSync(certificate) },
    serve,
  );
  untrusted = `https://127.0.0.1:${await listen(secure)}`;
}
writeFileSync(
  path.join(out, 'setup.json'),
  JSON.stringify({
    server: `http://127.0.0.1:${port}`,
    refused,
    untrusted,
    xdotool,
    outside: path.join(outsideDirectory, 'secret.txt'),
    saved,
    idleMs: IDLE_MS,
    link: LINK,
  }),
);

const xdo = (...args) =>
  execFileSync('xdotool', args, { encoding: 'utf8' }).trim();
/** What each `STEP` the app prints asks for, done with real X events. */
function step(name, window) {
  switch (name) {
    case 'keys':
      return xdo('key', 'Right', 'Return');
    case 'type':
      return xdo('type', '--delay', '30', 'Hi 5!');
    case 'mouse':
      // Onto the control, a click, one wheel notch towards the user.
      return xdo(
        'mousemove',
        '--window',
        window,
        '450',
        '60',
        'click',
        '1',
        'click',
        '5',
      );
    case 'unmap':
      return xdo('windowunmap', window);
    case 'map':
      xdo('windowmap', window);
      return xdo('windowfocus', window);
    default:
      throw new Error(`the app asked for an unknown step: ${name}`);
  }
}

/** Runs a script in the runtime; resolves with what it printed and how it ended. */
function runtime(
  args,
  { extra = {}, onLine = () => {}, timeout = 120000 } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(defaultRuntime, args, {
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
      for (
        let end;
        (end = line.indexOf('\n')) !== -1;
        line = line.slice(end + 1)
      ) {
        try {
          onLine(line.slice(0, end), child);
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
}

/** Standard error without the renderer's note that it runs no image worker. */
const errorsOf = (result) =>
  result.stderr
    .split('\n')
    .filter(
      (l) => l !== '' && !l.startsWith('[SolidTV] Image worker count is 0'),
    );

const scripts = {};
for (const [name, entry] of [
  ['host', 'test.tsx'],
  ['small', 'small.tsx'],
  ['headless', 'headless.ts'],
]) {
  scripts[name] = await bundle({
    entry: path.join(here, entry),
    outfile: path.join(out, `${name}.js`),
  });
}

try {
  // The package without a window.
  const headless = await runtime(['--headless', scripts.headless]);
  assert.equal(
    headless.status,
    0,
    `headless:\n${headless.stdout}${headless.stderr}`,
  );
  console.log(headless.stdout.trim());

  // The app, with input, fields, services and requests.
  let window;
  const host = await runtime([scripts.host, 'not-a-link', LINK], {
    onLine(line) {
      if (!line.startsWith('STEP ')) return;
      window ??= xdo('search', '--name', '^Solid host test$').split('\n')[0];
      step(line.slice(5), window);
    },
  });
  const report = host.stdout.split('\n').find((l) => l.startsWith('HOST '));
  assert.ok(
    report,
    `no result (exit ${host.status}):\n${host.stdout}${host.stderr}`,
  );
  const { checks, failures, notes } = JSON.parse(report.slice(5));
  assert.deepEqual(
    failures,
    [],
    `the host test found problems\n${host.stderr}`,
  );
  // The window was closed: the app's cleanup ran, after the report, and the
  // process ended by itself with status 0.
  const lines = host.stdout.split('\n');
  assert.ok(
    lines.indexOf('DISPOSED') > lines.indexOf(report),
    'closing did not run the disposer',
  );
  assert.equal(
    host.status,
    0,
    `exit ${host.status} ${host.signal ?? ''}\n${host.stderr}`,
  );
  assert.deepEqual(errorsOf(host), [], 'unexpected output on standard error');
  // What the app did to the world outside it.
  assert.deepEqual(
    JSON.parse(
      readFileSync(path.join(home, 'data', APP, 'settings.json'), 'utf8'),
    ),
    { volume: '7', name: 'héllo "quoted"' },
  );
  assert.equal(
    readFileSync(opened, 'utf8'),
    'https://example.com/a?b=c\n',
    'openExternal',
  );
  assert.equal(readFileSync(saved, 'utf8'), 'saved text', 'download');
  assert.equal(
    readFileSync(path.join(outsideDirectory, 'secret.txt'), 'utf8'),
    'secret',
  );
  assert.ok(
    !existsSync(path.join(outsideDirectory, 'planted.txt')),
    'a write escaped',
  );
  // SDL asked the dialog program three times: twice to open, once to save.
  const asked = readFileSync(dialogs, 'utf8');
  assert.equal(asked.match(/--file-selection/g)?.length, 3, asked);
  assert.equal(asked.match(/--save/g)?.length, 1, asked);
  // The accept list reached the dialog as a file filter.
  assert.match(asked, /--file-filter=Accepted files \| \*\.\[tT\]\[xX\]\[tT\]/);
  console.log(`host: ${checks} checks ok`);
  console.log(`host: services ${notes.services.join(', ')}`);
  console.log(
    `host: real X events ${notes.xdotool ? 'driven with xdotool (keys, typing, mouse, hide and show)' : 'NOT driven: xdotool is not installed'}; ` +
      `battery "${notes.battery}"; TLS: ${notes.tls}`,
  );
  console.log(
    `host: idle for ${notes.idle.ms} ms with everything installed: ${notes.idle.wakeups} wakeup, ${notes.idle.frames} frames, ${notes.idle.presents} presents`,
  );

  // A display at twice the scale, as the window opens; then a signal ends
  // the app as closing the window does.
  const small = await runtime([scripts.small], {
    extra: { SDL_VIDEO_X11_SCALING_FACTOR: '2' },
    onLine(line, child) {
      if (line.startsWith('SMALL ') && xdotool) {
        // A real click at pixel 300,100 of the window.
        const id = xdo('search', '--name', '^Solid small test$').split('\n')[0];
        xdo('mousemove', '--window', id, '300', '100', 'click', '1');
      } else if (line.startsWith('SMALL ') || line.startsWith('CLICKED ')) {
        child.kill('SIGTERM');
      }
    },
  });
  const drawn = small.stdout.split('\n').find((l) => l.startsWith('SMALL '));
  assert.ok(
    drawn,
    `no result (exit ${small.status}):\n${small.stdout}${small.stderr}`,
  );
  const scaled = JSON.parse(drawn.slice(6));
  assert.deepEqual(scaled.viewport, {
    width: 640,
    height: 360,
    scale: 2,
    framebufferWidth: 1280,
    framebufferHeight: 720,
  });
  assert.deepEqual(scaled.canvas, [1280, 720]);
  assert.deepEqual(scaled.pixels, [
    [0x4f, 0xb3, 0xff, 0xff],
    [0x4f, 0xb3, 0xff, 0xff],
    [0, 0, 0, 0],
  ]);
  if (xdotool) {
    assert.ok(
      small.stdout.split('\n').includes('CLICKED 150,50'),
      `a real click at pixel 300,100 is not at 150,50:\n${small.stdout}`,
    );
  }
  assert.ok(
    small.stdout.split('\n').includes('DISPOSED'),
    'SIGTERM did not run the disposer',
  );
  assert.equal(
    small.status,
    0,
    `exit ${small.status} ${small.signal ?? ''}\n${small.stderr}`,
  );
  console.log(
    'host: a display scale of 2 gives a 640 x 360 scene in 1280 x 720 pixels; SIGTERM disposes of the app',
  );
} finally {
  for (const timer of pending) clearTimeout(timer);
  server.closeAllConnections();
  server.close();
  secure?.closeAllConnections();
  secure?.close();
  if (!keep) rmSync(out, { recursive: true, force: true });
}
