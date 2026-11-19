// Bundles adapter/test.ts, puts its fixtures next to it and runs it in the
// runtime without a window. Exits with the runtime's status.
import path from 'node:path';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(path.join(tmpdir(), 'solid-desktop-adapter-'));
const fixtures = path.join(out, 'fixtures');
cpSync(path.resolve(here, '../../native/tests/fixtures'), fixtures, {
  recursive: true,
});
const data = JSON.stringify({ greeting: 'héllo wörld', list: [1, 2, 3] });
// With a byte order mark, which is not part of the text.
writeFileSync(path.join(fixtures, 'data.json'), '﻿' + data);
writeFileSync(path.join(fixtures, 'with space.json'), data);
writeFileSync(path.join(fixtures, 'colours.webp.txt'), 'not JSON');

const script = await bundle({
  entry: path.join(here, 'test.ts'),
  outfile: path.join(out, 'adapter.js'),
});
const result = spawnSync(defaultRuntime, ['--headless', script], {
  stdio: 'inherit',
  timeout: 60000,
});
rmSync(out, { recursive: true });
process.exit(result.status ?? 1);
