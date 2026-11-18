import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { installServices } from '@solid-multiplatform/platform/services';
import { compareVersions } from '@solid-multiplatform/platform/update';

const safeName = (url) => {
  try {
    return path.basename(new URL(url).pathname).replace(/[^\w.-]/g, '_') || 'update';
  } catch {
    return 'update';
  }
};

/**
 * Desktop update feed and delivery. The feed is a JSON document such as
 * `{ "version": "1.2.0", "url": "https://…/app.deb", "sha256": "…" }`.
 * Downloads are staged under the app data directory and verified before an
 * installer hook is called.
 */
export function createDesktopUpdater({
  appData,
  feedUrl,
  currentVersion = '0.0.0',
  installer,
  relaunch,
  fetchImpl = globalThis.fetch,
} = {}) {
  const updatesDir = path.join(appData, 'updates');
  const downloaded = new Map();

  const source = feedUrl
    ? {
        async check() {
          const response = await fetchImpl(feedUrl, {
            headers: { accept: 'application/json' },
          });
          if (!response.ok) {
            throw new Error(`Update feed failed: ${response.status}`);
          }
          const value = await response.json();
          if (!value?.version || !value?.url) return null;
          if (compareVersions(value.version, currentVersion) <= 0) return null;
          return {
            version: String(value.version),
            url: String(value.url),
            notes: value.notes,
            mandatory: value.mandatory === true,
            sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
          };
        },
      }
    : undefined;

  const delivery = {
    async download(update, onProgress) {
      if (!update?.url) throw new Error('Update has no download URL');
      mkdirSync(updatesDir, { recursive: true });
      const response = await fetchImpl(update.url);
      if (!response.ok) {
        throw new Error(`Update download failed: ${response.status}`);
      }
      const total = Number(response.headers.get('content-length')) || 0;
      const chunks = [];
      let received = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          received += value.length;
          if (onProgress && total) onProgress(Math.min(1, received / total));
        }
      } else {
        chunks.push(Buffer.from(await response.arrayBuffer()));
        received = chunks[0].length;
      }
      const data = Buffer.concat(chunks);
      if (update.sha256) {
        const digest = createHash('sha256').update(data).digest('hex');
        if (digest.toLowerCase() !== update.sha256.toLowerCase()) {
          throw new Error('Update checksum mismatch');
        }
      }
      const target = path.join(
        updatesDir,
        `${update.version}-${safeName(update.url)}`,
      );
      const temporary = `${target}.part`;
      await new Promise((resolve, reject) => {
        const stream = createWriteStream(temporary);
        stream.once('error', reject);
        stream.once('finish', resolve);
        stream.end(data);
      });
      await rename(temporary, target);
      downloaded.set(update.version, target);
      onProgress?.(1);
    },
    async install(update) {
      const file =
        downloaded.get(update.version) ??
        (existsSync(path.join(updatesDir, `${update.version}-${safeName(update.url)}`))
          ? path.join(updatesDir, `${update.version}-${safeName(update.url)}`)
          : undefined);
      if (!file) throw new Error('Update has not been downloaded');
      if (!installer) throw new Error('No desktop update installer configured');
      await installer(file, update);
    },
    async relaunch() {
      await relaunch?.();
    },
  };

  let unwire;
  return {
    source,
    delivery,
    /** Install the feed and the delivery as the update services. */
    wire() {
      unwire?.();
      unwire = installServices({
        updateDelivery: delivery,
        ...(source ? { updateSource: source } : {}),
      });
      return this;
    },
    /** Remove what `wire` installed. */
    unwire() {
      unwire?.();
      unwire = undefined;
    },
  };
}
