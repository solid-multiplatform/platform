import * as v from 'vitest';
import {
  codesignArgs,
  createAppleSigningHooks,
  notarytoolArgs,
} from '../hosts/apple/signing.mjs';
import { createReleasePipeline } from '../src/sdk/release.js';

v.describe('Apple signing hooks', () => {
  v.it('builds codesign and notarytool arguments', () => {
    v.expect(
      codesignArgs({
        identity: 'Developer ID Application: App',
        path: '/build/App.app',
        entitlements: '/build/App.entitlements',
      }),
    ).toEqual([
      '--force',
      '--options',
      'runtime',
      '--deep',
      '--timestamp',
      '--entitlements',
      '/build/App.entitlements',
      '--sign',
      'Developer ID Application: App',
      '/build/App.app',
    ]);
    v.expect(
      notarytoolArgs({
        file: '/build/App.zip',
        appleId: 'dev@example.test',
        teamId: 'TEAM',
        password: 'app-password',
      }),
    ).toEqual([
      'notarytool',
      'submit',
      '/build/App.zip',
      '--apple-id',
      'dev@example.test',
      '--team-id',
      'TEAM',
      '--password',
      'app-password',
      '--wait',
    ]);
    v.expect(
      notarytoolArgs({
        file: '/build/App.zip',
        keychainProfile: 'release-profile',
      }),
    ).toEqual([
      'notarytool',
      'submit',
      '/build/App.zip',
      '--keychain-profile',
      'release-profile',
      '--wait',
    ]);
  });

  v.it('runs sign, verify, notarize and staple in order', async () => {
    const commands = [];
    const hooks = createAppleSigningHooks({
      appPath: '/build/App.app',
      identity: 'Developer ID Application: App',
      appleId: 'dev@example.test',
      teamId: 'TEAM',
      password: 'app-password',
      runner: async (command, args) => {
        commands.push([command, args]);
        return { stdout: '', stderr: '' };
      },
    });
    await createReleasePipeline(hooks).run({
      target: 'macos',
      version: '1.0.0',
    });
    v.expect(commands.map(([command]) => command)).toEqual([
      'codesign',
      'codesign',
      'xcrun',
      'xcrun',
    ]);
    v.expect(commands[0][1]).toContain('--sign');
    v.expect(commands[1][1]).toEqual([
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '/build/App.app',
    ]);
    v.expect(commands[2][1].slice(0, 2)).toEqual(['notarytool', 'submit']);
    v.expect(commands[3][1]).toEqual(['stapler', 'staple', '/build/App.app']);
  });

  v.it('validates required identity and notary credentials', () => {
    v.expect(() => codesignArgs({ path: '/App.app' })).toThrowError(/identity/);
    v.expect(() => notarytoolArgs({ file: '/App.zip' })).toThrowError(
      /appleId|keychain/,
    );
  });
});
