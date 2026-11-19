// @ts-check
// Loads and validates solid-platform.config.{mjs,js,json} from the app root.
// Apps created before the config file keep working: solid-platform.json
// (name and targets) is read when no config file exists.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { available, validateName } from './files.mjs';

export const configFiles = [
  'solid-platform.config.mjs',
  'solid-platform.config.js',
  'solid-platform.config.json',
];
const legacyFile = 'solid-platform.json';
const known = new Set([
  'id',
  'name',
  'version',
  'targets',
  'desktop',
  'icons',
  'splash',
  'deepLinks',
  'services',
  'signing',
  'app',
]);
const appKeys = ['fonts', 'designSize', 'theme'];
const themes = ['system', 'light', 'dark'];
// A value under one of these keys would be a credential written into the
// project. Signing settings name environment variables instead.
const inlineSecret = /pass(word|wd)?$|secret$|token$/i;

/** @param {unknown} value */
const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks a config object and fills in the optional parts. Every error names
 * the file and the key path.
 * @param {unknown} raw
 * @param {string} [source] file name used in messages
 * @param {readonly string[]} [allowed] target names
 * @returns {import('./config.d.ts').ResolvedConfig}
 */
export function validateConfig(raw, source = 'config', allowed = available) {
  /** @type {(key: string, message: string) => never} */
  const fail = (key, message) => {
    throw new Error(`${source}: ${key}: ${message}`);
  };
  if (!isObject(raw)) throw new Error(`${source}: expected an object`);
  const config = /** @type {Record<string, any>} */ (raw);
  for (const key of Object.keys(config))
    if (!known.has(key))
      fail(key, 'unknown key (known: ' + [...known].join(', ') + ')');

  if (typeof config.name !== 'string') fail('name', 'required string');
  try {
    validateName(config.name);
  } catch (error) {
    fail('name', /** @type {Error} */ (error).message);
  }

  if (!Array.isArray(config.targets) || !config.targets.length)
    fail('targets', 'required non-empty array of target names');
  config.targets.forEach((/** @type {unknown} */ target, /** @type {number} */ i) => {
    if (typeof target !== 'string' || !allowed.includes(target))
      fail(
        `targets[${i}]`,
        `unknown target ${JSON.stringify(target)} (available: ${allowed.join(', ')})`,
      );
  });
  if (new Set(config.targets).size !== config.targets.length)
    fail('targets', 'lists a target twice');

  if (config.id !== undefined) {
    if (
      typeof config.id !== 'string' ||
      !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/i.test(config.id)
    )
      fail('id', 'expected a reverse-DNS application id such as com.example.app');
  }
  if (config.version !== undefined) {
    if (
      typeof config.version !== 'string' ||
      !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(config.version)
    )
      fail('version', 'expected a version such as 1.2.3');
  }

  /** @type {(key: string, value: unknown) => void} */
  const pathOrMap = (key, value) => {
    if (value === undefined || typeof value === 'string') return;
    if (!isObject(value)) fail(key, 'expected a file path or an object of file paths');
    for (const [name, file] of Object.entries(/** @type {object} */ (value)))
      if (typeof file !== 'string') fail(`${key}.${name}`, 'expected a string');
  };
  pathOrMap('icons', config.icons);
  pathOrMap('splash', config.splash);

  /** @type {(key: string, value: unknown) => string[]} */
  const strings = (key, value) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail(key, 'expected an array of strings');
    /** @type {unknown[]} */ (value).forEach((item, i) => {
      if (typeof item !== 'string' || !item)
        fail(`${key}[${i}]`, 'expected a non-empty string');
    });
    return /** @type {string[]} */ (value);
  };
  if (config.deepLinks !== undefined && !isObject(config.deepLinks))
    fail('deepLinks', 'expected { schemes, hosts }');
  for (const key of Object.keys(config.deepLinks ?? {}))
    if (key !== 'schemes' && key !== 'hosts')
      fail('deepLinks.' + key, 'unknown key (known: schemes, hosts)');
  const schemes = strings('deepLinks.schemes', config.deepLinks?.schemes);
  schemes.forEach((scheme, i) => {
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme))
      fail(`deepLinks.schemes[${i}]`, 'expected a URL scheme without "://"');
  });
  const hosts = strings('deepLinks.hosts', config.deepLinks?.hosts);
  const services = strings('services', config.services);

  // The desktop window's chrome is chosen at startup: the runtime builds the
  // window before the app runs, so it cannot be an option of `desktopHost`.
  const titleBars = ['native', 'custom', 'hidden'];
  const desktop = config.desktop ?? {};
  if (!isObject(desktop))
    fail('desktop', 'expected { titleBar }');
  for (const key of Object.keys(desktop))
    if (key !== 'titleBar')
      fail('desktop.' + key, 'unknown key (known: titleBar)');
  if (desktop.titleBar !== undefined && !titleBars.includes(desktop.titleBar))
    fail('desktop.titleBar', 'expected one of ' + titleBars.join(', '));

  if (config.signing !== undefined && !isObject(config.signing))
    fail('signing', 'expected an object keyed by target');
  for (const [target, settings] of Object.entries(config.signing ?? {})) {
    if (!allowed.includes(target))
      fail(
        'signing.' + target,
        `unknown target (available: ${allowed.join(', ')})`,
      );
    if (!isObject(settings)) fail('signing.' + target, 'expected an object');
    for (const [key, value] of Object.entries(/** @type {object} */ (settings))) {
      if (inlineSecret.test(key))
        fail(
          `signing.${target}.${key}`,
          `do not store credentials in the config; name an environment variable in ${key}Env`,
        );
      if (typeof value !== 'string')
        fail(`signing.${target}.${key}`, 'expected a string');
    }
  }

  const app = config.app ?? {};
  if (!isObject(app)) fail('app', 'expected { fonts, designSize, theme }');
  for (const key of Object.keys(app))
    if (!appKeys.includes(key))
      fail('app.' + key, 'unknown key (known: ' + appKeys.join(', ') + ')');
  if (app.fonts !== undefined) {
    if (!Array.isArray(app.fonts)) fail('app.fonts', 'expected an array');
    app.fonts.forEach((/** @type {unknown} */ font, /** @type {number} */ i) => {
      const key = `app.fonts[${i}]`;
      if (!isObject(font)) fail(key, 'expected { family, atlas, file }');
      const entry = /** @type {Record<string, unknown>} */ (font);
      for (const name of Object.keys(entry))
        if (!['family', 'atlas', 'file'].includes(name))
          fail(`${key}.${name}`, 'unknown key (known: family, atlas, file)');
      if (typeof entry.family !== 'string' || !entry.family)
        fail(key + '.family', 'required string');
      for (const name of ['atlas', 'file']) {
        const value = entry[name];
        if (value === undefined) continue;
        if (typeof value !== 'string' || !value || /[\\/]/.test(value))
          fail(`${key}.${name}`, 'expected a file name without a directory');
      }
      if (entry.atlas === undefined && entry.file === undefined)
        fail(key, 'needs an atlas (assets/fonts) or a file (targets/roku/fonts)');
    });
  }
  if (app.designSize !== undefined) {
    const size = app.designSize;
    if (
      !isObject(size) ||
      Object.keys(size).sort().join() !== 'height,width' ||
      ![size.width, size.height].every((n) => Number.isFinite(n) && n > 0)
    )
      fail('app.designSize', 'expected { width, height } with positive numbers');
  }
  if (app.theme !== undefined && !themes.includes(app.theme))
    fail('app.theme', 'expected one of ' + themes.join(', '));

  return {
    app: { fonts: app.fonts, designSize: app.designSize, theme: app.theme },
    id: config.id,
    name: config.name,
    version: config.version,
    targets: [...config.targets],
    desktop: { titleBar: desktop.titleBar },
    icons: config.icons,
    splash: config.splash,
    deepLinks: { schemes, hosts },
    services,
    signing: config.signing ?? {},
    source,
  };
}

/** @param {string} root @returns {string | undefined} the config file name in `root` */
export function findConfig(root) {
  return configFiles.find((file) => existsSync(path.join(root, file)));
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `${path.basename(file)}: ${/** @type {Error} */ (error).message}`,
    );
  }
}

/**
 * The project's settings, from the config file or, for older apps, from
 * solid-platform.json. Synchronous so every build step can call it.
 * @param {string} root the app directory
 * @returns {import('./config.d.ts').ResolvedConfig}
 */
export function loadConfig(root) {
  const file = findConfig(root);
  if (!file) {
    if (!existsSync(path.join(root, legacyFile)))
      throw new Error(
        `No ${configFiles[2]} in ${root}. Run this from an app directory.`,
      );
    return validateConfig(readJson(path.join(root, legacyFile)), legacyFile);
  }
  const full = path.join(root, file);
  if (file.endsWith('.json')) return validateConfig(readJson(full), file);
  let loaded;
  try {
    // Node 22.12 and later load ES modules synchronously when they have no
    // top-level await.
    loaded = createRequire(import.meta.url)(full);
  } catch (error) {
    throw new Error(`${file}: ${/** @type {Error} */ (error).message}`);
  }
  return validateConfig(loaded?.default ?? loaded, file);
}
