#!/usr/bin/env node
/**
 * Rasterise the framework's SVG icons into PNGs that every backend can draw.
 *
 * WebGL and the native hosts decode PNG (createImageBitmap, the canvas
 * polyfill, a Roku poster); only browsers and the desktop decode SVG. The
 * sources under `assets/icons` are the truth; `assets/icons/png` is generated
 * and committed so a checkout builds without rsvg-convert.
 *
 *   node packages/platform/scripts/icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '../assets/icons');
const out = path.join(assets, 'png');
// Large enough for a 32-unit icon on a 3x panel; smaller draws downsample.
const SIZE = 96;

const rasterise = (() => {
  for (const command of ['rsvg-convert', 'resvg']) {
    try {
      execFileSync(command, ['--help'], { stdio: 'ignore' });
      return command;
    } catch {
      // Try the next one.
    }
  }
  return undefined;
})();

if (rasterise === undefined) {
  console.error('Need rsvg-convert or resvg to rasterise the icons.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
for (const file of readdirSync(assets).filter((name) =>
  name.endsWith('.svg'),
)) {
  const name = file.slice(0, -'.svg'.length);
  const target = path.join(out, `${name}.png`);
  const args =
    rasterise === 'rsvg-convert'
      ? [
          '-w',
          String(SIZE),
          '-h',
          String(SIZE),
          '-o',
          target,
          path.join(assets, file),
        ]
      : [
          '-w',
          String(SIZE),
          '-h',
          String(SIZE),
          path.join(assets, file),
          target,
        ];
  execFileSync(rasterise, args, { stdio: 'inherit' });
  console.log(`${name}.png`);
}
