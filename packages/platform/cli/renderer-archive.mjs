// Packs the workspace renderer into vendor/ so `solid-platform init` can copy it
// into a new app. Runs from prepack (the published platform archive carries the
// renderer archive) and on demand from init in a source checkout. In a packed
// platform archive there is no workspace sibling and vendor/ is used as is.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const framework = fileURLToPath(new URL('../', import.meta.url));
const renderer = path.join(framework, '../renderer');
const vendor = path.join(framework, 'vendor');
const prefix = 'solid-multiplatform-renderer-';

/** The renderer archive in vendor/, packing it from the workspace when it is missing. */
export function rendererArchive({ refresh = false } = {}) {
  const packed = () =>
    existsSync(vendor)
      ? readdirSync(vendor).filter((f) => f.startsWith(prefix) && f.endsWith('.tgz'))
      : [];
  if (existsSync(path.join(renderer, 'package.json')) && (refresh || packed().length === 0)) {
    if (!existsSync(path.join(renderer, 'dist/webgl/exports/index.js')))
      throw new Error('Build the renderer package before packing it (pnpm build).');
    for (const file of packed()) rmSync(path.join(vendor, file));
    mkdirSync(vendor, { recursive: true });
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--silent', '--pack-destination', vendor],
      { cwd: renderer, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  }
  const [archive, ...extra] = packed();
  if (!archive || extra.length)
    throw new Error('Expected exactly one renderer archive in ' + vendor);
  const { version } = JSON.parse(readFileSync(path.join(framework, 'package.json'), 'utf8'));
  return { file: path.join(vendor, archive), name: archive, platformVersion: version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) rendererArchive({ refresh: true });
