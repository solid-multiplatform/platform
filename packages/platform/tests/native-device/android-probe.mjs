#!/usr/bin/env node
// Builds the Android service probe and runs its steps on an emulator. Run from
// packages/platform after a build; a directory holds one form's app:
//
//   node tests/native-device/android-probe.mjs build <directory> <phone|tv> [--sync]
//   node tests/native-device/android-probe.mjs install <directory> <phone|tv> <emulator-serial>
//   node tests/native-device/android-probe.mjs step <directory> <emulator-serial> <step> [key=value ...]
//   node tests/native-device/android-probe.mjs remove <directory> <emulator-serial>
//
// `build` creates the app with the CLI, as a user would, then adds the probe
// screen and the manifest entries the services need (the step the CLI does
// not do yet); `--sync` copies this checkout's hosts into an app built
// earlier. `step` runs one step of ./android-probe/app.tsx and prints its
// result; what the step did is then checked from outside with adb (dumpsys,
// run-as). Only emulators are accepted: the checks change device settings.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_SERVICES,
  androidManifestRequirements,
  applyAndroidManifestRequirements,
} from '../../hosts/nativescript/providers/android/requirements.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const framework = path.resolve(here, '../..');
const sources = path.join(here, 'android-probe');
const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
const adbPath = sdk ? path.join(sdk, 'platform-tools/adb') : 'adb';

const TARGETS = { phone: 'android', tv: 'android-tv' };
const JOB = 'dev.solidprobe.ProbeJobService';
const LINK_FILTER = `      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="solidprobe" />
      </intent-filter>
`;
// Only to seed test contacts; no provider writes contacts.
const SEEDING =
  '  <uses-permission android:name="android.permission.WRITE_CONTACTS" />\n';

export const packageOf = (directory) =>
  'dev.solidapp.a' + path.basename(directory).replaceAll('-', '');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

