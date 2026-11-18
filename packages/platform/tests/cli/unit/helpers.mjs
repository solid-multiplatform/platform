// A machine made of plain data for CLI tests: environment, tools on PATH,
// files and tool results all come from the test, never from this computer.
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { validateConfig } from '../../../cli/config.mjs';
import { runCli } from '../../../cli/cli.mjs';
import { createContext } from '../../../cli/context.mjs';

export const allTargets = [
  'web',
  'tizen',
  'webos',
  'vizio',
  'roku',
  'android',
  'android-tv',
  'ios',
  'apple-tv',
  'desktop',
];

export const config = (overrides = {}) =>
  validateConfig(
    {
      id: 'com.example.demo',
      name: 'demo-app',
      version: '1.2.3',
      targets: allTargets,
      ...overrides,
    },
    'solid-platform.config.json',
  );

/**
 * @param {object} [machine]
 * @param {Record<string, string>} [machine.env]
 * @param {string[]} [machine.tools] names `which` finds
 * @param {string[]} [machine.files] paths that exist
 * @param {Record<string, string[]>} [machine.dirs] directory listings
 * @param {(bin: string, args: string[], options: object) => object | undefined} [machine.exec]
 */
export function machine({
  env = {},
  tools = ['corepack'],
  files = [],
  dirs = {},
  exec,
  ...rest
} = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const overrides = {
    root: '/app',
    env,
    platform: 'linux',
    arch: 'x64',
    nodeVersion: '24.15.0',
    config: config(),
    which: (bin) => (tools.includes(bin) ? '/usr/bin/' + bin : null),
    exists: (file) => files.includes(file) || Object.hasOwn(dirs, file),
    readdir: (dir) => dirs[dir] ?? [],
    readFile: () => '',
    writeFile: () => {},
    exec(bin, args, options = {}) {
      calls.push([bin, ...args]);
      const result = exec?.(bin, args, options);
      if (result) return { status: 0, stdout: '', stderr: '', ...result };
      if (bin === 'corepack' && args.join(' ') === 'pnpm --version')
        return { status: 0, stdout: '10.33.4\n', stderr: '' };
      return { status: 1, stdout: '', stderr: bin + ': not available' };
    },
    out: (line) => out.push(String(line)),
    err: (line) => err.push(String(line)),
    buildProject: (...args) => calls.push(['build', ...args.slice(1)]),
    ...rest,
  };
  return {
    out,
    err,
    calls,
    overrides,
    /** Everything printed, for assertions about what must never appear. */
    text: () => [...out, ...err].join('\n'),
    cli: (...argv) => runCli(argv, overrides),
    ctx: () => createContext(overrides),
  };
}

/** A real directory for tests that read or write files. */
export function scratch(t, files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'solid-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

export const java21 = (bin, args) =>
  args[0] === '-version' && bin.endsWith('java')
    ? { stderr: 'openjdk version "21.0.5" 2024-10-15\n' }
    : undefined;

// Serials here are made up; the address is from the documentation range.
export const adbListing = `List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
R58M00EXAMPLE          device usb:1-4 product:beyond1 model:SM_G973F device:beyond1 transport_id:2
192.0.2.10:5555        offline product:tv model:Example_TV device:tv transport_id:3
0A1B2C3D4E             unauthorized usb:1-5 transport_id:4

`;
