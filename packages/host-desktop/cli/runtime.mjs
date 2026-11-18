// Finds the desktop runtime's executable for this machine. An app developer
// needs no Rust, Python or C++ compiler when one has been built for them:
//
//   1. SOLID_DESKTOP_RUNTIME, a path to it;
//   2. the one shipped in this package for this system,
//      prebuilt/<platform>-<arch>/solid-desktop (CI's artifact);
//   3. a build from source, when HERMES_SRC and HERMES_BUILD are set and
//      cargo is installed (native/README.md).
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const native = path.resolve(here, '../native');
const executable =
  process.platform === 'win32' ? 'solid-desktop.exe' : 'solid-desktop';

/** `linux-x64`, `darwin-arm64`, `win32-x64`: Node's names for both. */
export const platformName = `${process.platform}-${process.arch}`;

/** Where the runtime shipped in this package for this system would be. */
export const prebuiltRuntime = path.resolve(
  here,
  '../prebuilt',
  platformName,
  executable,
);

/** Where a build from source in this checkout puts it. */
export const builtRuntime = path.join(native, 'target/release', executable);

/** Whether a build from source can be made here, and if not, why. */
export function sourceBuild() {
  const missing = [];
  for (const name of ['HERMES_SRC', 'HERMES_BUILD']) {
    const value = process.env[name];
    if (!value) missing.push(`${name} is not set`);
    else if (!existsSync(value)) missing.push(`${name} (${value}) is missing`);
  }
  if (spawnSync('cargo', ['--version']).status !== 0) {
    missing.push('cargo is not installed');
  }
  if (!existsSync(path.join(native, 'Cargo.toml'))) {
    missing.push("this package was installed without the runtime's sources");
  }
  return { possible: missing.length === 0, missing };
}

/**
 * The runtime to use, without building anything: `{ path, source }` where
 * `source` is `environment`, `prebuilt` or `build`, or undefined when there
 * is none and one would have to be built.
 *
 * @returns {{ path: string, source: 'environment' | 'prebuilt' | 'build' } | undefined}
 */
export function locateRuntime() {
  const named = process.env.SOLID_DESKTOP_RUNTIME;
  if (named) {
    if (!existsSync(named)) {
      throw new Error(
        `SOLID_DESKTOP_RUNTIME names ${named}, which does not exist`,
      );
    }
    return { path: path.resolve(named), source: 'environment' };
  }
  if (existsSync(prebuiltRuntime)) {
    return { path: prebuiltRuntime, source: 'prebuilt' };
  }
  return undefined;
}

/**
 * The runtime's path, building it from source when that is the only way.
 * Throws one message that says what to do when there is no way.
 *
 * @returns {string}
 */
export function findRuntime() {
  const located = locateRuntime();
  if (located !== undefined) return located.path;
  const { possible, missing } = sourceBuild();
  if (!possible) {
    throw new Error(
      `No desktop runtime for ${platformName}: set SOLID_DESKTOP_RUNTIME to a solid-desktop executable, ` +
        `or put one at ${prebuiltRuntime}, or build it from source (${missing.join('; ')})`,
    );
  }
  // Cargo does nothing when the build is current.
  execFileSync('cargo', ['build', '--release', '--locked'], {
    cwd: native,
    stdio: ['ignore', process.stderr, 'inherit'],
  });
  return builtRuntime;
}

/**
 * What a runtime says it is made of (`--diagnostics`).
 *
 * @param {string} runtime
 * @returns {{ version: string, target: string, sdl: string, sdlLinkage: 'static' | 'dynamic', videoDrivers: string[], accessibility: string, notifications: string }}
 */
export function runtimeDiagnostics(runtime) {
  const lines = Object.fromEntries(
    execFileSync(runtime, ['--diagnostics'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split(' ');
        return [key, rest];
      }),
  );
  return {
    version: lines['solid-desktop']?.[0] ?? '',
    target: lines.target?.[0] ?? '',
    sdl: lines.sdl?.[0] ?? '',
    sdlLinkage: lines.sdl?.[1] === 'static' ? 'static' : 'dynamic',
    videoDrivers: lines['video-drivers'] ?? [],
    // `at-spi` where the scene's semantics reach assistive technology.
    accessibility: lines.accessibility?.[0] ?? 'none',
    // `dbus` where the desktop's notification service can be reached.
    notifications: lines.notifications?.[0] ?? 'none',
  };
}
