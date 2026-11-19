// @ts-check
// Android and Android TV share the NativeScript build, the SDK tools and adb.
import path from 'node:path';
import { CliError, run } from '../context.mjs';
import {
  buildTarget,
  commonChecks,
  missing,
  ok,
} from '../target-helpers.mjs';

/** @typedef {import('../types.d.ts').TargetContext} TargetContext */
/** @typedef {{ serial: string, state: string, kind: 'emulator' | 'physical', model?: string, product?: string }} AdbDevice */

const activity = 'com.tns.NativeScriptActivity';
const debugApk = 'platforms/android/app/build/outputs/apk/debug/app-debug.apk';

/**
 * Reads the output of `adb devices -l`.
 * @param {string} text
 * @returns {AdbDevice[]}
 */
export function parseAdbDevices(text) {
  /** @type {AdbDevice[]} */
  const devices = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('List of devices') || line.startsWith('*'))
      continue;
    const [serial, state, ...rest] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    const facts = Object.fromEntries(
      rest.filter((part) => part.includes(':')).map((part) => {
        const at = part.indexOf(':');
        return [part.slice(0, at), part.slice(at + 1)];
      }),
    );
    devices.push({
      serial,
      state,
      kind: serial.startsWith('emulator-') ? 'emulator' : 'physical',
      model: facts.model,
      product: facts.product,
    });
  }
  return devices;
}

/**
 * Chooses the device to install on. One attached device is used as is. With
 * more than one, `--device` is required, so a physical device is never chosen
 * over an emulator (or the other way round) by accident.
 * @param {AdbDevice[]} devices
 * @param {string | undefined} requested the `--device` value
 * @returns {AdbDevice}
 */
export function selectDevice(devices, requested) {
  const ready = devices.filter((device) => device.state === 'device');
  if (requested) {
    const chosen = devices.find((device) => device.serial === requested);
    if (!chosen)
      throw new CliError(
        `Device ${requested} is not attached. Run \`solid-platform devices android\`.`,
      );
    if (chosen.state !== 'device')
      throw new CliError(`Device ${requested} is ${chosen.state}, not ready.`);
    return chosen;
  }
  if (!ready.length)
    throw new CliError(
      'No Android device is attached. Start an emulator or connect a device, then run `solid-platform devices android`.',
    );
  const only = /** @type {AdbDevice} */ (ready[0]);
  // An emulator that is listed but still starting counts as attached: the
  // ready physical device beside it is not chosen for the user.
  const emulators = devices.filter((d) => d.kind === 'emulator').length;
  if (ready.length > 1 || (only.kind === 'physical' && emulators > 0))
    throw new CliError(
      `${devices.length} Android devices are attached (${emulators} emulator, ${devices.length - emulators} physical). Choose one with --device <id>; \`solid-platform devices android\` lists them.`,
    );
  return only;
}

/** @param {TargetContext} ctx */
const sdkRoot = (ctx) => ctx.env.ANDROID_SDK_ROOT || ctx.env.ANDROID_HOME;

/** @param {TargetContext} ctx @param {string} tool @param {string} dir */
function sdkTool(ctx, tool, dir) {
  const onPath = ctx.which(tool);
  if (onPath) return onPath;
  const sdk = sdkRoot(ctx);
  const inSdk = sdk && path.join(sdk, dir, tool);
  return inSdk && ctx.exists(inSdk) ? inSdk : null;
}

/** @param {TargetContext} ctx */
function adb(ctx) {
  const tool = sdkTool(ctx, 'adb', 'platform-tools');
  if (!tool)
    throw new CliError(
      'adb not found. Install the Android SDK platform-tools and add them to PATH.',
    );
  return tool;
}

/** @param {TargetContext} ctx */
const attached = (ctx) =>
  parseAdbDevices(run(ctx, adb(ctx), ['devices', '-l'], 'adb devices'));

/**
 * The application id the build installs: the one in the target's
 * nativescript.config.ts, which `init` wrote. The config's `id` is used when
 * that file does not name one, and must agree with it otherwise.
 * @param {TargetContext} ctx
 * @param {string} target
 */
export function applicationId(ctx, target) {
  const file = path.join(ctx.root, 'targets', target, 'nativescript.config.ts');
  const built = ctx.exists(file)
    ? /\bid:\s*['"]([^'"]+)['"]/.exec(ctx.readFile(file))?.[1]
    : undefined;
  const configured = ctx.config.id;
  if (built && configured && built !== configured)
    throw new CliError(
      `${ctx.config.source}: id is ${configured} but targets/${target}/nativescript.config.ts builds ${built}. Make them the same.`,
    );
  const id = built ?? configured;
  if (!id)
    throw new CliError(
      `No application id: set id in ${ctx.config.source} or in targets/${target}/nativescript.config.ts.`,
    );
  return id;
}

/**
 * @param {'android' | 'android-tv'} name
 * @returns {import('../types.d.ts').TargetDefinition}
 */
