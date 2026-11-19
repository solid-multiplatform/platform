// @ts-check
// What every command and target receives. Tests replace `env`, `exec`,
// `which`, the file checks and the output sinks, so nothing in a target reads
// the machine directly.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.mjs';

/** An expected failure: printed as one line, never as a stack trace. */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode] 1 for usage and build failures, 2 for a command a target does not implement
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const secretName = /^(?:ROKU_DEV_|ANDROID_)|PASSWORD|PASSWD|SECRET|TOKEN/i;

/**
 * Removes the values of device and credential variables from a line of
 * output. Commands never print them on purpose; this covers messages that
 * come back from tools and the network stack.
 * @param {Record<string, string | undefined>} env
 * @returns {(text: string) => string}
 */
export function redactor(env) {
  const values = Object.entries(env)
    .filter(([name, value]) => secretName.test(name) && value && value.length >= 3)
    .map(([, value]) => /** @type {string} */ (value))
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let result = String(text);
    for (const value of values) result = result.split(value).join('[hidden]');
    return result;
  };
}

/**
 * @param {string} bin
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {string | null}
 */
function whichOnPath(bin, env, platform) {
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter))
    for (const ext of extensions)
      if (dir && existsSync(path.join(dir, bin + ext)))
        return path.join(dir, bin + ext);
  return null;
}

/**
 * @param {Partial<import('./types.d.ts').TargetContext>} [overrides]
 * @returns {import('./types.d.ts').TargetContext}
 */
export function createContext(overrides = {}) {
  const env = overrides.env ?? process.env;
  const platform = overrides.platform ?? process.platform;
  const root = overrides.root ?? process.cwd();
  const redact = redactor(env);
  /** @type {import('./config.d.ts').ResolvedConfig | undefined} */
  let config = overrides.config;
  return {
    root,
    env,
    platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    exists: existsSync,
    readdir: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    readFile: (file) => readFileSync(file, 'utf8'),
    writeFile(file, data) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
    which: (bin) => whichOnPath(bin, env, platform),
    exec(bin, args, options = {}) {
      const result = spawnSync(bin, args, {
        cwd: options.cwd,
        env: /** @type {NodeJS.ProcessEnv} */ (env),
        stdio: options.stdio ?? 'pipe',
        encoding: options.binary ? 'buffer' : 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
      });
      return {
        status: result.error ? null : result.status,
        stdout: result.stdout ?? '',
        stderr: result.error ? result.error.message : (result.stderr ?? ''),
      };
    },
    ...overrides,
    out: (line) => (overrides.out ?? console.log)(redact(line)),
    err: (line) => (overrides.err ?? console.error)(redact(line)),
    get config() {
      return (config ??= loadConfig(root));
    },
  };
}

/**
 * Runs a tool and returns its text output, or throws one line naming it.
 * @param {import('./types.d.ts').TargetContext} ctx
 * @param {string} bin
 * @param {string[]} args
 * @param {string} what what the tool was doing, for the error
 */
export function run(ctx, bin, args, what) {
  const result = ctx.exec(bin, args);
  if (result.status !== 0)
    throw new CliError(
      `${what} failed: ${String(result.stderr).trim().split('\n').pop() || bin + ' exited with ' + result.status}`,
    );
  return String(result.stdout);
}
