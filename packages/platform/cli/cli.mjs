// @ts-check
// Argument parsing and command dispatch for `solid-platform`. Everything a
// target can do is looked up in the registry (cli/targets/index.mjs).
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError, createContext } from './context.mjs';
import { configFiles } from './config.mjs';
import { findTarget, targetNames, targets } from './targets/index.mjs';

/** @typedef {import('./types.d.ts').TargetContext} TargetContext */
/** @typedef {import('./types.d.ts').TargetDefinition} TargetDefinition */
/** @typedef {'build' | 'run' | 'package' | 'devices' | 'logs' | 'screenshot'} Verb */
/** @typedef {{ legacy?: boolean, help?: boolean, targets?: string, 'android-kind'?: string, device?: string, port?: string, 'no-build'?: boolean, timeout?: string }} Flags */
/** @typedef {{ usage: string, summary: string, run(args: string[], flags: Flags, ctx: TargetContext): unknown }} Command */

const options = /** @type {const} */ ({
  legacy: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  targets: { type: 'string' },
  'android-kind': { type: 'string' },
  device: { type: 'string' },
  port: { type: 'string' },
  'no-build': { type: 'boolean' },
  timeout: { type: 'string' },
});

/** @type {Verb[]} */
const verbs = ['build', 'run', 'package', 'devices', 'logs', 'screenshot'];

/**
 * The target for a command, or one clear line: unknown targets exit 1, a
 * command the target does not implement exits 2.
 * @param {string | undefined} name
 * @param {Verb} verb
 * @returns {TargetDefinition}
 */
export function resolveTarget(name, verb) {
  const target = name ? findTarget(name) : undefined;
  if (!target)
    throw new CliError(
      `Unknown target: ${name ?? '(none)'}. Targets: ${targetNames.join(', ')}`,
    );
  if (typeof target[verb] !== 'function') {
    const able = targets.filter((t) => typeof t[verb] === 'function');
    throw new CliError(
      `${target.name} does not implement ${verb}. Targets with ${verb}: ${able.map((t) => t.name).join(', ')}`,
      2,
    );
  }
  return target;
}

/** @param {TargetContext} ctx @param {TargetDefinition} target */
function configured(ctx, target) {
  if (!ctx.config.targets.includes(target.name))
    throw new CliError(
      `Target ${target.name} is not in the targets of ${ctx.config.source} (${ctx.config.targets.join(', ')}).`,
    );
}

/** @param {string[]} args @param {number} min @param {number} max @param {Command} command */
function arity(args, min, max, command) {
  if (args.length < min || args.length > max)
    throw new CliError('Usage: solid-platform ' + command.usage);
}

/** @param {string | undefined} value @param {string} flag */
function integer(value, flag) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value))
    throw new CliError(`--${flag} expects a whole number`);
  return Number(value);
}

/**
 * Runs every check of the chosen targets and prints one line each.
 * @param {TargetContext} ctx
 * @param {string[]} requested targets named on the command line
 * @returns {Promise<number>} the exit code
 */
export async function doctor(ctx, requested) {
  for (const name of requested)
    if (!findTarget(name))
      throw new CliError(
        `Unknown target: ${name}. Targets: ${targetNames.join(', ')}`,
      );
  const explicit = requested.length > 0;
  const names = explicit
    ? [...new Set(requested)]
    : [...configFiles, 'solid-platform.json'].some((file) =>
          ctx.exists(path.join(ctx.root, file)),
        )
      ? ctx.config.targets
      : targetNames;
  /** @type {string[]} */
  const blocked = [];
  const shared = new Set();
  for (const name of names) {
    const target = /** @type {TargetDefinition} */ (findTarget(name));
    let stops = false;
    for (const check of await target.doctor(ctx)) {
      // A blocked check that is only skipped (iOS away from macOS) fails
      // doctor when that target was asked for by name.
      if (
        check.blocksBuild &&
        (check.status === 'missing' || (check.status === 'skipped' && explicit))
      )
        stops = true;
      const common = check.name === 'node' || check.name === 'pnpm';
      if (common && shared.has(check.name)) continue;
      if (common) shared.add(check.name);
      ctx.out(
        `${check.status.padEnd(8)}${(common ? 'all' : name).padEnd(12)}${check.name.padEnd(20)}${check.detail}`,
      );
    }
    if (stops) blocked.push(name);
  }
  if (blocked.length) ctx.err('Cannot build: ' + blocked.join(', '));
  return blocked.length ? 1 : 0;
}

