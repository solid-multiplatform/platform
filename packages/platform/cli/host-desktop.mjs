// Where the desktop host's build tool is. It is an optional peer of the app:
// `solid-platform add desktop` installs it, and the CLI uses the app's copy;
// in this monorepo the workspace package is the fallback.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { CliError } from './context.mjs';
import { framework } from './files.mjs';

/** The package directory, or undefined when the app has none. */
export function hostDesktopPackage(root) {
  return [
    path.join(root, 'node_modules/@solid-multiplatform/host-desktop'),
    path.join(framework, '../host-desktop'),
  ].find((dir) => existsSync(path.join(dir, 'package.json')));
}

/** Its CLI entry, or undefined. */
export function hostDesktopCli(root) {
  const dir = hostDesktopPackage(root);
  return dir === undefined ? undefined : path.join(dir, 'cli/index.mjs');
}

/** Its CLI entry, with one line that says how to get it when it is absent. */
export function requireHostDesktopCli(root) {
  const file = hostDesktopCli(root);
  if (file === undefined)
    throw new CliError(
      'The desktop target needs @solid-multiplatform/host-desktop. Run `solid-platform add desktop` in the app, then install its dependencies.',
    );
  return file;
}
