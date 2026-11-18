// The images the Roku SceneGraph backend draws with: every `pkg:/` path the
// backend names is a file that ships, and the generator reproduces the
// committed images byte for byte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderAssets, SHADOW_BLURS, SHADOW_RADII, shadowLayout } from '../roku/assets/generate.mjs';

const roku = fileURLToPath(new URL('../roku/', import.meta.url));
const generated = path.join(roku, 'assets');
// What the Roku host puts in every channel beside the generated images.
const hostPkg = fileURLToPath(new URL('../../platform/hosts/roku/pkg/', import.meta.url));

/** Where a `pkg:/` path comes from in this repository. */
function shipped(uri) {
  const file = uri.slice('pkg:/'.length);
  return file.startsWith('assets/smp/')
    ? path.join(generated, file.slice('assets/smp/'.length))
    : path.join(hostPkg, file);
}

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(path.join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [path.join(dir, entry.name)]
        : [],
  );
}

test('every pkg:/ path the backend names resolves to a shipped file', () => {
  const missing = [];
  let found = 0;
  for (const file of sources(roku)) {
    // A path with a file extension; `'pkg:/' + x` prefixes are not paths.
    for (const [uri] of readFileSync(file, 'utf8').matchAll(/pkg:\/[\w\-./]*\.[a-z0-9]+/g)) {
      found++;
      if (!existsSync(shipped(uri))) missing.push(`${path.relative(roku, file)}: ${uri}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(found > 20, 'the scan found the asset and font paths');
});

test('ASSETS names every generated image and nothing else', async () => {
  const { ASSETS } = await import('../dist/roku/assets.js');
  const named = Object.values(ASSETS).flatMap((value) =>
    typeof value === 'string' ? [value] : Object.values(value),
  );
  const names = named.map((uri) => uri.replace('pkg:/assets/smp/', '')).sort();
  assert.deepEqual(names, [...renderAssets().keys()].sort());
  assert.deepEqual(names, readdirSync(generated).filter((name) => name.endsWith('.png')).sort());
});

test('generate.mjs reproduces the committed images byte for byte', () => {
  for (const [name, bytes] of renderAssets()) {
    const committed = readFileSync(path.join(generated, name));
    assert.ok(committed.equals(bytes), name + ' differs from what generate.mjs writes');
  }
});

test('a shadow request quantises to the nearest shipped radius and blur', async () => {
  const { shadowAsset, SHADOW_RADII: radii, SHADOW_BLURS: blurs } = await import('../dist/roku/assets.js');
  // The runtime tables are the generator's.
  assert.deepEqual([radii, blurs], [SHADOW_RADII, SHADOW_BLURS]);
  assert.deepEqual(shadowAsset(16, 16), { uri: 'pkg:/assets/smp/shadow-r16-b16.9.png', radius: 16, blur: 16 });
  assert.deepEqual(shadowAsset(13, 20), { uri: 'pkg:/assets/smp/shadow-r16-b16.9.png', radius: 16, blur: 16 });
  assert.deepEqual(shadowAsset(0, 0), { uri: 'pkg:/assets/smp/shadow-r0-b4.9.png', radius: 0, blur: 4 });
  assert.deepEqual(shadowAsset(500, 500), { uri: 'pkg:/assets/smp/shadow-r64-b32.9.png', radius: 64, blur: 32 });
});

test('a shadow image is a 9-patch whose middle stretches', () => {
  const bytes = renderAssets().get('shadow-r16-b8.9.png');
  // IHDR: width and height at bytes 16 and 20.
  const { cell, size } = shadowLayout(16, 8);
  assert.equal(cell, 24);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [size + 2, size + 2]);
});
