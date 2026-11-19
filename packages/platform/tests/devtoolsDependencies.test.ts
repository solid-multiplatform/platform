// The published `/devtools` entry imports packages at runtime. Each must be
// a dependency or a peer dependency, or the entry cannot resolve in an app.
import * as v from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

function bareImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
    const parts = match[1]!.split('/');
    found.push(
      parts[0]!.startsWith('@') ? parts[0] + '/' + parts[1] : parts[0]!,
    );
  }
  return found;
}

v.test('every package src/devtools imports is declared', () => {
  const dir = root + 'src/devtools/';
  const imported = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    for (const dep of bareImports(dir + name)) imported.add(dep);
  }
  v.expect([...imported].sort()).toEqual(['@solid-devtools/debugger', 'vite']);
  for (const dep of imported) {
    v.expect(
      pkg.dependencies?.[dep] ?? pkg.peerDependencies?.[dep],
      dep,
    ).toBeTypeOf('string');
    // Only the devtools entry needs them: optional for every other app.
    v.expect(pkg.peerDependenciesMeta?.[dep]?.optional, dep).toBe(true);
  }
});
