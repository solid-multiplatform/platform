import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2]);
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
let browser;
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForSelector('canvas');
  if (process.argv.includes('--tv')) {
    const cdp = await page.context().newCDPSession(page);
    for (const [width, height, dpr] of [
      [1920, 1080, 1],
      [1280, 720, 1],
      [960, 720, 1],
      [960, 720, 2],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile: false,
      });
      const scale = Math.min(width / 1920, height / 1080);
      const h = Math.round(scale * 1080),
        w = Math.round(scale * 1920);
      const top = (height - h) / 2,
        left = (width - w) / 2;
      await page.waitForFunction(
        ({ w, h, left, top, dpr }) => {
          const canvas = document.querySelector('canvas');
          const rect = canvas.getBoundingClientRect();
          return (
            rect.width === w &&
            rect.height === h &&
            rect.left === left &&
            rect.top === top &&
            canvas.width === w * dpr &&
            canvas.height === h * dpr
          );
        },
        { w, h, left, top, dpr },
        { timeout: 4000 },
      );
      await page.evaluate(
        () => delete document.documentElement.dataset.pluginResult,
      );
      if (top) {
        await page.mouse.click(160 * scale + left, top / 2);
        assert.equal(
          await page.locator('html').getAttribute('data-plugin-result'),
          null,
        );
      }
      await page.mouse.click(160 * scale + left, 270 * scale + top);
      await page.waitForFunction(
        () => document.documentElement.dataset.pluginResult === 'greeting',
        undefined,
        { timeout: 3000 },
      );
    }
  }
  if (!process.argv.includes('--tv')) {
    // The web host mirrors the scene for screen readers: the starter's row is
    // a button named by its text, with no accessibility code in the app.
    await page
      .getByRole('button', { name: 'greeting', exact: true })
      .waitFor({ state: 'attached', timeout: 4000 });
    // A real pointer click on the row, which the app did not register.
    await page.mouse.click(100, 120);
    await page.waitForFunction(
      () => document.documentElement.dataset.pluginResult === 'greeting',
      undefined,
      { timeout: 3000 },
    );
    // A click away from every control does nothing.
    await page.evaluate(
      () => delete document.documentElement.dataset.pluginResult,
    );
    await page.mouse.click(700, 500);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      await page.locator('html').getAttribute('data-plugin-result'),
      null,
    );
  }
  await page.evaluate(
    () => delete document.documentElement.dataset.pluginResult,
  );
  // Focus is assigned after the renderer's first update.
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.keyboard.press('Enter');
    if (
      (await page.locator('html').getAttribute('data-plugin-result')) ===
      'greeting'
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.waitForFunction(
    () => document.documentElement.dataset.pluginResult === 'greeting',
    undefined,
    { timeout: 3000 },
  );
  console.log(
    'Chromium invoked the generated web plugin through the shared UI',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
