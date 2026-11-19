#!/usr/bin/env node
// The desktop target's commands, as functions for the platform CLI and as a
// script:
//
//   node cli/index.mjs doctor
//   node cli/index.mjs build <entry> --out <dir> [--bytecode] [--minify] [--assets <path>]...
//   node cli/index.mjs run <entry | script.js | script.hbc> [--headless] [-- <argument>...]
//   node cli/index.mjs package <entry> --app-id <id> --name <name> --version <v> --out <dir> ...
//
// Node is the build tool only. What runs the app is the runtime's executable
// (./runtime.mjs says where it is found), which contains no Node.
import path from 'node:path';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';
import {
  builtRuntime,
  findRuntime,
  locateRuntime,
  platformName,
  prebuiltRuntime,
  runtimeDiagnostics,
  sourceBuild,
} from './runtime.mjs';

export { packageDesktop } from './package.mjs';
export {
  findRuntime,
  locateRuntime,
  platformName,
  prebuiltRuntime,
  runtimeDiagnostics,
} from './runtime.mjs';

/**
 * @typedef {object} DoctorCheck
 * @property {string} name
 * @property {boolean} ok
 * @property {boolean} required Whether running an app needs it.
 * @property {string} detail
 *
 * @typedef {object} DoctorReport
 * @property {boolean} ok Every required check passed.
 * @property {string} platform `linux-x64` and the like.
 * @property {string | undefined} runtime The runtime that would be used.
 * @property {DoctorCheck[]} checks
 */

/**
 * What this machine has for the desktop target. Builds nothing and starts
 * no window.
 *
 * @returns {DoctorReport}
 */
export function doctorDesktop() {
  /** @type {DoctorCheck[]} */
  const checks = [];
  let runtime;
  const source = sourceBuild();
  try {
    const located = locateRuntime();
    if (located !== undefined) {
      runtime = located.path;
      const made = runtimeDiagnostics(runtime);
      checks.push({
        name: 'runtime',
        ok: true,
        required: true,
        detail: `${runtime} (${located.source}): solid-desktop ${made.version}, SDL ${made.sdl} ${made.sdlLinkage}, video drivers ${made.videoDrivers.join(' ')}`,
      });
    } else if (source.possible) {
      runtime = builtRuntime;
      checks.push({
        name: 'runtime',
        ok: true,
        required: true,
        detail: existsSync(builtRuntime)
          ? `${builtRuntime} (built from source; rebuilt when its sources change)`
          : 'not built yet: it will be built from source on first use',
      });
    } else {
      checks.push({
        name: 'runtime',
        ok: false,
        required: true,
        detail: `none for ${platformName}: set SOLID_DESKTOP_RUNTIME, or put one at ${prebuiltRuntime}, or build from source`,
      });
    }
  } catch (error) {
    checks.push({
      name: 'runtime',
      ok: false,
      required: true,
      detail: error.message,
    });
  }
  checks.push({
    name: 'build from source',
    ok: source.possible,
    required: false,
    detail: source.possible
      ? 'cargo, HERMES_SRC and HERMES_BUILD are there'
      : source.missing.join('; '),
  });
  const tar = spawnSync('tar', ['--version']).status === 0;
  checks.push({
    name: 'packaging',
    ok: tar && platformName === 'linux-x64',
    required: false,
    detail:
      platformName !== 'linux-x64'
        ? `packaging on ${platformName} is not implemented`
        : tar
          ? 'tar is there; no AppImage is built'
          : 'tar is not installed',
  });
  return {
    ok: checks.every((check) => check.ok || !check.required),
    platform: platformName,
    runtime,
    checks,
  };
}

/**
 * @typedef {object} BuildOptions
 * @property {string} entry The app's entry module.
 * @property {string} outDir Where `app.js` (and `app.hbc`) are written.
 * @property {boolean} [bytecode] Also compile to Hermes bytecode.
 * @property {boolean} [minify]
 * @property {string[]} [assets] Files and directories copied beside the
 *   script under their own names, where the app looks for them.
 * @property {string} [runtime] Needed for bytecode only; found when absent.
 *
 * @typedef {object} BuildResult
 * @property {string} directory
 * @property {string} script What the runtime runs: the bytecode if made.
 */

/**
 * Bundle an app into a directory the runtime can run it from.
 *
 * @param {BuildOptions} options
 * @returns {Promise<BuildResult>}
 */
