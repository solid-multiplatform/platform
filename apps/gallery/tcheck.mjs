import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://127.0.0.1:4175/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/tv-web0.png' });
for (const key of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: '/tmp/tv-web1.png' });
await page.waitForTimeout(800);
console.log('alive', await page.evaluate(() => 1 + 1));
await browser.close();
