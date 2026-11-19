// The real-scene test. Bundles the shared fixture, runs it in the desktop
// runtime as source and as bytecode (the runtime judges its own pixels, its
// idle behaviour and a resize, see desktop-test.ts), then renders the same
// fixture in Chromium and compares the two frames.
//
//   xvfb-run -a node tests/scene/run.mjs [out-dir]
//
// Needs a display for the runtime's window (run.sh gives it a virtual one)
// and Playwright's Chromium, as the platform's WebGL tests do.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '../../../platform');
// The bundles and the page are kept when a directory is named for them.
const keep = process.argv[2] !== undefined;
const out = keep
  ? path.resolve(process.argv[2])
  : mkdtempSync(path.join(tmpdir(), 'solid-desktop-scene-'));
mkdirSync(out, { recursive: true });
cpSync(path.join(platform, 'tests/webgl/fonts'), path.join(out, 'fonts'), {
  recursive: true,
});

const NO_BUS = {
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/solid-desktop-test',
  DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/nonexistent/solid-desktop-test',
};

function runDesktop(script) {
  const result = spawnSync(defaultRuntime, [script], {
    encoding: 'utf8',
    timeout: 60000,
    // Not the user's session: the host asks the session and system buses
    // which services they have, and SDL uses the session bus too.
    env: { ...process.env, ...NO_BUS },
  });
  const line = result.stdout.split('\n').find((l) => l.startsWith('SCENE '));
  assert.ok(
    line,
    `no result from ${script} (exit ${result.status}):\n${result.stdout}${result.stderr}`,
  );
  const scene = JSON.parse(line.slice(6));
  assert.deepEqual(
    scene.problems,
    [],
    `${path.basename(script)} found problems`,
  );
  assert.equal(result.status, 0);
  // Standard error holds the renderer's note that it runs no image worker
  // and the one error the test throws in a frame, with its stack; nothing
  // else was uncaught on the way.
  const errors = result.stderr
    .split('\n')
    .filter(
      (l) => l !== '' && !l.startsWith('[SolidTV] Image worker count is 0'),
    );
  assert.equal(
    errors[0],
    'Uncaught in a frame: Error: thrown in a frame listener',
  );
  assert.match(errors[1] ?? '', /^ {4}at failing \(/, 'the error has no stack');
  assert.deepEqual(
    errors.filter((l) => !l.startsWith('    at ')).slice(1),
    [],
    'unexpected output on standard error',
  );
  return scene;
}

async function runBrowser(script) {
  writeFileSync(
    path.join(out, 'index.html'),
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style>' +
      `<div id="app"></div><script src="${path.basename(script)}"></script>`,
  );
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
  };
  const server = http.createServer((request, response) => {
    const file = path.join(
      out,
      path.normalize(new URL(request.url, 'http://x').pathname),
    );
    try {
      const body = readFileSync(file.startsWith(out) ? file : out);
      response.writeHead(200, {
        'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = createRequire(path.join(platform, 'package.json'))(
    'playwright',
  );
  const browser = await chromium.launch({
    // Headless Chromium has no GPU: WebGL on SwiftShader, as in the
    // platform's own WebGL tests.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(
      () => globalThis.sceneResult !== undefined,
      null,
      { timeout: 30000 },
    );
    const result = await page.evaluate(() => globalThis.sceneResult);
    assert.deepEqual(errors, [], 'the page threw');
    assert.equal(result.error, undefined);
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}

/** The desktop frame against Chromium's: same scene, same pixels. */
function compare(desktop, browser) {
  assert.deepEqual(desktop.scene, browser.scene);
  assert.equal(desktop.frame.width, browser.frame.width);
  assert.equal(desktop.frame.height, browser.frame.height);
  // Flat colours are exact in both: no blending is involved.
  assert.deepEqual(desktop.frame.points, browser.frame.points);
  // Text is anti-aliased by two software rasterizers (llvmpipe here,
  // SwiftShader there), so its edges may differ by a little: the same glyphs
  // in the same places, within a few levels per 8 x 8 cell.
  const a = desktop.frame.textCells;
  const b = browser.frame.textCells;
  assert.equal(a.length, b.length);
  const differences = a.map((value, i) => Math.abs(value - b[i]));
  const worst = Math.max(...differences);
  const mean = differences.reduce((sum, d) => sum + d, 0) / differences.length;
  assert.ok(worst <= 12, `a text cell differs by ${worst} levels`);
  assert.ok(
    mean <= 2,
    `text cells differ by ${mean.toFixed(2)} levels on average`,
  );
  const glyphs = Math.abs(
    desktop.frame.glyphPixels - browser.frame.glyphPixels,
  );
  assert.ok(
    glyphs <= browser.frame.glyphPixels * 0.05,
    `glyph pixels: ${desktop.frame.glyphPixels} here, ${browser.frame.glyphPixels} in Chromium`,
  );
  return { worst, mean };
}

const script = path.join(out, 'scene.js');
const bytecode = await bundle({
  entry: path.join(here, 'desktop-test.ts'),
  outfile: script,
  bytecode: true,
});
const fromSource = runDesktop(script);
const fromBytecode = runDesktop(bytecode);
assert.deepEqual(
  fromBytecode.frame,
  fromSource.frame,
  'bytecode drew a different frame',
);

const browser = await runBrowser(
  await bundle({
    entry: path.join(here, 'browser-test.ts'),
    outfile: path.join(out, 'browser.js'),
  }),
);
const text = compare(fromSource, browser);

const { idle, frame, resized } = fromSource;
console.log(
  `scene: ${Object.keys(frame.points).length} points match the fixture and Chromium`,
);
console.log(
  `scene: text "${fromSource.scene.text}", ${frame.glyphPixels} glyph pixels (Chromium ${browser.frame.glyphPixels}); ` +
    `cells differ by at most ${text.worst}, ${text.mean.toFixed(2)} on average`,
);
console.log(
  `scene: idle for ${idle.ms} ms: ${idle.wakeups} wakeup, ${idle.frames} frames, ${idle.presents} presents`,
);
console.log(
  `scene: resized to ${resized.width} x ${resized.height}, ${Object.keys(resized.points).length} points match`,
);
console.log('scene: source and bytecode draw the same frame');
if (!keep) rmSync(out, { recursive: true });
