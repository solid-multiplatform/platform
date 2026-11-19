// Bundles web/intl.ts and runs it in the runtime without a window. Exits
// with the runtime's status.
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle, defaultRuntime } from '../../cli/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(path.join(tmpdir(), 'solid-desktop-intl-'));
const script = await bundle({
  entry: path.join(here, 'intl.ts'),
  outfile: path.join(out, 'intl.js'),
});
const result = spawnSync(defaultRuntime, ['--headless', script], {
  stdio: 'inherit',
  timeout: 120000,
});
rmSync(out, { recursive: true });
process.exit(result.status ?? 1);
