// @ts-check
// iOS and tvOS build with Xcode through NativeScript, so they need macOS.
import path from 'node:path';
import { CliError, run } from '../context.mjs';
import {
  buildTarget,
  commonChecks,
  missing,
  ok,
  skipped,
} from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */

/**
 * Simulators of one runtime (`iOS` or `tvOS`) from `xcrun simctl list devices available -j`.
 * @param {string} json
 * @param {string} runtime
 * @returns {{ udid: string, name: string, state: string, runtime: string }[]}
 */
export function parseSimulators(json, runtime) {
  const devices = JSON.parse(json).devices ?? {};
  return Object.keys(devices)
    .filter((key) => key.includes('.' + runtime + '-'))
    .sort()
    .reverse()
    .flatMap((key) =>
      devices[key].map((/** @type {any} */ device) => ({
        udid: device.udid,
        name: device.name,
        state: device.state,
        runtime: key.split('.').pop() ?? key,
      })),
    );
}

/**
 * @param {'ios' | 'apple-tv'} name
 * @returns {import('../types.d.ts').TargetDefinition}
 */
export function appleTarget(name) {
  const runtime = name === 'ios' ? 'iOS' : 'tvOS';
  /** @param {TargetContext} ctx @param {string} command */
  const needsMac = (ctx, command) => {
    if (ctx.platform !== 'darwin')
      throw new CliError(`${command} ${name} needs macOS.`);
  };
  /** @param {TargetContext} ctx */
  const simulators = (ctx) =>
    parseSimulators(
      run(
        ctx,
        'xcrun',
        ['simctl', 'list', 'devices', 'available', '-j'],
        'xcrun simctl list',
      ),
      runtime,
    );
  return {
    name,
    family: 'apple',
    summary:
      name === 'ios'
        ? 'iPhone and iPad (NativeScript, needs macOS)'
        : 'Apple TV (NativeScript, needs macOS)',

    doctor(ctx) {
      if (ctx.platform !== 'darwin')
        return [skipped('xcode', 'needs macOS', true)];
      const checks = commonChecks(ctx);
      const xcode = ctx.exec('xcodebuild', ['-version']);
      checks.push(
        xcode.status === 0
          ? ok('xcode', String(xcode.stdout).split('\n')[0] ?? 'Xcode')
          : missing('xcode', 'install Xcode and run `xcode-select --install`'),
      );
      const simctl = ctx.exec('xcrun', ['simctl', 'help']);
      checks.push(
        simctl.status === 0
          ? ok('simulator', 'simctl available')
          : missing(
              'simulator',
              `install the ${runtime} simulator runtime in Xcode; run needs it`,
              false,
            ),
      );
      return checks;
    },

    build(ctx, options) {
      needsMac(ctx, 'build');
      buildTarget(ctx, name, options);
    },

    devices(ctx) {
      if (ctx.platform !== 'darwin') {
        ctx.out(`${name}  needs macOS`);
        return;
      }
      const found = simulators(ctx);
      if (!found.length) ctx.out(`${name}  no ${runtime} simulator installed`);
      for (const s of found)
        ctx.out(
          `${name}  simulator  ${s.udid}  ${s.state.toLowerCase()}  ${s.name} (${s.runtime})`,
        );
    },

    run(ctx, options) {
      needsMac(ctx, 'run');
      if (options.build !== false) buildTarget(ctx, name);
      const platforms = path.join(ctx.root, 'targets', name, 'platforms');
      const app = run(
        ctx,
        'find',
        [platforms, '-path', '*/Debug-*simulator/*.app', '-type', 'd'],
        'Finding the built app',
      )
        .split('\n')
        .find(Boolean);
      if (!app)
        throw new CliError(
          `No simulator build under targets/${name}/platforms. Run \`solid-platform build ${name}\`.`,
        );
      const bundle = run(
        ctx,
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print CFBundleIdentifier', path.join(app, 'Info.plist')],
        'Reading the bundle id',
      ).trim();
      const available = simulators(ctx);
      const simulator = options.device
        ? available.find((s) => s.udid === options.device)
        : (available.find((s) => s.state === 'Booted') ?? available[0]);
      if (!simulator)
        throw new CliError(
          options.device
            ? `Simulator ${options.device} is not available. Run \`solid-platform devices ${name}\`.`
            : `No ${runtime} simulator is installed.`,
        );
      // Booting an already booted simulator fails; that is fine.
      if (simulator.state !== 'Booted')
        ctx.exec('xcrun', ['simctl', 'boot', simulator.udid]);
      run(ctx, 'xcrun', ['simctl', 'install', simulator.udid, app], 'simctl install');
      run(ctx, 'xcrun', ['simctl', 'launch', simulator.udid, bundle], 'simctl launch');
      ctx.out(`Started ${bundle} on ${simulator.name}`);
    },
  };
}
