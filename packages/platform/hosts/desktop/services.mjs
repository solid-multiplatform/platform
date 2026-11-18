import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * The desktop host's application services, for `installServices`. Each setting
 * is a separate atomically replaced file inside an app-owned directory.
 */
export function desktopServices(
  appData,
  { keyring, namespace = 'solid-app', ...providers } = {},
) {
  const file = (k) =>
    path.join(
      appData,
      createHash('sha256').update(k, 'utf8').digest('hex') + '.json',
    );
  const settings = {
    async get(k) {
      try {
        return JSON.parse(await fs.readFile(file(k), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async set(k, v) {
      await fs.mkdir(appData, { recursive: true, mode: 0o700 });
      const dest = file(k),
        tmp = dest + '.' + randomUUID();
      try {
        await fs.writeFile(tmp, JSON.stringify(v), { mode: 0o600, flag: 'wx' });
        await fs.rename(tmp, dest);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    },
    remove: (k) => fs.rm(file(k), { force: true }),
  };
  const secret = (k) => new keyring.AsyncEntry(namespace, k);
  return {
    settings,
    request: { fetch: globalThis.fetch.bind(globalThis) },
    ...providers,
    ...(keyring
      ? {
          secureStorage: {
            get: (k) => secret(k).getPassword(),
            set: (k, v) => secret(k).setPassword(v),
            remove: (k) => secret(k).deletePassword(),
          },
        }
      : {}),
  };
}