/** adb against one emulator. Anything else is refused. */
export function device(serial) {
  if (!/^emulator-\d+$/.test(serial))
    throw new Error('Expected an emulator serial (emulator-<port>)');
  const adb = (...args) =>
    execFileSync(adbPath, ['-s', serial, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const shell = (command) => adb('shell', command);
  /** The command's output, or '' when it fails. */
  const tryShell = (command) => {
    try {
      return shell(command);
    } catch (error) {
      return String(error.stdout ?? '');
    }
  };
  return { serial, adb, shell, tryShell };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The probe app on one emulator: starts steps and reads their results. */
export function probe(emulator, id) {
  let sequence = 0;
  const { shell, tryShell } = emulator;
  const read = (name) => {
    const text = tryShell(
      `run-as ${id} cat files/probe/${name}.json 2>/dev/null`,
    );
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined; // caught the file half-written
    }
  };
  const link = (step, name, args) =>
    `solidprobe://run/${step}?` +
    Object.entries({ id: name, ...args })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  /** Sends a step and returns the name of its result file. */
  const send = (step, args = {}) => {
    const name = `${step}-${Date.now()}-${sequence++}`;
    shell(
      `am start -W -a android.intent.action.VIEW -d '${link(step, name, args)}' ${id} >/dev/null`,
    );
    return name;
  };
  const wait = async (name, timeout = 15000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const result = read(name);
      if (result) return result;
      if (Date.now() > end) throw new Error('No result for ' + name);
      await sleep(250);
    }
  };
  return {
    id,
    read,
    send,
    wait,
    /** Runs a step to its result; throws when the step failed. */
    async step(step, args, timeout) {
      const result = await wait(send(step, args), timeout);
      if (!result.ok) throw new Error(`${step}: ${result.error}`);
      return result.value;
    },
    /** Runs a step and returns `{ok, value | error}`. */
    async attempt(step, args, timeout) {
      return wait(send(step, args), timeout);
    },
    /** Polls a recording step's file until `done(value)` holds. */
    async until(name, done, timeout = 15000) {
      const end = Date.now() + timeout;
      for (;;) {
        const value = read(name)?.value;
        if (value && done(value)) return value;
        if (Date.now() > end)
          throw new Error(
            `Timed out on ${name}: ${JSON.stringify(value)?.slice(0, 300)}`,
          );
        await sleep(250);
      }
    },
    /** Kills the app and starts it again with the boot step. */
    async restart() {
      shell(`am force-stop ${id}`);
      shell(`run-as ${id} rm -rf files/probe`);
      shell('input keyevent KEYCODE_WAKEUP');
      tryShell('wm dismiss-keyguard');
      return this.step('boot', {}, 60000);
    },
  };
}

function patchTarget(directory, form) {
  const target = TARGETS[form];
  const resources = path.join(
    directory,
    'targets',
    target,
    'App_Resources/Android/src/main',
  );
  const requirements = androidManifestRequirements(ANDROID_SERVICES, form, {
    jobs: [JOB],
  });
  const manifest = path.join(resources, 'AndroidManifest.xml');
  let xml = applyAndroidManifestRequirements(
    readFileSync(manifest, 'utf8'),
    requirements,
  );
  if (!xml.includes('android:scheme="solidprobe"'))
    xml = xml.replace('    </activity>', LINK_FILTER + '    </activity>');
  if (form === 'phone' && !xml.includes('WRITE_CONTACTS'))
    xml = xml.replace('  <application', SEEDING + '  <application');
  writeFileSync(manifest, xml);
  for (const [file, text] of Object.entries(requirements.resources)) {
    mkdirSync(path.dirname(path.join(resources, 'res', file)), {
      recursive: true,
    });
    writeFileSync(path.join(resources, 'res', file), text);
  }
  cpSync(path.join(sources, 'java'), path.join(resources, 'java'), {
    recursive: true,
  });
  return requirements;
}

/** Replaces the installed package's hosts with this checkout's. */
function syncHosts(directory, form) {
  const installed = path.join(
    directory,
    'targets',
    TARGETS[form],
    'node_modules/@solid-multiplatform/platform/hosts',
  );
  // Fresh files, never writes through a package-store hard link.
  rmSync(installed, { recursive: true, force: true });
  cpSync(path.join(framework, 'hosts'), installed, { recursive: true });
}

function build(directory, forms, sync) {
  const env = {
    ...process.env,
    ORG_GRADLE_PROJECT_abis: process.env.ORG_GRADLE_PROJECT_abis ?? 'x86_64',
  };
  if (!existsSync(directory)) {
    run(
      process.execPath,
      [
        path.join(framework, 'cli/main.mjs'),
        'init',
        directory,
        '--targets',
        forms.map((form) => TARGETS[form]).join(','),
      ],
      { cwd: framework },
    );
    run('corepack', ['pnpm', 'install'], { cwd: directory, env });
  }
  cpSync(path.join(sources, 'app.tsx'), path.join(directory, 'src/app.tsx'));
  for (const form of forms) {
    const requirements = patchTarget(directory, form);
    if (requirements.unavailable.length)
      console.log(
        `${form}: no provider for ${requirements.unavailable.join(', ')}`,
      );
    if (sync) {
      run('corepack', ['pnpm', 'install'], {
        cwd: path.join(directory, 'targets', TARGETS[form]),
        env,
      });
      syncHosts(directory, form);
    }
    run('corepack', ['pnpm', 'build', TARGETS[form]], { cwd: directory, env });
  }
}

export const apkOf = (directory, form) =>
  path.join(
    directory,
    'targets',
    TARGETS[form],
    'platforms/android/app/build/outputs/apk/debug/app-debug.apk',
  );

async function main() {
  const [command, directoryArgument, ...rest] = process.argv.slice(2);
  if (!command || !directoryArgument)
    throw new Error(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 8)
        .join('\n'),
    );
  const directory = path.resolve(directoryArgument);
  const id = packageOf(directory);
  if (command === 'build') {
    const sync = rest.includes('--sync');
    const forms = rest.filter((value) => value in TARGETS);
    if (forms.length !== 1) throw new Error('Expected phone or tv');
    build(directory, forms, sync);
  } else if (command === 'step') {
    const [serial, step, ...pairs] = rest;
    const args = Object.fromEntries(
      pairs.map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
      }),
    );
    const result = await probe(device(serial), id).attempt(step, args, 30000);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'install') {
    const [form, serial] = rest;
    device(serial).adb('install', '-r', apkOf(directory, form));
    console.log(
      JSON.stringify(await probe(device(serial), id).restart(), null, 2),
    );
  } else if (command === 'remove') {
    console.log(device(rest[0]).adb('uninstall', id).trim());
  } else throw new Error('Unknown command: ' + command);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
