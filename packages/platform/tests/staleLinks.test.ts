// Source comments and runtime messages point at this project's docs, not at
// the site of the project this one was derived from; the generated app README
// does not describe a host's internals.
import * as v from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/';

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const file = dir + '/' + entry.name;
    if (entry.isDirectory()) files(file, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(file);
  }
  return out;
}

v.test('src and cli have no links to solid-tv.github.io', () => {
  const stale = [...files(root + 'src'), ...files(root + 'cli')].filter(
    (file) => readFileSync(file, 'utf8').includes('solid-tv.github.io'),
  );
  v.expect(stale).toEqual([]);
});

v.test('the generated app README does not promise desktop internals', () => {
  const init = readFileSync(root + 'cli/init.mjs', 'utf8');
  const readme = init.slice(init.indexOf("'README.md'"));
  const text = readme.slice(0, readme.indexOf('\n    );'));
  v.expect(text).toContain('Targets:');
  v.expect(text).not.toMatch(/SDL|Node|koffi|Python|WebGL/);
});
