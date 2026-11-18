import path from 'node:path';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { build } from './build.mjs';
import { command, copy, project, write } from './files.mjs';

export function packageDesktop(root) {
  const config = project(root);
  build(root, 'desktop');
  const dir = path.join(root, 'targets/desktop');
  const name = config.name + '-' + process.platform + '-' + process.arch;
  const scratch = mkdtempSync(path.join(tmpdir(), 'solid-dist-')),
    stage = path.join(scratch, name);
  try {
    const dest = path.join(stage, 'targets/desktop');
    copy(path.join(root, 'vendor'), path.join(stage, 'vendor'));
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ]) {
      if (existsSync(path.join(dir, file)))
        copy(path.join(dir, file), path.join(dest, file));
    }
    command(
      'corepack',
      [
        'pnpm',
        'install',
        '--prod',
        '--frozen-lockfile',
        '--config.node-linker=hoisted',
      ],
      dest,
    );
    copy(path.join(dir, 'work'), path.join(dest, 'work'));
    copy(
      process.execPath,
      path.join(stage, 'bin', path.basename(process.execPath)),
    );
    const license = [
      path.resolve(path.dirname(process.execPath), '../LICENSE'),
      path.resolve(path.dirname(process.execPath), 'LICENSE'),
      '/usr/share/licenses/nodejs/LICENSE',
      '/usr/share/doc/nodejs/copyright',
    ].find(existsSync);
    if (!license) throw new Error('Node distribution license unavailable');
    copy(license, path.join(stage, 'licenses', 'Node-LICENSE'));
    const sdl =
      process.env.SOLID_SDL3_LIBRARY ??
      (process.platform === 'linux'
        ? [
            '/usr/lib/libSDL3.so.0',
            '/usr/lib/x86_64-linux-gnu/libSDL3.so.0',
          ].find(existsSync)
        : undefined);
    if (!sdl || !existsSync(sdl))
      throw new Error('Set SOLID_SDL3_LIBRARY to the SDL3 library to package.');
    const lib = path.basename(sdl);
    copy(realpathSync(sdl), path.join(stage, 'lib', lib));
    copy(
      new URL('../hosts/desktop/SDL-LICENSE.txt', import.meta.url),
      path.join(stage, 'licenses/SDL-LICENSE.txt'),
    );
    rmSync(path.join(stage, 'vendor'), { recursive: true, force: true });
    if (process.platform === 'win32')
      write(
        path.join(stage, 'launch.cmd'),
        `@echo off\r\nset "SOLID_SDL3_LIBRARY=%~dp0lib\\${lib}"\r\n"%~dp0bin\\node.exe" "%~dp0targets\\desktop\\work\\run.mjs"\r\n`,
      );
    else {
      write(
        path.join(stage, 'launch'),
        `#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport SOLID_SDL3_LIBRARY="$root/lib/${lib}"\nexec "$root/bin/node" "$root/targets/desktop/work/run.mjs" "$@"\n`,
      );
      chmodSync(path.join(stage, 'launch'), 0o755);
    }
    const out = path.join(dir, 'dist');
    mkdirSync(out, { recursive: true });
    const archive = path.join(out, name + '.tar.gz');
    command('tar', ['-czf', archive + '.partial', '-C', scratch, name], root);
    renameSync(archive + '.partial', archive);
    console.log(archive);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
