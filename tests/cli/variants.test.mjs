import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { stageSources, explain } from '../../cli/variants.mjs';

test('exact, family and shared files resolve identically for staging and explain', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'variants-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, 'src');
  mkdirSync(src);
  for (const name of [
    'Home.tsx',
    'Home.tv.tsx',
    'Home.roku.tsx',
    'Home.mobile.tsx',
    'Home.linux.tsx',
    'helper.tizen.ts',
    'styles.css',
  ])
    writeFileSync(path.join(src, name), name);
  for (const [target, chosen] of Object.entries({
    ios: 'Home.mobile.tsx',
    roku: 'Home.roku.tsx',
    webos: 'Home.tv.tsx',
    web: 'Home.tsx',
    linux: 'Home.linux.tsx',
  })) {
    const dest = path.join(root, target);
    stageSources(src, dest, target);
    assert.equal(explain(root, target, 'Home').source, chosen);
    assert.deepEqual(readdirSync(dest).sort(), ['Home.tsx', 'styles.css']);
  }
});
