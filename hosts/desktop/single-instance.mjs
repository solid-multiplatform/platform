import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const keyFor = (name) =>
  createHash('sha256').update(name).digest('hex').slice(0, 16);

const socketPathFor = (name) => {
  const key = keyFor(name);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\solid-${key}`
    : path.join(os.tmpdir(), `solid-${key}.sock`);
};

function tryConnect(socket, payload, timeout = 500) {
  return new Promise((resolve) => {
    const client = net.createConnection(socket);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(value);
    };
    client.setTimeout(timeout);
    client.once('connect', () => client.write(JSON.stringify(payload) + '\n'));
    client.once('data', () => finish(true));
    client.once('timeout', () => finish(false));
    client.once('error', () => finish(false));
    client.once('close', () => finish(false));
  });
}

/**
 * Single-instance lock and activation channel for the SDL3 desktop host.
 *
 * The first process listens on a per-app Unix socket / named pipe. Later
 * launches connect, send `{ args }`, and return `{ isPrimary: false }` so the
 * caller can exit. A stale socket (crashed process) is removed and retried.
 */
export async function createSingleInstance({
  name = 'solid-app',
  args = process.argv.slice(2),
  onActivate,
} = {}) {
  const socket = socketPathFor(name);
  if (await tryConnect(socket, { args })) {
    return {
      isPrimary: false,
      notify: async () => true,
      dispose() {},
    };
  };

  if (process.platform !== 'win32' && existsSync(socket)) {
    try {
      rmSync(socket, { force: true });
    } catch {
      // The listen below reports a meaningful error if it still fails.
    }
  }

  const server = net.createServer((connection) => {
    let data = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk) => {
      data += chunk;
      const newline = data.indexOf('\n');
      if (newline === -1) return;
      try {
        const message = JSON.parse(data.slice(0, newline));
        onActivate?.(Array.isArray(message.args) ? message.args : []);
      } catch {
        // Ignore malformed activation payloads.
      }
      connection.end('ok\n');
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    // Another launch won the race after our first connect failed.
    if (await tryConnect(socket, { args })) {
      return {
        isPrimary: false,
        notify: async () => true,
        dispose() {},
      };
    }
    throw error;
  }

  const notify = async (nextArgs = args) =>
    tryConnect(socket, { args: nextArgs });
  let closed = false;
  return {
    isPrimary: true,
    notify,
    dispose() {
      if (closed) return;
      closed = true;
      server.close();
      if (process.platform !== 'win32') rmSync(socket, { force: true });
    },
  };
}
