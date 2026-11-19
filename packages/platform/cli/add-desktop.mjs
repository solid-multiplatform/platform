// `solid-platform add desktop [<tarball> | <url> | none]`: put the desktop
// host into a generated app, and the runtime where its CLI finds it.
//
//   add desktop <file.tgz>   install that release package
//   add desktop <https://…>  download that release package, then install it
//   add desktop [none]       install no package; fetch the runtime for this
//                            system from the latest GitHub release
//
// The package is copied into vendor/ and named by its digest, as `add video`
// does, so the app's package.json points at a file that cannot change under
// it. The runtime goes to the installed package's prebuilt/<platform>/,
// which is where packages/host-desktop/cli/runtime.mjs looks; an existing
// SOLID_DESKTOP_RUNTIME wins and nothing is downloaded then.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { project, copy, json, writeJson } from './files.mjs';

export const LATEST_RELEASE =
  'https://api.github.com/repos/solid-multiplatform/platform/releases/latest';
// `releases/latest` leaves out pre-releases, and a beta is all there may be.
export const RECENT_RELEASES =
  'https://api.github.com/repos/solid-multiplatform/platform/releases?per_page=10';
export const PACKAGE = '@solid-multiplatform/host-desktop';

const executable = (platform) =>
  platform.startsWith('win32-') ? 'solid-desktop.exe' : 'solid-desktop';

/** `linux-x64`, `darwin-arm64`: the release asset's platform part. */
export function platformTag(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/** The release asset that carries this system's runtime. */
export function runtimeAssetName(tag) {
  return `solid-desktop-${tag}.tar.gz`;
}

/** The runtime asset in a GitHub release, or one line saying what is there. */
export function runtimeAsset(release, tag = platformTag()) {
  const name = runtimeAssetName(tag);
  const asset = (release.assets ?? []).find((item) => item.name === name);
  if (asset === undefined)
    throw new Error(
      `Release ${release.tag_name ?? '(unknown)'} has no ${name}. Assets: ` +
        ((release.assets ?? []).map((item) => item.name).join(', ') ||
          '(none)'),
    );
  return asset;
}

/** Where runtime.mjs looks inside an installed host package. */
export function runtimeDestination(packageRoot, tag = platformTag()) {
  return path.join(packageRoot, 'prebuilt', tag, executable(tag));
}

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

/** GET a URL, one line on any non-success status. */
export async function download(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'solid-platform',
    },
  });
  if (!response.ok)
    throw new Error(
      `Cannot download ${url}: HTTP ${response.status} ${response.statusText ?? ''}`.trim(),
    );
  return responseBytes(response);
}

/**
 * The runtime asset of the latest release, for this system: the newest
 * release that carries one, pre-releases included. `releases/latest` is
 * skipped when there is none, because GitHub leaves pre-releases out of it.
 */
export async function latestRuntimeAsset({
  tag = platformTag(),
  fetchImpl = fetch,
} = {}) {
  const releases = async (url) =>
    JSON.parse((await download(url, fetchImpl)).toString('utf8'));
  const has = (release) =>
    (release.assets ?? []).some(
      (asset) => asset.name === runtimeAssetName(tag),
    );
  let latest;
  try {
    latest = await releases(LATEST_RELEASE);
  } catch {
    latest = undefined;
  }
  if (latest && has(latest)) return runtimeAsset(latest, tag);
  const recent = await releases(RECENT_RELEASES);
  const carrying = recent.find(has);
  if (!carrying)
    throw new Error(
      `No release on GitHub carries ${runtimeAssetName(tag)}; pass a tarball or a URL instead, or set SOLID_DESKTOP_RUNTIME.`,
    );
  return runtimeAsset(carrying, tag);
}

/**
 * The default extraction: the system's tar, from a temporary file. Windows 10
 * (1803 and later) ships `tar.exe` (bsdtar) in System32, so the same command
 * works there; the archive is named relative to the working directory so a
 * drive letter in its path is never read as a remote host by a GNU tar from
 * Git Bash.
 */