export async function buildDesktop(options) {
  const {
    entry,
    outDir,
    bytecode = false,
    minify = false,
    assets = [],
  } = options;
  if (!entry || !outDir) {
    throw new Error('buildDesktop: "entry" and "outDir" are required');
  }
  const directory = path.resolve(outDir);
  mkdirSync(directory, { recursive: true });
  const script = await bundle({
    entry: path.resolve(entry),
    outfile: path.join(directory, 'app.js'),
    bytecode,
    minify,
    ...(bytecode ? { runtime: options.runtime ?? findRuntime() } : {}),
  });
  for (const asset of assets) {
    cpSync(asset, path.join(directory, path.basename(asset)), {
      recursive: true,
    });
  }
  return { directory, script };
}

/**
 * @typedef {object} RunOptions
 * @property {string} [entry] An entry module: bundled first, into `outDir`
 *   or a temporary directory that is removed when the app ends.
 * @property {string} [script] A script or bytecode already built; instead
 *   of `entry`.
 * @property {string} [outDir]
 * @property {string[]} [assets] With `entry`: see `buildDesktop`.
 * @property {string[]} [args] The app's arguments (a URL to open it with).
 * @property {boolean} [headless] No window and no GL.
 * @property {NodeJS.ProcessEnv} [env]
 * @property {import('node:child_process').StdioOptions} [stdio] Default
 *   `inherit`.
 * @property {AbortSignal} [signal] Ends the app when aborted.
 * @property {string} [runtime]
 *
 * @typedef {object} RunningApp
 * @property {import('node:child_process').ChildProcess} process
 * @property {Promise<number>} exit The app's exit status; rejects if the
 *   runtime could not be started.
 */

/**
 * Start an app in the runtime. The window opens on the display of the
 * environment given: the caller decides which.
 *
 * @param {RunOptions} options
 * @returns {Promise<RunningApp>}
 */
export async function runDesktop(options) {
  const { entry, args = [], headless = false, stdio = 'inherit' } = options;
  if ((entry === undefined) === (options.script === undefined)) {
    throw new Error('runDesktop: give either "entry" or "script"');
  }
  const runtime = options.runtime ?? findRuntime();
  let script = options.script;
  let temporary;
  if (entry !== undefined) {
    if (options.outDir === undefined) {
      temporary = mkdtempSync(path.join(tmpdir(), 'solid-desktop-run-'));
    }
    ({ script } = await buildDesktop({
      entry,
      outDir: options.outDir ?? temporary,
      assets: options.assets,
    }));
  }
  const child = spawn(
    runtime,
    [...(headless ? ['--headless'] : []), '--script', script, '--', ...args],
    { stdio, env: options.env ?? process.env, signal: options.signal },
  );
  const exit = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      // An abort is the caller ending the app, not a failure to start it.
      if (error.name === 'AbortError') return;
      reject(error);
    });
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  }).finally(() => {
    if (temporary !== undefined) {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  return { process: child, exit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? false : args.splice(at, 1).length === 1;
  };
  const value = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 2)[1];
  };
  const values = (name) => {
    const all = [];
    for (let one; (one = value(name)) !== undefined; ) all.push(one);
    return all;
  };
  const usage = () => {
    console.error(
      'usage: index.mjs doctor\n' +
        '       index.mjs build <entry> --out <dir> [--bytecode] [--minify] [--assets <path>]...\n' +
        '       index.mjs run <entry | script.js | script.hbc> [--headless] [--assets <path>]... [-- <argument>...]\n' +
        '       index.mjs package <entry> ... (see package.mjs)',
    );
    process.exit(2);
  };
  try {
    if (command === 'doctor') {
      const report = doctorDesktop();
      for (const check of report.checks) {
        const mark = check.ok
          ? 'ok     '
          : check.required
            ? 'MISSING'
            : 'absent ';
        console.log(`${mark} ${check.name}: ${check.detail}`);
      }
      process.exit(report.ok ? 0 : 1);
    } else if (command === 'build') {
      const options = {
        outDir: value('--out'),
        bytecode: flag('--bytecode'),
        minify: flag('--minify'),
        assets: values('--assets'),
      };
      if (args.length !== 1 || options.outDir === undefined) usage();
      console.log((await buildDesktop({ ...options, entry: args[0] })).script);
    } else if (command === 'run') {
      const separator = args.indexOf('--');
      const appArgs = separator === -1 ? [] : args.splice(separator).slice(1);
      const options = {
        headless: flag('--headless'),
        assets: values('--assets'),
        args: appArgs,
      };
      if (args.length !== 1) usage();
      const built = /\.(hbc|[cm]?js)$/.test(args[0]);
      const app = await runDesktop({
        ...options,
        ...(built ? { script: args[0] } : { entry: args[0] }),
      });
      process.exit(await app.exit);
    } else if (command === 'package') {
      // package.mjs is the script for this; it reads the same arguments.
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./package.mjs', import.meta.url)), ...args],
        { stdio: 'inherit' },
      );
      process.exit(result.status ?? 1);
    } else {
      usage();
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
