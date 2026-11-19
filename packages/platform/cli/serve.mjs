// @ts-check
// A static file server for `solid-platform run web`. Listens on localhost only.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

/**
 * Serves `dir` on 127.0.0.1. Unknown paths without an extension return
 * index.html so client-side routes load.
 * @param {string} dir
 * @param {number} [port] 0 picks a free port
 * @returns {Promise<{ url: string, port: number, close(): Promise<void> }>}
 */
export function serve(dir, port = 0) {
  const base = path.resolve(dir);
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
    } catch {
      response.writeHead(400).end();
      return;
    }
    let file = path.join(base, pathname);
    if (file !== base && !file.startsWith(base + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      if (path.extname(pathname)) {
        response.writeHead(404).end('Not found');
        return;
      }
      file = path.join(base, 'index.html');
    }
    if (!existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type':
        /** @type {Record<string, string>} */ (types)[path.extname(file)] ??
        'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (
        server.address()
      );
      resolve({
        url: `http://localhost:${address.port}/`,
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
