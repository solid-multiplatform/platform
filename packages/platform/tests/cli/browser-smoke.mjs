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
  // The starter must run clean: an uncaught error or a console error fails.
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const press = async (key) => {
    await page.keyboard.press(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const result = () => page.locator('html').getAttribute('data-plugin-result');
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForSelector('canvas');
  // The starter's layout: a title, a counter button, then one button per
  // plugin. The plugin's button is the second, at this point of the scene.
  const pluginButton = { x: 80, y: 200 };
  if (!process.argv.includes('--tv')) {
    // The web host mirrors the scene for screen readers: each Button is a
    // button named by its label, with no accessibility code in the app.
    await page
      .getByRole('button', { name: 'greeting', exact: true })
      .waitFor({ state: 'attached', timeout: 4000 });
    // Keyboard first, before a pointer has touched anything. Focus starts on
    // the counter (it is assigned after the renderer's first update): Enter
    // presses it, and its label follows the count.
    for (let attempt = 0; attempt < 30; attempt++) {
      await press('Enter');
      if (await page.getByRole('button', { name: /^Pressed [1-9]/ }).count())
        break;
    }
    await page
      .getByRole('button', { name: /^Pressed [1-9]/ })
      .waitFor({ state: 'attached', timeout: 3000 });
    assert.equal(await result(), null);
    // Down moves focus to the plugin's button; Enter activates it.
    await press('ArrowDown');
    await press('Enter');
    await page.waitForFunction(
      () => document.documentElement.dataset.pluginResult === 'greeting',
      undefined,
      { timeout: 3000 },
    );
    await page.evaluate(
      () => delete document.documentElement.dataset.pluginResult,
    );
  }
  if (process.argv.includes('--tv')) {
    // A pointer-only host (PS4) selects the focused node when a click lands on
    // empty space instead of dropping it.
    const emptySelects = process.argv.includes('--empty-selects');
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
        await page.mouse.click(pluginButton.x * scale + left, top / 2);
        if (emptySelects)
          await page.waitForFunction(
            () => document.documentElement.dataset.pluginResult === 'greeting',
            undefined,
            { timeout: 3000 },
          );
        else assert.equal(await result(), null);
        await page.evaluate(
          () => delete document.documentElement.dataset.pluginResult,
        );
      }
      await page.mouse.click(
        pluginButton.x * scale + left,
        pluginButton.y * scale + top,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.pluginResult === 'greeting',
        undefined,
        { timeout: 3000 },
      );
    }
  }
  if (!process.argv.includes('--tv')) {
    // A real pointer click on the button, which the app did not register.
    await page.mouse.click(pluginButton.x, pluginButton.y);
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
    assert.equal(await result(), null);
  }
  await page.evaluate(
    () => delete document.documentElement.dataset.pluginResult,
  );
  // The remote, or the keyboard again after the pointer: Down reaches the
  // plugin's button from wherever focus is, and Enter activates it. Focus is
  // assigned after the renderer's first update.
  for (let attempt = 0; attempt < 30; attempt++) {
    await press('ArrowDown');
    await press('Enter');
    if ((await result()) === 'greeting') break;
  }
  await page.waitForFunction(
    () => document.documentElement.dataset.pluginResult === 'greeting',
    undefined,
    { timeout: 3000 },
  );
  assert.deepEqual(errors, [], 'the page reported errors');
  console.log(
    'Chromium invoked the generated web plugin through the shared UI',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
