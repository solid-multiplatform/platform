// Package hygiene: tsc emits `.jsx` for `.tsx` sources under `jsx: preserve`.
// A relative import that resolves to a `.tsx` file must therefore say `.jsx`;
// saying `.js` builds locally through the bundler but breaks Node ESM consumers.
import * as v from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')
        ? [path]
        : [];
  });

const builtFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? builtFiles(path)
      : /\.(js|jsx)$/.test(entry)
        ? [path]
        : [];
  });

const relativeImports = (text: string): string[] =>
  [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+\.jsx?)['"]/g)].map(
    (match) => match[1]!,
  );

v.describe('source import extensions', () => {
  v.it('imports .tsx modules with .jsx, not .js', () => {
    const problems: string[] = [];
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      for (const specifier of relativeImports(text)) {
        if (!specifier.endsWith('.js')) continue;
        const target = resolve(dirname(file), specifier);
        const tsx = target.replace(/\.js$/, '.tsx');
        const ts = target.replace(/\.js$/, '.ts');
        if (!existsSync(ts) && existsSync(tsx)) {
          problems.push(
            `${file.slice(root.length + 1)} imports ${specifier} (emits .jsx)`,
          );
        }
      }
    }
    v.expect(problems).toEqual([]);
  });

  v.it('dist imports resolve when dist has been built', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return;
    const problems: string[] = [];
    for (const file of builtFiles(dist)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const specifier = match[1]!;
        if (!existsSync(resolve(dirname(file), specifier))) {
          problems.push(`${file.slice(dist.length + 1)} imports ${specifier}`);
        }
      }
    }
    v.expect(problems).toEqual([]);
  });
});
