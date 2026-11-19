// @ts-check
// Pieces shared by the target modules: check results, the checks every target
// needs, and the call into the build pipeline.
import { build } from './build.mjs';

/** @typedef {import('./types.d.ts').TargetContext} TargetContext */
/** @typedef {import('./types.d.ts').Check} Check */

/** @type {(name: string, detail: string) => Check} */
export const ok = (name, detail) => ({ name, status: 'ok', detail });
/** @type {(name: string, detail: string, blocksBuild?: boolean) => Check} */
export const missing = (name, detail, blocksBuild = true) => ({
  name,
  status: 'missing',
  detail,
  blocksBuild,
});
/** @type {(name: string, detail: string, blocksBuild?: boolean) => Check} */
export const skipped = (name, detail, blocksBuild = false) => ({
  name,
  status: 'skipped',
  detail,
  blocksBuild,
});

export const minimumNode = 24;

/**
 * Node and pnpm, which every target builds with.
 * @param {TargetContext} ctx
 * @returns {Check[]}
 */
export function commonChecks(ctx) {
  const major = Number(ctx.nodeVersion.split('.')[0]);
  const node =
    major >= minimumNode
      ? ok('node', 'Node ' + ctx.nodeVersion)
      : missing(
          'node',
          `Node ${ctx.nodeVersion} found; install Node ${minimumNode} or later`,
        );
  const viaCorepack = ctx.which('corepack');
  const result = viaCorepack
    ? ctx.exec('corepack', ['pnpm', '--version'])
    : ctx.which('pnpm')
      ? ctx.exec('pnpm', ['--version'])
      : undefined;
  const pnpm =
    result?.status === 0 && viaCorepack
      ? ok('pnpm', 'pnpm ' + String(result.stdout).trim() + ' through Corepack')
      : missing(
          'pnpm',
          viaCorepack
            ? 'Corepack could not start pnpm; run `corepack enable`'
            : 'builds call `corepack pnpm`; install Node with Corepack (`npm install -g corepack`)',
        );
  return [node, pnpm];
}

/**
 * Runs the existing build pipeline for one target.
 * @param {TargetContext} ctx
 * @param {string} target
 * @param {import('./types.d.ts').BuildOptions} [options]
 */
export function buildTarget(ctx, target, options = {}) {
  /** @type {NonNullable<TargetContext['buildProject']>} */
  const pipeline = ctx.buildProject ?? /** @type {any} */ (build);
  pipeline(ctx.root, target, options.dev ?? false, options.legacy ?? false);
}

/** Loads `cli/roku-device.mjs`, or the module a test supplied. */
export async function rokuDeviceModule(/** @type {TargetContext} */ ctx) {
  if (ctx.rokuDevice) return ctx.rokuDevice;
  try {
    // A variable specifier: the module ships separately from this file.
    const file = './roku-device.mjs';
    return /** @type {import('./types.d.ts').RokuDeviceModule} */ (
      await import(file)
    );
  } catch (error) {
    if (/** @type {{code?: string}} */ (error).code === 'ERR_MODULE_NOT_FOUND')
      throw new Error(
        'Roku device support (cli/roku-device.mjs) is not part of this release.',
        { cause: error },
      );
    throw error;
  }
}