/** @type {Record<string, Command>} */
const commands = {
  init: {
    usage: `init <directory> [--targets ${targetNames.join(',')}]`,
    summary: 'Create an app. Targets default to web.',
    async run(args, flags, ctx) {
      arity(args, 1, 1, this);
      if (flags['android-kind'])
        throw new CliError('Usage: solid-platform ' + this.usage);
      const { init } = await import('./init.mjs');
      const { targets: select } = await import('./files.mjs');
      const dest = path.resolve(ctx.root, /** @type {string} */ (args[0]));
      init(dest, select(flags.targets ?? 'web', targetNames));
      ctx.out('Created ' + dest);
    },
  },
  doctor: {
    usage: 'doctor [target…]',
    summary:
      'Check the tools each target needs. Without targets: those of this app, or all. Exits 1 when a checked target cannot build.',
    run: (args, _flags, ctx) => doctor(ctx, args),
  },
  devices: {
    usage: 'devices [target]',
    summary:
      'List the devices a target can run on: Android devices, emulators and AVDs, the configured Roku, Apple simulators.',
    async run(args, _flags, ctx) {
      arity(args, 0, 1, this);
      if (args.length) {
        await resolveTarget(args[0], 'devices').devices?.(ctx);
        return;
      }
      // Android and Android TV (and the two Apple targets) share devices.
      const families = new Set();
      for (const target of targets) {
        if (!target.devices || families.has(target.family)) continue;
        families.add(target.family);
        try {
          await target.devices(ctx);
        } catch (error) {
          ctx.err(`${target.family}  ${/** @type {Error} */ (error).message}`);
        }
      }
    },
  },
  build: {
    usage: 'build <target> [--legacy]',
    summary:
      'Build a target into targets/<target>. --legacy makes the Canvas 2D build for older browser TVs.',
    run(args, flags, ctx) {
      arity(args, 1, 1, this);
      if (flags.targets || flags['android-kind'])
        throw new CliError('Usage: solid-platform ' + this.usage);
      const target = resolveTarget(args[0], 'build');
      configured(ctx, target);
      return target.build(ctx, { legacy: flags.legacy === true });
    },
  },
  dev: {
    usage: 'dev <web|desktop>',
    summary: 'Build and serve with reload (web) or build and open (desktop).',
    run(args, flags, ctx) {
      arity(args, 1, 1, this);
      const target = resolveTarget(args[0], 'build');
      configured(ctx, target);
      return target.build(ctx, { dev: true, legacy: flags.legacy === true });
    },
  },
  run: {
    usage: 'run <target> [--device <id>] [--no-build] [--port <n>]',
    summary:
      'Build, then start: web is served on localhost; roku is sideloaded and launched; android and android-tv are installed with adb and started; ios and apple-tv start in a simulator; desktop opens. --device is required when more than one Android device is attached.',
    run(args, flags, ctx) {
      arity(args, 1, 1, this);
      const target = resolveTarget(args[0], 'run');
      configured(ctx, target);
      return target.run?.(ctx, {
        device: flags.device,
        build: !flags['no-build'],
        port: integer(flags.port, 'port'),
      });
    },
  },
  logs: {
    usage: 'logs <target> [--device <id>] [--timeout <seconds>]',
    summary:
      'Stream logs until interrupted: the Roku developer console, or adb logcat for the running Android app.',
    run(args, flags, ctx) {
      arity(args, 1, 1, this);
      const target = resolveTarget(args[0], 'logs');
      configured(ctx, target);
      const seconds = integer(flags.timeout, 'timeout');
      return target.logs?.(ctx, {
        device: flags.device,
        timeoutMs: seconds === undefined ? undefined : seconds * 1000,
      });
    },
  },
  screenshot: {
    usage: 'screenshot <target> <file> [--device <id>]',
    summary: 'Save a PNG of what the Roku or Android device shows.',
    run(args, flags, ctx) {
      arity(args, 2, 2, this);
      const target = resolveTarget(args[0], 'screenshot');
      configured(ctx, target);
      return target.screenshot?.(ctx, {
        device: flags.device,
        file: path.resolve(ctx.root, /** @type {string} */ (args[1])),
      });
    },
  },
  package: {
    usage: 'package <target> [--legacy]',
    summary:
      'Make the distributable: desktop archive, Tizen and webOS packages, signed Android release.',
    run(args, flags, ctx) {
      arity(args, 1, 1, this);
      const target = resolveTarget(args[0], 'package');
      configured(ctx, target);
      return target.package?.(ctx, { legacy: flags.legacy === true });
    },
  },
  check: {
    usage: 'check [target]',
    summary: 'Type-check the sources each target selects.',
    async run(args, _flags, ctx) {
      arity(args, 0, 1, this);
      const { checkTargets } = await import('./variants.mjs');
      checkTargets(ctx.root, args[0]);
    },
  },
  explain: {
    usage: 'explain <target> <module>',
    summary: 'Show which source file a target uses for a module.',
    async run(args, _flags, ctx) {
      arity(args, 2, 2, this);
      const { explain } = await import('./variants.mjs');
      ctx.out(
        JSON.stringify(
          explain(
            ctx.root,
            /** @type {string} */ (args[0]),
            /** @type {string} */ (args[1]),
          ),
          null,
          2,
        ),
      );
    },
  },
  plugin: {
    usage:
      'plugin new <name> [--targets list] [--android-kind kotlin|sidecar|service|jni]',
    summary: 'Create a plugin. Targets default to those of the app.',
    async run(args, flags, ctx) {
      if (args[0] !== 'new' || args.length !== 2)
        throw new CliError('Usage: solid-platform ' + this.usage);
      const { newPlugin } = await import('./plugins.mjs');
      const { targets: select } = await import('./files.mjs');
      const selected = select(
        flags.targets ?? ctx.config.targets.join(','),
        ctx.config.targets,
      );
      if (
        flags['android-kind'] &&
        !selected.some((t) => t === 'android' || t === 'android-tv')
      )
        throw new CliError('--android-kind requires an Android target');
      const name = /** @type {string} */ (args[1]);
      newPlugin(ctx.root, name, selected, flags['android-kind'] ?? 'kotlin');
      ctx.out('Created plugins/' + name);
    },
  },
  plugins: {
    usage: 'plugins run desktop',
    summary: 'Run the desktop plugins without opening the window.',
    run(args, _flags, ctx) {
      if (args.join(' ') !== 'run desktop')
        throw new CliError('Usage: solid-platform ' + this.usage);
      return resolveTarget('desktop', 'build').build(ctx, { dev: 'plugins' });
    },
  },
  add: {
    usage: 'add video <release.tgz>',
    summary: 'Install a video release into the app.',
    async run(args, _flags, ctx) {
      if (args[0] !== 'video' || args.length !== 2)
        throw new CliError('Usage: solid-platform ' + this.usage);
      const { addVideo } = await import('./add-video.mjs');
      addVideo(ctx.root, path.resolve(ctx.root, /** @type {string} */ (args[1])));
    },
  },
  certify: {
    usage: 'certify roku <metrics.json>',
    summary: 'Check Roku metrics against the certification budgets.',
    async run(args, _flags, ctx) {
      if (args[0] !== 'roku' || args.length !== 2)
        throw new CliError('Usage: solid-platform ' + this.usage);
      const { certifyRoku } = await import('./certification.mjs');
      const result = certifyRoku(
        path.resolve(ctx.root, /** @type {string} */ (args[1])),
      );
      return result.pass ? 0 : 1;
    },
  },
};