function extractTarball(bytes, directory) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'solid-runtime-'));
  try {
    writeFileSync(path.join(scratch, 'runtime.tar.gz'), bytes);
    const result = spawnSync(
      'tar',
      ['-xzf', 'runtime.tar.gz', '-C', directory],
      {
        cwd: scratch,
        stdio: 'inherit',
      },
    );
    if (result.error) {
      throw new Error(
        `Cannot run tar (${result.error.message}). Windows 10 1803+ has one in System32; ` +
          'on an older Windows, extract the archive by hand.',
      );
    }
    if (result.status !== 0)
      throw new Error(`tar failed (${result.status ?? result.signal})`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const defaultFs = {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
};

/**
 * Put this system's runtime inside an installed host package (or leave
 * SOLID_DESKTOP_RUNTIME alone). Dependencies are injected so the resolution
 * can be tested without a network or a real filesystem.
 *
 * @returns {Promise<{ path: string, source: 'environment' | 'release', asset?: string }>}
 */
export async function installRuntime({
  packageRoot,
  tag = platformTag(),
  env = process.env,
  fetchImpl = fetch,
  fs = defaultFs,
  extract = extractTarball,
  asset,
} = {}) {
  if (env.SOLID_DESKTOP_RUNTIME) {
    const named = path.resolve(env.SOLID_DESKTOP_RUNTIME);
    if (!fs.existsSync(named))
      throw new Error(
        `SOLID_DESKTOP_RUNTIME names ${named}, which does not exist`,
      );
    return { path: named, source: 'environment' };
  }
  if (packageRoot === undefined)
    throw new Error(
      `No ${PACKAGE} is installed in this app. Install it first (solid-platform add desktop <release.tgz>), then fetch the runtime.`,
    );
  const chosen = asset ?? (await latestRuntimeAsset({ tag, fetchImpl }));
  const bytes = await download(chosen.browser_download_url, fetchImpl);
  const directory = path.dirname(runtimeDestination(packageRoot, tag));
  fs.mkdirSync(directory, { recursive: true });
  extract(bytes, directory);
  const file = runtimeDestination(packageRoot, tag);
  if (!fs.existsSync(file))
    throw new Error(
      `The ${chosen.name} archive did not contain ${path.basename(file)}`,
    );
  fs.chmodSync(file, 0o755);
  return { path: file, source: 'release', asset: chosen.name };
}

/**
 * Copy a release package into `vendor/` and point the app at it. The
 * dependency is a `file:` path, as `add video` writes, so pnpm install
 * resolves the app's own copy.
 */
export function addHostPackage(root, archive) {
  if (!archive.endsWith('.tgz') || !existsSync(archive))
    throw new Error(
      'Provide the downloaded Solid Multiplatform desktop host .tgz',
    );
  const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const name = 'solid-host-desktop-' + sha.slice(0, 16) + '.tgz';
  copy(archive, path.join(root, 'vendor', name));
  const file = path.join(root, 'package.json');
  const pkg = json(file);
  pkg.dependencies ??= {};
  pkg.dependencies[PACKAGE] = 'file:vendor/' + name;
  const temp = mkdtempSync(path.join(root, '.solid-deps-'));
  try {
    writeJson(path.join(temp, 'package.json'), pkg);
    renameSync(path.join(temp, 'package.json'), file);
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
  return name;
}

/** The installed package's directory, when pnpm has put it there. */
export function installedPackage(root) {
  const dir = path.join(root, 'node_modules', PACKAGE);
  return existsSync(path.join(dir, 'package.json')) ? dir : undefined;
}

const isUrl = (value) => /^https?:\/\//i.test(value);

/**
 * The command. `source` is a tarball, a URL, `none`, or undefined (runtime
 * only). Returns lines to print.
 *
 * @returns {Promise<string[]>}
 */
export async function addDesktop(root, source, options = {}) {
  const config = project(root);
  if (!config.targets.includes('desktop'))
    throw new Error(
      `The app does not have the desktop target (${config.targets.join(', ')}).`,
    );
  const lines = [];
  if (source !== undefined && source !== 'none') {
    let archive = source;
    let downloaded;
    if (isUrl(source)) {
      const bytes = await download(source, options.fetchImpl);
      const dir = path.join(root, 'vendor');
      mkdirSync(dir, { recursive: true });
      downloaded = path.join(
        dir,
        'solid-host-desktop-download-' +
          createHash('sha256').update(bytes).digest('hex').slice(0, 16) +
          '.tgz',
      );
      writeFileSync(downloaded, bytes);
      archive = downloaded;
    }
    const name = addHostPackage(root, path.resolve(root, archive));
    if (downloaded !== undefined) rmSync(downloaded, { force: true });
    lines.push(
      `Added ${PACKAGE}: vendor/${name}. Run corepack pnpm install in the app.`,
      `If that package carries no runtime for ${platformTag()}, run \`solid-platform add desktop none\` after the install.`,
    );
    return lines;
  }
  const packageRoot = options.packageRoot ?? installedPackage(root);
  if (packageRoot === undefined)
    throw new Error(
      `No ${PACKAGE} is installed yet: install the package, then run \`solid-platform add desktop none\` to fetch the ${platformTag()} runtime.`,
    );
  const runtime = await installRuntime({
    ...options,
    packageRoot,
    tag: options.tag ?? platformTag(),
  });
  lines.push(
    runtime.source === 'environment'
      ? `Using the runtime named by SOLID_DESKTOP_RUNTIME: ${runtime.path}`
      : `Installed the desktop runtime (${runtime.asset}) at ${runtime.path}`,
  );
  return lines;
}
