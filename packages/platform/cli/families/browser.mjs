// @ts-check
// Web and the browser TVs (Tizen, webOS, Vizio) build with Vite.
import path from 'node:path';
import { CliError } from '../context.mjs';
import { serve } from '../serve.mjs';
import {
  buildTarget,
  commonChecks,
  missing,
  ok,
  skipped,
} from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */

/** The Tizen security profile: the config first, then the variable builds have always read. */
export const tizenProfile = (/** @type {TargetContext} */ ctx) => {
  let configured;
  try {
    configured = ctx.config.signing.tizen?.profile;
  } catch {
    // Outside an app directory there is no config to read.
  }
  return configured || ctx.env.TIZEN_SECURITY_PROFILE;
};

/**
 * @param {'web' | 'tizen' | 'webos' | 'vizio' | 'ps4'} name
 * @param {string} summary
 * @returns {import('../types.d.ts').TargetDefinition}
 */
export function browserTarget(name, summary) {
  /** @type {import('../types.d.ts').TargetDefinition} */
  const target = {
    name,
    family: name === 'web' ? 'web' : 'browser-tv',
    summary,

    doctor(ctx) {
      const checks = commonChecks(ctx);
      if (name === 'tizen') {
        if (!tizenProfile(ctx))
          checks.push(
            skipped(
              'tizen-cli',
              'no signing profile, so the build stops at an unsigned app directory; set signing.tizen.profile to make a .wgt',
            ),
          );
        else
          checks.push(
            ctx.which('tizen')
              ? ok('tizen-cli', 'found')
              : missing(
                  'tizen-cli',
                  'a signing profile is set; install Tizen Studio and add its `tizen` CLI to PATH',
                ),
          );
      }
      if (name === 'webos') {
        const local = path.join(
          ctx.root,
          'targets/webos/node_modules/.bin/ares-package',
        );
        checks.push(
          ctx.exists(local)
            ? ok('webos-cli', 'ares-package installed in targets/webos')
            : skipped(
                'webos-cli',
                'ares-package is a dependency of targets/webos; the first build installs it',
              ),
        );
      }
      return checks;
    },

    build(ctx, options) {
      buildTarget(ctx, name, options);
    },
  };

  if (name === 'web')
    target.run = async (ctx, options) => {
      if (options.build !== false) buildTarget(ctx, name);
      const dist = path.join(ctx.root, 'targets/web/dist');
      if (!ctx.exists(path.join(dist, 'index.html')))
        throw new CliError(
          'No build at targets/web/dist. Run `solid-platform build web`.',
        );
      const server = await serve(dist, options.port ?? 0);
      ctx.out(`Serving targets/web/dist at ${server.url} (Ctrl+C to stop)`);
      return server;
    };

  // A release build of these two already ends in tv-package.mjs.
  if (name === 'tizen' || name === 'webos')
    target.package = (ctx, options) => {
      buildTarget(ctx, name, { legacy: options.legacy });
      const dist = options.legacy ? 'dist-legacy' : 'dist';
      ctx.out(
        name === 'webos'
          ? `Packaged targets/webos/${dist}-package`
          : tizenProfile(ctx)
            ? `Packaged a signed .wgt in targets/tizen/${dist}`
            : `Wrote the unsigned app to targets/tizen/${dist}; set signing.tizen.profile to make a .wgt`,
      );
    };
  return target;
}
