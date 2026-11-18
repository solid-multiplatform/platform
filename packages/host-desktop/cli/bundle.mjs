#!/usr/bin/env node
// Turns an app entry into the one script the desktop runtime runs, and
// optionally into Hermes bytecode, compiled by the runtime itself.
//
//   node cli/bundle.mjs <entry> --out <file.js> [--bytecode] [--minify]
//                                 [--runtime <solid-desktop>]
//
// With --bytecode, <file>.hbc is written next to <file.js>; the runtime runs
// either. Node is a build tool here only: nothing of it reaches the app.
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, '../..');

/**
 * The build tools. They are this package's own dev dependencies; in a
 * checkout where it has not been installed yet they are taken from where the
 * platform package's test tooling gets them: Babel and the Solid preset from
 * vite-plugin-solid, esbuild from Vite.
 */
function tool(name) {
  const platform = createRequire(path.join(packages, 'platform/package.json'));
  const places = [
    () => createRequire(import.meta.url),
    () => createRequire(platform.resolve('vite-plugin-solid')),
    () => createRequire(platform.resolve('vite')),
  ];
  for (const place of places) {
    try {
      return place().resolve(name);
    } catch {
      // Not there: the next place.
    }
  }
  throw new Error(
    `Cannot find ${name}: run "corepack pnpm install" in the workspace`,
  );
}
const load = async (name) => {
  const module = await import(pathToFileURL(tool(name)).href);
  return module.default ?? module;
};

// Workspace packages are bundled from their TypeScript sources, so the
// bundle needs no build of them first. Some of their exports name only the
// built file; its source has the same path without `dist/`.
const WORKSPACE = {
  '@solid-multiplatform/renderer': path.join(packages, 'renderer'),
  '@solid-multiplatform/platform': path.join(packages, 'platform'),
  '@solid-multiplatform/host-desktop': path.join(packages, 'host-desktop'),
};
const CONDITIONS = [
  '@solidtv/source',
  '@solid-multiplatform/renderer-source',
  'browser',
  'import',
  'default',
];

function exportTarget(node) {
  if (typeof node === 'string') return node;
  if (node === null || typeof node !== 'object') return undefined;
  for (const [condition, target] of Object.entries(node)) {
    if (!CONDITIONS.includes(condition)) continue;
    const found = exportTarget(target);
    if (found !== undefined) return found;
  }
  return undefined;
}

const manifests = new Map();
function workspaceSource(name, subpath) {
  const directory = WORKSPACE[name];
  if (!manifests.has(name)) {
    manifests.set(
      name,
      JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')),
    );
  }
  const target = exportTarget(manifests.get(name).exports?.[subpath]);
  if (target === undefined) {
    throw new Error(`${name} does not export "${subpath}"`);
  }
  const built = path.join(directory, target);
  const stem = path
    .join(directory, target.replace(/^\.\/dist\//, './'))
    .replace(/\.jsx?$/, '');
  for (const candidate of [stem + '.ts', stem + '.tsx', built]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${name}: neither ${built} nor its source exists`);
}

function workspacePlugin() {
  return {
    name: 'solid-desktop-workspace',
    setup(build) {
      build.onResolve({ filter: /^@solid-multiplatform\// }, (args) => {
        const [scope, name, ...rest] = args.path.split('/');
        const id = `${scope}/${name}`;
        if (!(id in WORKSPACE) || !existsSync(WORKSPACE[id])) return undefined;
        return {
          path: workspaceSource(id, rest.length ? './' + rest.join('/') : '.'),
        };
      });
    },
  };
}

/** Solid's JSX, compiled for the universal renderer the platform exports. */
function solidPlugin(babel, preset) {
  return {
    name: 'solid-desktop-jsx',
    setup(build) {
      build.onLoad({ filter: /\.[tj]sx$/ }, async ({ path: file }) => {
        const typescript = file.endsWith('.tsx');
        const result = await babel.transformAsync(
          await readFile(file, 'utf8'),
          {
            filename: file,
            configFile: false,
            babelrc: false,
            sourceMaps: false,
            parserOpts: {
              plugins: typescript ? ['jsx', 'typescript'] : ['jsx'],
            },
            presets: [
              [
                preset,
                {
                  generate: 'universal',
                  moduleName: '@solid-multiplatform/platform',
                },
              ],
            ],
          },
        );
        // Types are still there: esbuild removes them.
        return { contents: result.code, loader: typescript ? 'ts' : 'js' };
      });
    },
  };
}

/** The runtime this checkout builds. */
export const defaultRuntime = path.resolve(
  here,
  '../native/target/release/solid-desktop',
);

/**
 * Bundle `entry` into `outfile`. With `bytecode`, also compile it with
 * `runtime` and return the bytecode's path; the script's otherwise.
 */
export async function bundle({
  entry,
  outfile,
  bytecode = false,
  minify = false,
  runtime = defaultRuntime,
}) {
  const esbuild = await load('esbuild');
  const babel = await load('@babel/core');
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'neutral',
    // What Hermes runs as written; nothing is lowered.
    target: 'es2022',
    mainFields: ['module', 'main'],
    conditions: CONDITIONS.filter((c) => c !== 'import' && c !== 'default'),
    minify,
    legalComments: 'none',
    logLevel: 'warning',
    define: {
      'import.meta.env': '{}',
      SOLIDTV_DOM_RENDERING: 'false',
      __DEV__: 'false',
      __enableInspector__: 'false',
      __emitBoundsEvents__: 'false',
    },
    plugins: [
      workspacePlugin(),
      solidPlugin(babel, tool('babel-preset-solid')),
    ],
  });
  if (!bytecode) return outfile;
  const compiled = outfile.replace(/\.[cm]?js$/, '') + '.hbc';
  execFileSync(runtime, ['--compile', outfile, compiled], { stdio: 'inherit' });
  return compiled;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 1)[0];
  };
  const value = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 2)[1];
  };
  const outfile = value('--out');
  const runtime = value('--runtime');
  const bytecode = flag('--bytecode') !== undefined;
  const minify = flag('--minify') !== undefined;
  if (args.length !== 1 || outfile === undefined) {
    console.error(
      'usage: bundle.mjs <entry> --out <file.js> [--bytecode] [--minify] [--runtime <solid-desktop>]',
    );
    process.exit(2);
  }
  const written = await bundle({
    entry: path.resolve(args[0]),
    outfile: path.resolve(outfile),
    bytecode,
    minify,
    ...(runtime ? { runtime: path.resolve(runtime) } : {}),
  });
  console.log(written);
}