export function androidTarget(name) {
  /** @param {TargetContext} ctx @param {string | undefined} requested */
  const device = (ctx, requested) => selectDevice(attached(ctx), requested);
  return {
    name,
    family: 'android',
    summary:
      name === 'android'
        ? 'Android phones and tablets (NativeScript)'
        : 'Android TV and Google TV (NativeScript)',

    doctor(ctx) {
      const checks = commonChecks(ctx);
      const javaHome = ctx.env.JAVA_HOME;
      const java = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
      const found =
        javaHome || ctx.which('java') ? ctx.exec(java, ['-version']) : undefined;
      const version = /version "(\d+)[^"]*"/.exec(
        String(found?.stderr ?? '') + String(found?.stdout ?? ''),
      );
      if (found?.status === 0 && version?.[1] === '21')
        checks.push(ok('java', 'JDK 21'));
      else
        checks.push(
          missing(
            'java',
            (version ? `JDK ${version[1]} found; ` : '') +
              'install JDK 21 and point JAVA_HOME at it',
          ),
        );
      const sdk = sdkRoot(ctx);
      if (sdk && ctx.exists(sdk))
        checks.push(ok('android-sdk', 'SDK directory is set and exists'));
      else
        checks.push(
          missing(
            'android-sdk',
            sdk
              ? 'ANDROID_SDK_ROOT (or ANDROID_HOME) is set but the directory does not exist'
              : 'set ANDROID_SDK_ROOT to the Android SDK directory',
          ),
        );
      const ndks = sdk ? ctx.readdir(path.join(sdk, 'ndk')) : [];
      checks.push(
        ndks.length
          ? ok('android-ndk', 'NDK ' + ndks.sort().at(-1))
          : missing(
              'android-ndk',
              'install an NDK with the SDK manager; plugins with native code need it',
              false,
            ),
      );
      checks.push(
        sdkTool(ctx, 'adb', 'platform-tools')
          ? ok('adb', 'found')
          : missing(
              'adb',
              'install the SDK platform-tools; run, logs and screenshot need adb',
              false,
            ),
      );
      return checks;
    },

    build(ctx, options) {
      buildTarget(ctx, name, options);
    },

    devices(ctx) {
      const devices = attached(ctx);
      if (!devices.length) ctx.out('android  no device attached');
      for (const d of devices)
        ctx.out(
          `android  ${d.kind.padEnd(8)}  ${d.serial}  ${d.state}${d.model ? '  ' + d.model : ''}`,
        );
      const emulator = sdkTool(ctx, 'emulator', 'emulator');
      const listed = emulator ? ctx.exec(emulator, ['-list-avds']) : undefined;
      const avds =
        listed?.status === 0
          ? String(listed.stdout)
              .split(/\r?\n/)
              // The emulator prints notices before the names on some versions.
              .filter((line) => /^[\w.-]+$/.test(line.trim()))
          : [];
      for (const avd of avds) ctx.out(`android  avd       ${avd.trim()}`);
      if (!emulator) ctx.out('android  avd       emulator tool not found');
    },

    run(ctx, options) {
      if (options.build !== false) buildTarget(ctx, name);
      const apk = path.join(ctx.root, 'targets', name, debugApk);
      if (!ctx.exists(apk))
        throw new CliError(
          `No APK at targets/${name}/${debugApk}. Run \`solid-platform build ${name}\`.`,
        );
      const id = applicationId(ctx, name);
      const { serial } = device(ctx, options.device);
      const tool = adb(ctx);
      run(ctx, tool, ['-s', serial, 'install', '-r', apk], 'adb install');
      run(
        ctx,
        tool,
        ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${id}/${activity}`],
        'am start',
      );
      ctx.out(`Started ${id} on ${serial}`);
    },

    logs(ctx, options) {
      const id = applicationId(ctx, name);
      const { serial } = device(ctx, options.device);
      const tool = adb(ctx);
      const pid = String(
        ctx.exec(tool, ['-s', serial, 'shell', 'pidof', id]).stdout,
      )
        .trim()
        .split(/\s+/)[0];
      if (!pid || !/^\d+$/.test(pid))
        throw new CliError(
          `${id} is not running on ${serial}. Start it with \`solid-platform run ${name}\`.`,
        );
      ctx.exec(tool, ['-s', serial, 'logcat', '--pid=' + pid], {
        stdio: 'inherit',
      });
    },

    screenshot(ctx, options) {
      const { serial } = device(ctx, options.device);
      const shot = ctx.exec(
        adb(ctx),
        ['-s', serial, 'exec-out', 'screencap', '-p'],
        { binary: true },
      );
      const png = Buffer.from(/** @type {Uint8Array} */ (shot.stdout));
      if (shot.status !== 0 || png.subarray(1, 4).toString('latin1') !== 'PNG')
        throw new CliError(`Could not take a screenshot on ${serial}.`);
      ctx.writeFile(options.file, png);
      ctx.out(`Wrote ${options.file}`);
    },

    package(ctx) {
      const signing = ctx.config.signing[name];
      const required = ['keystore', 'alias', 'storePasswordEnv', 'keyPasswordEnv'];
      for (const key of required)
        if (!signing?.[key])
          throw new CliError(
            `${ctx.config.source}: signing.${name}.${key} is required to package ${name}.`,
          );
      const secrets = [signing?.storePasswordEnv, signing?.keyPasswordEnv].map(
        (variable) => {
          const value = ctx.env[/** @type {string} */ (variable)];
          if (!value)
            throw new CliError(`Set ${variable} to package ${name}.`);
          return value;
        },
      );
      // Stage sources and plugins exactly as a normal build does, then make
      // the signed release from the same project.
      buildTarget(ctx, name);
      const result = ctx.exec(
        'corepack',
        [
          'pnpm',
          'exec',
          'ns',
          'build',
          'android',
          '--release',
          '--env.production',
          '--no-hmr',
          '--key-store-path',
          path.resolve(ctx.root, /** @type {string} */ (signing?.keystore)),
          '--key-store-password',
          /** @type {string} */ (secrets[0]),
          '--key-store-alias',
          /** @type {string} */ (signing?.alias),
          '--key-store-alias-password',
          /** @type {string} */ (secrets[1]),
        ],
        { cwd: path.join(ctx.root, 'targets', name), stdio: 'inherit' },
      );
      if (result.status !== 0)
        throw new CliError(`The ${name} release build failed.`);
      ctx.out(
        `Release APK: targets/${name}/platforms/android/app/build/outputs/apk/release/`,
      );
    },
  };
}
