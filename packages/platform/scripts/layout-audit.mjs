#!/usr/bin/env node
/**
 * Build-time layout audit.
 *
 * Runs the three audit suites that render real UI at phone, TV, Roku and
 * desktop sizes: the primitives in every overlay, the gallery's screens,
 * and the gallery's overlays OPEN — each dialog is driven open through the
 * app's own controls before its geometry is read. The geometry comes from
 * the laid-out tree, so a close row past its card or a sheet footer below a
 * landscape screen fails the build here instead of showing up in a
 * screenshot.
 *
 *   node scripts/layout-audit.mjs
 *
 * A finding prints the node, the edge and the number of units it escapes;
 * Vitest's non-zero exit stops the caller.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// `--warn` (or LAYOUT_AUDIT=warn) reports the findings but does not fail the
// build; the gallery build keeps the strict default.
const warnOnly =
  process.argv.includes('--warn') || process.env.LAYOUT_AUDIT === 'warn';

console.log('\n== Auditing layout: phone, TV, Roku and desktop, overlays open');
const result = spawnSync(
  'corepack',
  [
    'pnpm',
    'exec',
    'vitest',
    'run',
    'tests/layout-audit.test.tsx',
    'tests/gallery-layout.test.tsx',
    'tests/gallery-overlay-layout.test.tsx',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  const message =
    '\nLayout audit failed: a box is cut off or spills out of its panel, ' +
    'or a control left the dialog that painted it. ' +
    'The lines above name the node and the edge.';
  if (warnOnly) {
    console.warn(message + ' (warning only: --warn)');
    process.exit(0);
  }
  console.error(message);
  process.exit(result.status ?? 1);
}
console.log(
  '\nLayout audit passed: no box is cut off or spills out of its panel ' +
    'on a 320-pt phone, a Pixel 7 Pro, a 540-pt TV, Roku at 1080p or a ' +
    "desktop window — with the gallery's dialogs, drawers, popovers, " +
    'menus and alerts driven open first.',
);
