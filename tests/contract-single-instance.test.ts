import * as v from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const child = (name: string, args: string[], out: string) =>
  spawn(process.execPath, ['tests/cli/single-instance-child.mjs', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, SI_NAME: name, SI_OUT: out },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

const waitFor = (file: string, text: string, timeout = 3000) =>
  new Promise<string>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      let output = '';
      try {
        output = readFileSync(file, 'utf8');
      } catch {
        // The child has not written yet.
      }
      if (output.includes(text)) return resolve(output);
      if (Date.now() - started > timeout) {
        return reject(new Error(`Timed out waiting for ${text}: ${output}`));
      }
      setTimeout(poll, 10);
    };
    poll();
  });

const done = (process: ChildProcessWithoutNullStreams) =>
  new Promise<number | null>((resolve) => {
    if (process.exitCode !== null) return resolve(process.exitCode);
    process.once('exit', resolve);
  });

v.describe('desktop single instance', () => {
  v.it(
    'forwards activation to the primary process',
    async () => {
      const name = `solid-si-${Math.random()}`;
      const dir = mkdtempSync(path.join(tmpdir(), 'solid-si-'));
      const primary = child(name, [], path.join(dir, 'primary.log'));
      await waitFor(path.join(dir, 'primary.log'), 'primary');

      const secondary = child(
        name,
        ['open:file.txt'],
        path.join(dir, 'secondary.log'),
      );
      await waitFor(path.join(dir, 'secondary.log'), 'secondary');
      v.expect(await done(secondary)).toBe(0);

      await waitFor(path.join(dir, 'primary.log'), 'activated:open:file.txt');
      primary.kill('SIGTERM');
      await done(primary);
    },
    10000,
  );

  v.it(
    'takes over a stale socket',
    async () => {
      const name = `solid-si-stale-${Math.random()}`;
      const dir = mkdtempSync(path.join(tmpdir(), 'solid-si-stale-'));
      const first = child(name, [], path.join(dir, 'first.log'));
      await waitFor(path.join(dir, 'first.log'), 'primary');
      // Kill without disposing; the socket file stays behind.
      first.kill('SIGKILL');
      await done(first);

      const second = child(name, [], path.join(dir, 'second.log'));
      await waitFor(path.join(dir, 'second.log'), 'primary');
      second.kill('SIGTERM');
      await done(second);
    },
    10000,
  );
});
