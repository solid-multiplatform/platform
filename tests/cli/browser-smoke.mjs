import { createServer } from 'node:http';
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
