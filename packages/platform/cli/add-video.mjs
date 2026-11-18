import path from 'node:path';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { project, copy, json, writeJson } from './files.mjs';

/** Install a local release asset into the app. The media dependency stays out of the UI package. */
export function addVideo(root, asset) {
  const config = project(root);
  if (!asset.endsWith('.tgz') || !existsSync(asset))
    throw new Error('Provide the downloaded Solid Multiplatform video .tgz');
  const sha = createHash('sha256').update(readFileSync(asset)).digest('hex');
  const name = 'solid-video-' + sha.slice(0, 16) + '.tgz';
  copy(asset, path.join(root, 'vendor', name));
  for (const dir of [
    root,
    ...config.targets.map((t) => path.join(root, 'targets', t)),
  ]) {
    const file = path.join(dir, 'package.json'),
      pkg = json(file);
    const relative = path
      .relative(dir, path.join(root, 'vendor', name))
      .split(path.sep)
      .join('/');
    pkg.dependencies ??= {};
    pkg.dependencies['@solid-multiplatform/video'] = 'file:' + relative;
    const temp = mkdtempSync(path.join(dir, '.solid-deps-'));
    try {
      writeJson(path.join(temp, 'package.json'), pkg);
      renameSync(path.join(temp, 'package.json'), file);
    } finally {
      rmSync(temp, { force: true, recursive: true });
    }
  }
  console.log(
    'Added video ' +
      sha +
      '. Run corepack pnpm install --no-frozen-lockfile in the root and previously installed targets.',
  );
}
