#!/usr/bin/env node
// Packages an app for Linux: a directory that runs from wherever it is put,
// and a .tar.gz of it.
//
//   <name>/
//     bin/<name>            the runtime
//     resources/app.hbc     the app (app.js without bytecode)
//     resources/...         its assets, as the app names them
//     <appId>.desktop       the launcher entry
//     <appId>.png           the icon
//     README.txt            how to install it and what it needs
//
// The runtime finds resources/ from its own executable, and the app's asset
// paths are relative to resources/, so nothing in the package names where it
// was built or where it is installed.
//
//   node cli/package.mjs <entry> --app-id <id> --name <name> --version <v>
//                        --out <dir> [--icon <file>] [--assets <path>]...
//                        [--scheme <scheme>] [--title <text>] [--no-bytecode]
//                        [--runtime <solid-desktop>]
import path from 'node:path';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';
import { findRuntime, platformName, runtimeDiagnostics } from './runtime.mjs';

/**
 * @typedef {object} PackageOptions
 * @property {string} entry The app's entry module.
 * @property {string} appId Reverse-DNS id, `com.example.player`: names the
 *   launcher entry and the icon. Use the same id in `desktopHost({ id })`.
 * @property {string} name The executable's and the directory's name: letters,
 *   digits, `.`, `_` and `-`.
 * @property {string} version The app's version, as in `1.2.0`.
 * @property {string} outDir Where `<name>/` and the archive are written.
 * @property {string} [title] The name people see; `name` when absent.
 * @property {string} [icon] A PNG or SVG file.
 * @property {string[]} [assets] Files and directories copied into
 *   `resources/` under their own names: the app loads `fonts/a.png` when
 *   `fonts` is listed here.
 * @property {string} [scheme] A URL scheme the app opens (`myapp` for
 *   `myapp://…`): declared in the launcher entry, delivered to the `links`
 *   service.
 * @property {boolean} [bytecode] Compile to Hermes bytecode. Default true.
 * @property {boolean} [minify] Default true.
 * @property {string} [runtime] The runtime to package; found as
 *   `runtime.mjs` describes when absent.
 *
 * @typedef {object} PackageResult
 * @property {string} directory The relocatable app directory.
 * @property {string} executable `bin/<name>` in it.
 * @property {string} archive The `.tar.gz` of the directory.
 * @property {undefined} appImage Not built: see the note.
 * @property {'static' | 'dynamic'} sdl How the packaged runtime links SDL.
 * @property {string[]} notes What the package needs or lacks, in sentences.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const APP_ID = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*$/;

/** A value of a desktop entry: one line, with its escapes. */
const entryValue = (text) =>
  String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

/**
 * Package an app for the system this runs on. Linux x64 only.
 *
 * @param {PackageOptions} options
 * @returns {Promise<PackageResult>}
 */
