// @ts-check
// The desktop target. Doctor checks the toolchain of whichever desktop host
// the workspace has (packages/host-desktop/native when present).
import path from 'node:path';
import { CliError } from '../context.mjs';
import { packageDesktop } from '../desktop-package.mjs';
import { framework } from '../files.mjs';
import {
  buildTarget,
  commonChecks,
  missing,
  ok,
} from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */

const sdlLocations = [
  '/usr/lib/libSDL3.so.0',
  '/usr/lib/x86_64-linux-gnu/libSDL3.so.0',
];

/** @type {import('../types.d.ts').TargetDefinition} */
export default {
  name: 'desktop',
  family: 'desktop',
  summary: 'Linux, Windows and macOS (native window, WebGL renderer)',

  doctor(ctx) {
    const checks = commonChecks(ctx);
    const native = path.join(framework, '../host-desktop/native/Cargo.toml');
    if (ctx.exists(native)) {
      checks.push(
        ctx.which('cargo')
          ? ok('cargo', 'found')
          : missing('cargo', 'install Rust from https://rustup.rs'),
      );
      for (const variable of ['HERMES_SRC', 'HERMES_BUILD'])
        checks.push(
          ctx.env[variable]
            ? ok(variable, 'set')
            : missing(
                variable,
                variable === 'HERMES_SRC'
                  ? 'set it to a Hermes source checkout'
                  : 'set it to the Hermes CMake build directory',
              ),
        );
      return checks;
    }
    const sdl = ctx.env.SOLID_SDL3_LIBRARY
      ? ctx.exists(ctx.env.SOLID_SDL3_LIBRARY)
      : ctx.platform === 'linux'
        ? sdlLocations.some((file) => ctx.exists(file))
        : // The Windows build downloads SDL3; macOS loads it by name.
          ctx.platform === 'win32' && ctx.arch === 'x64';
    checks.push(
      sdl
        ? ok('sdl3', 'SDL3 library found')
        : missing(
            'sdl3',
            'install SDL3 or set SOLID_SDL3_LIBRARY to its library; run and package need it',
            false,
          ),
    );
    const compiler =
      ctx.platform === 'win32' ? 'cl' : ctx.env.CC ? 'CC' : 'cc';
    checks.push(
      (compiler === 'CC' ? ctx.env.CC : ctx.which(compiler))
        ? ok('c-compiler', compiler === 'CC' ? 'CC is set' : compiler)
        : missing(
            'c-compiler',
            'install a C compiler; plugins with a worker.c need it',
            false,
          ),
    );
    return checks;
  },

  build(ctx, options) {
    buildTarget(ctx, 'desktop', options);
  },

  run(ctx, options) {
    // A development build of the desktop target ends by opening the app.
    if (options.build !== false) {
      buildTarget(ctx, 'desktop', { dev: true });
      return;
    }
    const dir = path.join(ctx.root, 'targets/desktop');
    const entry = path.join(dir, 'work/run.mjs');
    if (!ctx.exists(entry))
      throw new CliError(
        'No build at targets/desktop/work. Run `solid-platform build desktop`.',
      );
    const result = ctx.exec(process.execPath, [entry], {
      cwd: dir,
      stdio: 'inherit',
    });
    if (result.status !== 0)
      throw new CliError('The desktop app exited with ' + result.status);
  },

  package(ctx) {
    packageDesktop(ctx.root);
  },
};