export const commandNames = Object.keys(commands);

/** The text of `solid-platform --help`, from the command table and the registry. */
export function help() {
  const lines = ['Commands:'];
  for (const command of Object.values(commands))
    lines.push('  solid-platform ' + command.usage);
  lines.push('', 'Targets:');
  for (const target of targets)
    lines.push(
      `  ${target.name.padEnd(11)} ${target.summary}`,
      `  ${''.padEnd(11)} ${verbs.filter((verb) => typeof target[verb] === 'function').join(', ')}`,
    );
  lines.push(
    '',
    'Run build, dev, run, logs, screenshot, package and plugin from the app directory.',
    '`solid-platform <command> --help` describes one command.',
  );
  return lines.join('\n');
}

/**
 * Runs one command line.
 * @param {string[]} argv the arguments after `solid-platform`
 * @param {Partial<TargetContext>} [overrides] replaces parts of the context, for tests
 * @returns {Promise<number>} the exit code
 */
export async function runCli(argv, overrides = {}) {
  const ctx = createContext(overrides);
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options,
    });
    const [name, ...args] = positionals;
    if (!name) {
      ctx.out(help());
      return 0;
    }
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (!command)
      throw new CliError(
        `Unknown command: ${name}. Run \`solid-platform --help\`.`,
      );
    if (values.help) {
      ctx.out(`solid-platform ${command.usage}\n\n${command.summary}`);
      const verb = verbs.find((v) => v === name);
      if (verb)
        ctx.out(
          'Targets: ' +
            targets
              .filter((t) => typeof t[verb] === 'function')
              .map((t) => t.name)
              .join(', '),
        );
      return 0;
    }
    const result = await command.run(args, values, ctx);
    return typeof result === 'number' ? result : 0;
  } catch (error) {
    ctx.err(/** @type {Error} */ (error).message);
    return error instanceof CliError ? error.exitCode : 1;
  }
}
