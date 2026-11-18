import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [path.resolve(root, '../..')] },
  },
  define: { SOLIDTV_DOM_RENDERING: false, __DEV__: false },
  plugins: [
    solid({
      hot: false,
      solid: {
        moduleName: '@solid-multiplatform/platform',
        generate: 'universal',
      },
    }),
  ],
  resolve: {
    dedupe: [
      'solid-js',
      '@solid-multiplatform/platform',
      '@solid-multiplatform/renderer',
    ],
  },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const backend of ['webgl', 'canvas']) {
    const page = await browser.newPage({
      viewport: { width: 450, height: 240 },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (e) => console.error(e.message));
    await page.goto(
      server.resolvedUrls.local[0] + (backend === 'canvas' ? '?canvas' : ''),
    );
    await page.waitForFunction(() => window.visual !== undefined);
    for (const state of ['initial', 'moved', 'resized']) {
      if (state === 'moved') await page.evaluate(() => window.visual.move());
      if (state === 'resized')
        await page.evaluate(() => window.visual.resize(400, 2));
      let last;
      for (let attempt = 0; attempt < 25; attempt++) {
        const png = await page.locator('canvas').screenshot();
        if (out)
          writeFileSync(path.join(out, backend + '-' + state + '.png'), png);
        last = await page.evaluate(
          async ({ data, moved, width }) => {
            const image = await createImageBitmap(
              await (await fetch('data:image/png;base64,' + data)).blob(),
            );
            const c = document.createElement('canvas');
            c.width = image.width;
            c.height = image.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(image, 0, 0);
            image.close();
            const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
            const sample = (x, y) => [
              ...pixels.slice(4 * (y * c.width + x), 4 * (y * c.width + x) + 3),
            ];
            const near = (a, b) => a.every((n, i) => Math.abs(n - b[i]) <= 5);
            const bg = [20, 34, 53],
              red = [248, 101, 77];
            const checks = [
              ['outside left clip', 8, 34, bg],
              ['inside clip', 18, 34, [32, 184, 137]],
              ['outside right clip', 82, 34, bg],
              ['old animation position', 110, 30, moved ? bg : red],
              ['new animation position', 154, 30, moved ? red : bg],
              ['opaque artwork', 206, 32, [239, 193, 75]],
              ['premultiplied edge', 225, 32, [138, 145, 154]],
              ['right-aligned marker', width - 12, 176, [144, 168, 240]],
            ];
            const errors = checks
              .filter(([, x, y, color]) => !near(sample(x, y), color))
              .map(([n, x, y]) => n + ': ' + sample(x, y));
            let glyphs = 0,
              stale = 0;
            for (let y = 88; y < 145; y++)
              for (let x = 14; x < 150; x++) {
                const [r, g, b] = sample(x, y);
                if (r > 180 && g > 180 && b > 180) {
                  glyphs++;
                  if (x > 42) stale++;
                }
              }
            if (glyphs < 8 || (moved ? stale !== 0 : stale < 8))
              errors.push('glyph pixels=' + glyphs + ', wide pixels=' + stale);
            return errors;
          },
          {
            data: png.toString('base64'),
            moved: state !== 'initial',
            width: state === 'resized' ? 400 : 320,
          },
        );
        if (!last.length) break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.deepEqual(last, [], backend + ' ' + state);
    }
    await page.close();
  }
  console.log(
    'Verified clipping, alpha, artwork, text replacement, movement and live resize on both renderers.',
  );
} finally {
  await browser?.close();
  await server.close();
}
