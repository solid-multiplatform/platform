import path from 'node:path';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { command, copy, project, writeJson } from './files.mjs';

export const browserTVs = ['tizen', 'webos', 'vizio'];
// Browser targets hosted as a web app: the browser TVs and the PS4, which
// has no package format. `ps4` gets the fixed TV stage and the TV entry but
// no vendor packaging.
export const tvBrowsers = [...browserTVs, 'ps4'];
export const hostedBrowsers = ['web', ...tvBrowsers];
export const desktopOS = ['linux', 'windows', 'macos'];
const families = {
  android: 'mobile',
  ios: 'mobile',
  roku: 'tv',
  'apple-tv': 'tv',
  'android-tv': 'tv',
  tizen: 'tv',
  webos: 'tv',
  vizio: 'tv',
  ps4: 'tv',
  linux: 'desktop',
  windows: 'desktop',
  macos: 'desktop',
};
const suffixes = new Set([
  'web',
  ...Object.keys(families),
  ...Object.values(families),
]);

export function variantOrder(target) {
  const exact =
    target === 'desktop'
      ? { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]
      : target;
  if (!exact || !suffixes.has(exact))
    throw new Error('Unknown UI target: ' + target);
  return families[exact]
    ? [exact, families[exact], 'shared']
    : [exact, 'shared'];
}

// Keep the import graph ordinary: select files before any bundler or compiler sees them.
export function selectSources(source, target) {
  const order = variantOrder(target);
  const selected = new Map();
  function visit(dir) {
    for (const item of readdirSync(path.join(source, dir), {
      withFileTypes: true,
    })) {
      const relative = path.join(dir, item.name);
      if (item.isDirectory()) {
        visit(relative);
        continue;
      }
      if (!item.isFile())
        throw new Error('Expected a source file: ' + relative);
      const ext = relative.endsWith('.d.ts') ? '.d.ts' : path.extname(relative);
      const stem = ext ? relative.slice(0, -ext.length) : relative;
      const suffix = path.extname(stem).slice(1);
      const variant = suffixes.has(suffix) ? suffix : 'shared';
      const priority = order.indexOf(variant);
      if (priority < 0) continue;
      const base =
        variant === 'shared' ? stem : stem.slice(0, -suffix.length - 1);
      const key = /^(?:\.[cm]?[jt]sx?)$/.test(ext) ? base : base + ext;
      const previous = selected.get(key);
      if (previous?.priority === priority)
        throw new Error(
          'Ambiguous module: ' + previous.source + ' and ' + relative,
        );
      if (!previous || priority < previous.priority)
        selected.set(key, {
          source: relative,
          output: base + ext,
          variant,
          priority,
        });
    }
  }
  visit('');
  return selected;
}
export function stageSources(source, dest, target, previous = []) {
  const selected = [...selectSources(source, target).values()];
  const next = new Set(selected.map((entry) => entry.output));
  for (const old of previous)
    if (!next.has(old)) rmSync(path.join(dest, old), { force: true });
  for (const { source: relative, output } of selected) {
    const from = path.join(source, relative),
      to = path.join(dest, output);
    if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to)))
      copy(from, to);
  }
  return next;
}
export function explain(root, target, name) {
  const sources = selectSources(path.join(root, 'src'), target);
  const key = path.normalize(name).replace(/^src[/\\]/, '');
  const chosen =
    sources.get(key) ??
    [...sources.values()].find((entry) => entry.output === key);
  if (!chosen)
    throw new Error('No matching source for ' + name + ' on ' + target);
  return Object.assign({ target, order: variantOrder(target) }, chosen);
}
export function checkTargets(root, requested) {
  const config = project(root);
  const scope = requested
    ? [requested]
    : config.targets.flatMap((t) => (t === 'desktop' ? desktopOS : [t]));
  for (const target of scope) {
    if (
      !config.targets.includes(target) &&
      !(desktopOS.includes(target) && config.targets.includes('desktop'))
    )
      throw new Error('Unconfigured target: ' + target);
    const projectDir = path.join(
      root,
      'targets',
      desktopOS.includes(target) ? 'desktop' : target,
    );
    const dir = mkdtempSync(path.join(projectDir, '.solid-check-'));
    try {
      stageSources(path.join(root, 'src'), path.join(dir, 'src'), target);
      writeJson(path.join(dir, 'tsconfig.json'), {
        extends: path.relative(dir, path.join(root, 'tsconfig.json')),
        include: ['src/**/*'],
        compilerOptions: { noEmit: true },
      });
      command(
        'corepack',
        ['pnpm', 'exec', 'tsc', '-p', path.join(dir, 'tsconfig.json')],
        root,
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }
}

// Vite watches the author's files while serving only the selected target tree.
export function variantUpdates(target) {
  return {
    name: 'solid-platform-variants',
    configureServer(server) {
      const source = path.resolve(server.config.root, '../../src'),
        dest = path.join(server.config.root, 'work/src');
      let files = stageSources(source, dest, target);
      server.watcher.add(source);
      const refresh = (_, file) => {
        if (path.resolve(file).startsWith(source + path.sep)) {
          try {
            files = stageSources(source, dest, target, files);
          } catch (error) {
            server.config.logger.error(error.message);
          }
        }
      };
      server.watcher.on('all', refresh);
      server.httpServer?.once('close', () =>
        server.watcher.off('all', refresh),
      );
    },
  };
}
