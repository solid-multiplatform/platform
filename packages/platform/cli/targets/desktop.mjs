// @ts-check
// The desktop target: a Rust runtime embedding Hermes, bundled by the
// desktop host's own CLI. Node builds; the runtime runs the app.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from '../context.mjs';
import { hostDesktopPackage } from '../host-desktop.mjs';
import { buildTarget, commonChecks, missing, ok } from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */

/** The host package's runtime module, when the app (or this checkout) has it.
 * @param {string} root
 */
async function hostRuntime(root) {
  const dir = hostDesktopPackage(root);
  if (dir === undefined) return undefined;
  return import(pathToFileURL(path.join(dir, 'cli/runtime.mjs')).href);
}

/** @type {import('../types.d.ts').TargetDefinition} */
export default {
  name: 'desktop',
  family: 'desktop',
  summary: 'Linux, Windows and macOS (native Hermes runtime, WebGL renderer)',

  async doctor(ctx) {
    const checks = commonChecks(ctx);
    const host = await hostRuntime(ctx.root);
    if (host === undefined) {
      checks.push(
        missing(
          'host-desktop',
          'run `solid-platform add desktop` in the app, then install its dependencies',
        ),
      );
      return checks;
    }
    const platform = host.platformName;
    let runtime;
    try {
      runtime = host.locateRuntime();
    } catch (error) {
      checks.push(missing('runtime', /** @type {Error} */ (error).message));
      return checks;
    }
    if (runtime !== undefined) {
      checks.push(
        ok('runtime', `${runtime.path} (${runtime.source}), for ${platform}`),
      );
    } else {
      const source = host.sourceBuild();
      checks.push(
        source.possible
          ? ok(
              'runtime',
              `will be built from source for ${platform} (cargo, HERMES_SRC and HERMES_BUILD are set)`,
            )
          : missing(
              'runtime',
              `set SOLID_DESKTOP_RUNTIME, run \`solid-platform add desktop none\` to fetch ${platform}, or build from source (HERMES_SRC and HERMES_BUILD set, cargo installed)`,
            ),
      );
    }
    return checks;
  },

  build(ctx, options) {
    buildTarget(ctx, 'desktop', options);
  },

  run(ctx, options) {
    if (options.build !== false) buildTarget(ctx, 'desktop', {});
    const out = path.join(ctx.root, 'targets/desktop/work/bundle/app.hbc');
    if (!ctx.exists(out))
      throw new CliError(
        'No desktop build at targets/desktop/work/bundle. Run `solid-platform build desktop`.',
      );
    const cli = path.join(
      /** @type {string} */ (hostDesktopPackage(ctx.root)),
      'cli/index.mjs',
    );
    const titleBar = ctx.config.desktop?.titleBar;
    const result = ctx.exec(
      process.execPath,
      [cli, 'run', out, ...(titleBar ? [`--title-bar=${titleBar}`] : [])],
      {
        cwd: path.join(ctx.root, 'targets/desktop/work'),
        stdio: 'inherit',
      },
    );
    if (result.status !== 0)
      throw new CliError('The desktop app exited with ' + result.status);
  },

  package(ctx) {
    buildTarget(ctx, 'desktop', {});
    const config = ctx.config;
    const work = path.join(ctx.root, 'targets/desktop/work');
    const cli = path.join(
      /** @type {string} */ (hostDesktopPackage(ctx.root)),
      'cli/package.mjs',
    );
    const assets = path.join(work, 'fonts');
    const result = ctx.exec(
      process.execPath,
      [
        cli,
        path.join(work, 'entry.tsx'),
        '--app-id',
        config.id ?? 'dev.solidapp.desktop',
        '--name',
        config.name ?? 'solid-app',
        '--version',
        config.version ?? '0.1.0',
        '--out',
        path.join(ctx.root, 'targets/desktop/dist'),
        ...(ctx.exists(assets) ? ['--assets', assets] : []),
        ...(config.desktop?.titleBar
          ? [`--title-bar=${config.desktop.titleBar}`]
          : []),
      ],
      { cwd: work, stdio: 'inherit' },
    );
    if (result.status !== 0)
      throw new CliError(
        'Packaging the desktop app failed (' + result.status + ')',
      );
  },
};
