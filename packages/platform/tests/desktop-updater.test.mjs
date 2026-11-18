import * as v from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDesktopUpdater } from '../hosts/desktop/updater.mjs';
import {
  checkForUpdate,
  createUpdateDelivery,
  setUpdateDeliveryPort,
  setUpdateSource,
} from '../src/sdk/update.js';

const payload = Buffer.from('desktop update payload');
const sha256 = createHash('sha256').update(payload).digest('hex');

const server = async () => {
  const http = createServer((request, response) => {
    if (request.url === '/feed.json') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          version: '2.0.0',
          url: `http://127.0.0.1:${http.address().port}/app.bin`,
          sha256: process.env.BAD_CHECKSUM ? '0'.repeat(64) : sha256,
          notes: 'Release notes',
          mandatory: true,
        }),
      );
      return;
    }
    if (request.url === '/app.bin') {
      response.setHeader('content-length', payload.length);
      response.end(payload);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  return http;
};

v.describe('desktop updater', () => {
  v.afterEach(() => {
    setUpdateSource(undefined);
    setUpdateDeliveryPort(undefined);
    delete process.env.BAD_CHECKSUM;
  });

  v.it('checks the feed, downloads, verifies and installs', async () => {
    const http = await server();
    const port = http.address().port;
    const appData = mkdtempSync(path.join(tmpdir(), 'solid-update-'));
    const installed = [];
    const relaunched = [];
    createDesktopUpdater({
      appData,
      feedUrl: `http://127.0.0.1:${port}/feed.json`,
      currentVersion: '1.0.0',
      installer: async (file, update) => {
        installed.push([file, update.version]);
      },
      relaunch: async () => relaunched.push(true),
    }).wire();

    v.expect(await checkForUpdate('1.0.0')).toMatchObject({
      version: '2.0.0',
      mandatory: true,
      sha256,
    });
    v.expect(await checkForUpdate('2.0.0')).toBeNull();
    v.expect(await checkForUpdate('3.0.0')).toBeNull();

    const delivery = createUpdateDelivery();
    v.expect(
      await delivery.apply({
        version: '2.0.0',
        url: `http://127.0.0.1:${port}/app.bin`,
        sha256,
      }),
    ).toBe('installed');
    v.expect(delivery.progress()).toBe(1);
    v.expect(installed).toHaveLength(1);
    v.expect(installed[0][1]).toBe('2.0.0');
    v.expect(existsSync(installed[0][0])).toBe(true);
    v.expect(readFileSync(installed[0][0], 'utf8')).toBe(payload.toString());
    v.expect(relaunched).toEqual([true]);

    await new Promise((resolve) => http.close(resolve));
  });

  v.it('rejects a checksum mismatch before install', async () => {
    process.env.BAD_CHECKSUM = '1';
    const http = await server();
    const appData = mkdtempSync(path.join(tmpdir(), 'solid-update-bad-'));
    const updater = createDesktopUpdater({
      appData,
      feedUrl: `http://127.0.0.1:${http.address().port}/feed.json`,
      currentVersion: '1.0.0',
      installer: async () => {},
    });
    const update = await updater.source.check();
    await v
      .expect(updater.delivery.download(update, () => {}))
      .rejects.toThrowError(/checksum/);
    await new Promise((resolve) => http.close(resolve));
  });

  v.it('requires a downloaded artifact and installer', async () => {
    const appData = mkdtempSync(path.join(tmpdir(), 'solid-update-missing-'));
    const updater = createDesktopUpdater({ appData });
    await v
      .expect(
        updater.delivery.install({
          version: '9.9.9',
          url: 'https://x/app.bin',
        }),
      )
      .rejects.toThrowError(/not been downloaded/);
  });
});
