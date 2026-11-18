import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.mjs';

export const framework = fileURLToPath(new URL('../', import.meta.url));
export const available = [
  'web',
  'tizen',
  'webos',
  'vizio',
  'android',
  'roku',
  'android-tv',
  'apple-tv',
  'ios',
  'desktop',
];
export const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function write(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}
export const writeJson = (file, value) =>
  write(file, JSON.stringify(value, null, 2) + '\n');
export function copy(source, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true });
}
export function template(file, values = {}) {
  return readFileSync(
    path.join(framework, 'cli/templates', file),
    'utf8',
  ).replace(/__([A-Z_]+)__/g, (token, name) => values[name] ?? token);
}
export function validateName(name) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 50) {
    throw new Error(
      'Use a lowercase app or plugin name of up to 50 letters, digits and hyphens.',
    );
  }
  return name;
}
export function targets(value, allowed = available) {
  const selected = [...new Set(value.split(','))];
  for (const name of selected)
    if (!allowed.includes(name))
      throw new Error(
        'Unsupported target ' + name + '. Available: ' + allowed.join(', '),
      );
  return selected;
}
export function freshDirectory(dest, populate) {
  if (existsSync(dest)) throw new Error('Destination already exists: ' + dest);
  const parent = path.dirname(dest);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, '.solid-init-'));
  try {
    populate(staging);
    renameSync(staging, dest);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
export function command(bin, args, cwd) {
  // npm and Corepack ship .cmd wrappers on Windows. Invoke their JavaScript
  // entry points directly so project paths never need shell quoting.
  if (process.platform === 'win32' && ['npm', 'corepack'].includes(bin)) {
    const subpath =
      bin === 'npm'
        ? 'node_modules/npm/bin/npm-cli.js'
        : 'node_modules/corepack/dist/corepack.js';
    const executable = [
      path.dirname(process.execPath),
      ...(process.env.PATH ?? '').split(path.delimiter),
    ]
      .map((dir) => path.join(dir, subpath))
      .find((file) => existsSync(file));
    if (!executable)
      throw new Error('Cannot find the installed ' + bin + ' CLI.');
    args = [executable, ...args];
    bin = process.execPath;
  }
  const p = spawnSync(bin, args, { cwd, stdio: 'inherit', shell: false });
  if (p.error) throw p.error;
  if (p.status !== 0)
    throw new Error(bin + ' failed (' + (p.status ?? p.signal) + ')');
}
// The project's settings: solid-platform.config.{mjs,js,json}, or
// solid-platform.json in apps created before the config file.
export function project(root) {
  return loadConfig(root);
}
