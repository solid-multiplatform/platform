import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const defaultRun = promisify(execFile);

/** Codesign arguments for a macOS/tvOS/iOS app bundle or executable. */
export function codesignArgs({
  identity,
  path,
  entitlements,
  deep = true,
  timestamp = true,
}) {
  if (!identity) throw new Error('codesign requires an identity');
  if (!path) throw new Error('codesign requires a path');
  const args = ['--force', '--options', 'runtime'];
  if (deep) args.push('--deep');
  if (timestamp) args.push('--timestamp');
  if (entitlements) args.push('--entitlements', entitlements);
  args.push('--sign', identity, path);
  return args;
}

/** notarytool submission arguments. Prefer a keychain profile in CI. */
export function notarytoolArgs({
  file,
  appleId,
  teamId,
  password,
  keychainProfile,
  wait = true,
}) {
  if (!file) throw new Error('notarytool requires a file');
  const args = ['notarytool', 'submit', file];
  if (keychainProfile) {
    args.push('--keychain-profile', keychainProfile);
  } else {
    if (!appleId || !teamId || !password) {
      throw new Error(
        'notarytool requires appleId, teamId and password, or a keychain profile',
      );
    }
    args.push(
      '--apple-id',
      appleId,
      '--team-id',
      teamId,
      '--password',
      password,
    );
  }
  if (wait) args.push('--wait');
  return args;
}

/** Build the release hooks consumed by `createReleasePipeline`. */
export function createAppleSigningHooks({
  appPath,
  identity,
  entitlements,
  appleId,
  teamId,
  password,
  keychainProfile,
  notarize = true,
  staple = true,
  runner = defaultRun,
  onCommand,
} = {}) {
  if (!appPath) throw new Error('Apple signing requires an app path');
  const run = async (command, args) => {
    onCommand?.(command, args);
    return runner(command, args);
  };
  const hooks = [
    {
      name: 'apple:codesign',
      run: async () => {
        await run(
          'codesign',
          codesignArgs({ identity, path: appPath, entitlements }),
        );
      },
    },
    {
      name: 'apple:verify',
      run: async () => {
        await run('codesign', [
          '--verify',
          '--deep',
          '--strict',
          '--verbose=2',
          appPath,
        ]);
      },
    },
  ];
  if (notarize) {
    hooks.push({
      name: 'apple:notarize',
      run: async () => {
        await run(
          'xcrun',
          notarytoolArgs({
            file: appPath,
            appleId,
            teamId,
            password,
            keychainProfile,
          }),
        );
      },
    });
  }
  if (staple) {
    hooks.push({
      name: 'apple:staple',
      run: async () => {
        await run('xcrun', ['stapler', 'staple', appPath]);
      },
    });
  }
  return hooks;
}
