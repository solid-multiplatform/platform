import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const project = process.argv[2],
  require = createRequire(path.join(project, 'package.json'));
const cache = path.join(
  project,
  'node_modules/.cache/solid-graphics/windows-x64.zip',
);
const out = path.join(project, 'work/windows');
const url =
  'https://github.com/solid-multiplatform/renderer/releases/download/v0.2.0-preview.1/windows-graphics-runtime-x64.zip';
let data = existsSync(cache) ? readFileSync(cache) : null;
if (!data) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error('Windows graphics download failed: ' + response.status);
  data = Buffer.from(await response.arrayBuffer());
}
if (
  createHash('sha256').update(data).digest('hex') !==
  '67a0972eadebe56b63a9184b734ea3ced80484876c11dfd9f20e26f96bb5249d'
)
  throw new Error('Invalid Windows graphics bundle');
mkdirSync(path.dirname(cache), { recursive: true });
writeFileSync(cache, data);
const files = require('fflate').unzipSync(data);
for (const [name, contents] of Object.entries(files)) {
  const dest = path.resolve(out, name);
  if (!dest.startsWith(out + path.sep))
    throw new Error('Invalid runtime asset path');
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, contents);
}