export async function packageDesktop(options) {
  const {
    entry,
    appId,
    name,
    version,
    outDir,
    title = name,
    icon,
    assets = [],
    scheme,
    bytecode = true,
    minify = true,
  } = options;
  if (platformName !== 'linux-x64') {
    throw new Error(
      `packageDesktop: packaging on ${platformName} is not implemented; only linux-x64 is`,
    );
  }
  for (const [option, value] of Object.entries({
    entry,
    appId,
    name,
    version,
    outDir,
  })) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`packageDesktop: "${option}" is required`);
    }
  }
  if (!NAME.test(name)) {
    throw new Error(
      `packageDesktop: name "${name}" must be letters, digits, ".", "_" and "-"`,
    );
  }
  if (!APP_ID.test(appId)) {
    throw new Error(
      `packageDesktop: appId "${appId}" must look like com.example.app`,
    );
  }
  if (scheme !== undefined && !SCHEME.test(scheme)) {
    throw new Error(`packageDesktop: "${scheme}" is not a URL scheme`);
  }
  const iconType = icon === undefined ? '' : path.extname(icon).toLowerCase();
  if (icon !== undefined && !['.png', '.svg'].includes(iconType)) {
    throw new Error('packageDesktop: the icon must be a .png or .svg file');
  }
  const runtime = options.runtime ?? findRuntime();
  const made = runtimeDiagnostics(runtime);

  const directory = path.resolve(outDir, name);
  const resources = path.join(directory, 'resources');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(path.join(directory, 'bin'), { recursive: true });
  mkdirSync(resources, { recursive: true });

  const script = path.join(resources, 'app.js');
  await bundle({ entry, outfile: script, bytecode, minify, runtime });
  // The bytecode is the app; its source does not ship beside it.
  if (bytecode) rmSync(script);

  for (const asset of assets) {
    const target = path.join(resources, path.basename(asset));
    if (existsSync(target)) {
      throw new Error(
        `packageDesktop: two things would be resources/${path.basename(asset)}`,
      );
    }
    cpSync(asset, target, { recursive: true });
  }

  const executable = path.join(directory, 'bin', name);
  copyFileSync(runtime, executable);
  chmodSync(executable, 0o755);
  if (icon !== undefined) {
    copyFileSync(icon, path.join(directory, appId + iconType));
  }

  // Exec names the program, not a path: the entry is valid wherever the
  // app is, once bin/<name> is on the PATH (README.txt).
  const entryLines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${entryValue(title)}`,
    `Exec=${name} %U`,
    ...(icon === undefined ? [] : [`Icon=${appId}`]),
    'Terminal=false',
    'Categories=Utility;',
    `X-AppVersion=${entryValue(version)}`,
    ...(scheme === undefined ? [] : [`MimeType=x-scheme-handler/${scheme};`]),
  ];
  writeFileSync(
    path.join(directory, `${appId}.desktop`),
    entryLines.join('\n') + '\n',
  );

  const notes = [];
  if (made.sdlLinkage === 'dynamic') {
    notes.push(
      `Needs SDL ${made.sdl.split('.')[0]} installed (libSDL3.so.0, version ${made.sdl} or later): this runtime does not contain it.`,
    );
  } else {
    notes.push(
      `SDL ${made.sdl} is part of the executable (video drivers: ${made.videoDrivers.join(', ')}).`,
    );
  }
  notes.push(
    'Needs the C and C++ standard libraries (glibc, libstdc++), and OpenGL ES 3 through EGL (Mesa or a vendor driver) with X11 or Wayland.',
  );
  const appImageNote =
    'No AppImage was built: that needs appimagetool or mksquashfs and an AppImage runtime, and none is downloaded at build time.';
  writeFileSync(
    path.join(directory, 'README.txt'),
    [
      `${title} ${version}`,
      '',
      `Run it:      ./bin/${name}`,
      'The directory can be moved anywhere; keep bin/ and resources/ together.',
      '',
      'Install it for the launcher:',
      `  ln -s "$PWD/bin/${name}" ~/.local/bin/${name}`,
      `  cp ${appId}.desktop ~/.local/share/applications/`,
      ...(icon === undefined
        ? []
        : [
            `  cp ${appId}${iconType} ~/.local/share/icons/hicolor/${iconType === '.svg' ? 'scalable' : '256x256'}/apps/`,
          ]),
      ...(scheme === undefined
        ? []
        : [
            `  xdg-mime default ${appId}.desktop x-scheme-handler/${scheme}`,
            '',
            `Links that start with ${scheme}: then open this app.`,
          ]),
      '',
      'Requirements:',
      ...notes.map((note) => `  ${note}`),
      '',
    ].join('\n'),
  );

  const archive = path.resolve(
    outDir,
    `${name}-${version}-${platformName}.tar.gz`,
  );
  // The system's tar: Node has none, and every Linux has this one.
  execFileSync('tar', [
    '-czf',
    archive,
    '-C',
    path.dirname(directory),
    path.basename(directory),
  ]);
  return {
    directory,
    executable,
    archive,
    appImage: undefined,
    sdl: made.sdlLinkage,
    notes: [...notes, appImageNote],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? false : args.splice(at, 1).length === 1;
  };
  const value = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args.splice(at, 2)[1];
  };
  const assets = [];
  for (let asset; (asset = value('--assets')) !== undefined; ) {
    assets.push(path.resolve(asset));
  }
  const resolved = (file) =>
    file === undefined ? undefined : path.resolve(file);
  const options = {
    appId: value('--app-id'),
    name: value('--name'),
    version: value('--version'),
    outDir: value('--out'),
    title: value('--title'),
    icon: resolved(value('--icon')),
    scheme: value('--scheme'),
    runtime: resolved(value('--runtime')),
    bytecode: !flag('--no-bytecode'),
    assets,
  };
  if (args.length !== 1 || args[0].startsWith('--')) {
    console.error(
      'usage: package.mjs <entry> --app-id <id> --name <name> --version <v> --out <dir>\n' +
        '       [--icon <file>] [--assets <path>]... [--scheme <scheme>] [--title <text>]\n' +
        '       [--no-bytecode] [--runtime <solid-desktop>]',
    );
    process.exit(2);
  }
  try {
    const result = await packageDesktop({
      ...Object.fromEntries(
        Object.entries(options).filter(([, v]) => v !== undefined),
      ),
      entry: path.resolve(args[0]),
    });
    console.log(result.directory);
    console.log(`${result.archive} (${statSync(result.archive).size} bytes)`);
    for (const note of result.notes) console.log(note);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
