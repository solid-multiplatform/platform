// Contract test: the SDK does not reach for the browser on its own.
//
// SDK functions get device features from the service registry; the browser's
// implementations live in src/hosts/web-services and only the web host
// installs them. A `navigator`, `document`, `window`, `screen` or `matchMedia`
// reference in src/sdk is therefore a fallback that runs by accident on hosts
// that fake those globals. This scan keeps them from coming back.
import * as v from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../src/sdk');

/** Modules that exist for the browser, by name and purpose. */
const WEB_ONLY = [
  'browser-viewport.ts',
  'cursor.ts',
  'gamepad.ts',
  'pwa.ts',
  'web-controls.ts',
];

/**
 * Host-neutral modules holding one browser-only function, named for it. The
 * count is how many references the file has today: it may go down, never up.
 */
const PINNED: Record<string, { count: number; where: string }> = {
  'editor.ts': { count: 2, where: 'browserEditorHost' },
  'input.ts': { count: 1, where: 'bindPointerEvents' },
  'navigation.ts': {
    count: 2,
    where: 'bindBrowserHistory, createBrowserNavigation',
  },
  'semantics.ts': { count: 2, where: 'browserSemantics' },
};

// A reference to the global: not a member (`options.window`) and not a
// property key (`window?: Target`, `{ window: target }`).
const GLOBAL =
  /(?<![.\w$])(?:navigator|document|window|screen|matchMedia)(?![\w$]|\??:)/g;

/** The code of a source file: no comments, no quoted strings. */
const code = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/\/\/.*$/gm, '');

const references = (file: string): number =>
  (code(readFileSync(join(sdk, file), 'utf8')).match(GLOBAL) ?? []).length;

const files = readdirSync(sdk).filter((name) => /\.tsx?$/.test(name));

v.describe('src/sdk and browser globals', () => {
  v.it('finds references in code, not in comments or strings', () => {
    v.expect(
      code(
        "// window\n/* document */ const a = 'navigator'; b.window; ({ window: 1 }); window.open();",
      ).match(GLOBAL),
    ).toEqual(['window']);
  });

  v.it(
    'no SDK module references a browser global, except the listed ones',
    () => {
      const offenders = files
        .filter((file) => !WEB_ONLY.includes(file) && !(file in PINNED))
        .filter((file) => references(file) > 0);
      v.expect(offenders).toEqual([]);
    },
  );

  v.it('the listed exceptions do not grow', () => {
    const counts = Object.fromEntries(
      Object.keys(PINNED).map((file) => [file, references(file)]),
    );
    v.expect(counts).toEqual(
      Object.fromEntries(
        Object.entries(PINNED).map(([file, pin]) => [file, pin.count]),
      ),
    );
  });

  v.it('every listed module still exists and still needs its entry', () => {
    for (const file of WEB_ONLY) {
      v.expect(files, file).toContain(file);
      v.expect(references(file), file).toBeGreaterThan(0);
    }
  });
});
