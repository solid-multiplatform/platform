// @ts-check
// Roku builds a sideloadable ZIP. Device commands go through
// cli/roku-device.mjs to the Roku named by ROKU_DEV_IP, ROKU_DEV_USERNAME and
// ROKU_DEV_PASSWORD. Nothing here prints those values or the device address.
import path from 'node:path';
import { CliError } from '../context.mjs';
import {
  buildTarget,
  commonChecks,
  missing,
  ok,
  rokuDeviceModule,
} from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */

/**
 * Runs one device call. A failure is reported without the network error's
 * own text, which names the address.
 * @template T
 * @param {string} what
 * @param {() => Promise<T>} call
 * @returns {Promise<T>}
 */
async function onDevice(what, call) {
  try {
    return await call();
  } catch (error) {
    const failure = /** @type {Error & { cause?: { code?: string } }} */ (error);
    const code = failure.cause?.code ?? /** @type {any} */ (failure).code;
    throw new CliError(
      typeof code === 'string'
        ? `${what} failed: the configured Roku did not answer (${code}).`
        : `${what} failed: ${failure.message}`,
    );
  }
}

/** @param {TargetContext} ctx */
async function connect(ctx) {
  const roku = await rokuDeviceModule(ctx);
  try {
    return { roku, device: roku.rokuDevice(ctx.env) };
  } catch (error) {
    throw new CliError(/** @type {Error} */ (error).message);
  }
}

/** @type {import('../types.d.ts').TargetDefinition} */
export default {
  name: 'roku',
  family: 'roku',
  summary: 'Roku players and TVs (SceneGraph on Hermes)',

  doctor(ctx) {
    const checks = commonChecks(ctx);
    checks.push(
      ctx.which('python3')
        ? ok('python3', 'found')
        : missing('python3', 'install Python 3; the build zips the app with it'),
    );
    for (const variable of ['ROKU_DEV_IP', 'ROKU_DEV_PASSWORD'])
      checks.push(
        ctx.env[variable]
          ? ok(variable, 'set')
          : missing(
              variable,
              'not set; run, logs, screenshot and devices need it (the build does not)',
              false,
            ),
      );
    checks.push(
      ok(
        'ROKU_DEV_USERNAME',
        ctx.env.ROKU_DEV_USERNAME ? 'set' : 'not set; the default is used',
      ),
    );
    return checks;
  },

  build(ctx, options) {
    buildTarget(ctx, 'roku', options);
  },

  async devices(ctx) {
    if (!ctx.env.ROKU_DEV_IP || !ctx.env.ROKU_DEV_PASSWORD) {
      ctx.out(
        'roku  no device configured; set ROKU_DEV_IP and ROKU_DEV_PASSWORD',
      );
      return;
    }
    const { roku, device } = await connect(ctx);
    const info = await onDevice('Reading the Roku', () =>
      roku.deviceInfo(device),
    );
    ctx.out(
      `roku  configured device  ${info.model ?? 'unknown model'}  Roku OS ${info.softwareVersion ?? 'unknown'}  developer mode ${info.developerEnabled ? 'on' : 'off'}`,
    );
  },

  async run(ctx, options) {
    // Fail on a missing device before spending a build on it.
    const { roku, device } = await connect(ctx);
    if (options.build !== false) buildTarget(ctx, 'roku');
    const dist = path.join(ctx.root, 'targets/roku/dist-roku');
    const zips = ctx.readdir(dist).filter((file) => file.endsWith('.zip'));
    if (zips.length !== 1)
      throw new CliError(
        zips.length
          ? 'More than one ZIP in targets/roku/dist-roku; remove the old ones.'
          : 'No ZIP in targets/roku/dist-roku. Run `solid-platform build roku`.',
      );
    const zip = path.join(dist, /** @type {string} */ (zips[0]));
    await onDevice('Sideloading', () => roku.sideload(device, zip));
    await onDevice('Launching', () => roku.launch(device, 'dev'));
    ctx.out('Sideloaded and launched ' + zips[0] + ' on the configured Roku');
  },

  async logs(ctx, options) {
    const { roku, device } = await connect(ctx);
    const reading = roku.readConsole(
      device,
      (line) => {
        ctx.out(line);
      },
      options.timeoutMs ?? 24 * 60 * 60 * 1000,
    );
    await onDevice('Reading the console', () => reading.done);
  },

  async screenshot(ctx, options) {
    const { roku, device } = await connect(ctx);
    const image = await onDevice('Taking a screenshot', () =>
      roku.screenshot(device),
    );
    ctx.writeFile(options.file, image);
    ctx.out(`Wrote ${options.file}`);
  },
};
