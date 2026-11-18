import * as v from 'vitest';
import {
  getCurrentPosition,
  setGeolocationPort,
  watchPosition,
  type GeoPosition,
} from '../src/sdk/geolocation.js';
import {
  authenticate,
  biometricsAvailable,
  setBiometricsPort,
} from '../src/sdk/biometrics.js';
import {
  fileDirectories,
  fileExists,
  listFiles,
  pickFiles,
  readFileBytes,
  readFileText,
  removeFile,
  setFilePickerPort,
  setFileSystemPort,
  writeFileBytes,
  writeFileText,
} from '../src/sdk/files.js';
import {
  compareVersions,
  createUpdateChecker,
  parseVersion,
} from '../src/sdk/update.js';
import {
  bindBackKey,
  createBackDispatcher,
  createShortcuts,
  matchesCombo,
  parseCombo,
} from '../src/sdk/shortcuts.js';

v.describe('geolocation', () => {
  v.afterEach(() => setGeolocationPort(undefined));

  v.it('reads and watches through the host port', async () => {
    const position: GeoPosition = {
      latitude: 51.5,
      longitude: -0.12,
      accuracy: 8,
      timestamp: 10,
    };
    const optionsSeen: unknown[] = [];
    let stop: (() => void) | undefined;
    setGeolocationPort({
      async getCurrent(options) {
        optionsSeen.push(options);
        return position;
      },
      watch(options, listener) {
        optionsSeen.push(options);
        listener(position);
        stop = () => optionsSeen.push('stopped');
        return stop;
      },
    });
    v.expect(await getCurrentPosition({ timeout: 100 })).toEqual(position);
    const seen: GeoPosition[] = [];
    const dispose = watchPosition({ enableHighAccuracy: true }, (next) =>
      seen.push(next),
    );
    v.expect(seen).toEqual([position]);
    dispose();
    v.expect(optionsSeen).toContain('stopped');
  });
});

v.describe('biometrics', () => {
  v.afterEach(() => setBiometricsPort(undefined));

  v.it('reports availability and returns host results', async () => {
    v.expect(biometricsAvailable()).toBe(false);
    v.expect(await authenticate({ reason: 'Unlock' })).toEqual({
      success: false,
      error: 'unavailable',
    });

    setBiometricsPort({
      authenticate: async ({ reason }) => ({
        success: reason === 'Unlock',
        error: reason === 'Unlock' ? undefined : 'cancelled',
      }),
    });
    v.expect(biometricsAvailable()).toBe(true);
    v.expect(await authenticate({ reason: 'Unlock' })).toEqual({
      success: true,
    });
    v.expect(await authenticate({ reason: 'Cancel' })).toEqual({
      success: false,
      error: 'cancelled',
    });
  });
});

v.describe('files', () => {
  v.afterEach(() => {
    setFileSystemPort(undefined);
    setFilePickerPort(undefined);
  });

  v.it('forwards file operations to the host port', async () => {
    const writes: string[] = [];
    setFileSystemPort({
      documentDirectory: '/docs',
      cacheDirectory: '/cache',
      async readText(path) {
        return `text:${path}`;
      },
      async writeText(path, data) {
        writes.push(`text:${path}:${data}`);
      },
      async readBytes() {
        return new Uint8Array([1, 2]);
      },
      async writeBytes(path, data) {
        writes.push(`bytes:${path}:${data.length}`);
      },
      async exists() {
        return true;
      },
      async remove(path) {
        writes.push(`remove:${path}`);
      },
      async list() {
        return [{ name: 'a.txt', path: '/docs/a.txt', size: 3 }];
      },
    });
    v.expect(await readFileText('a.txt')).toBe('text:a.txt');
    await writeFileText('a.txt', 'hello');
    v.expect(Array.from(await readFileBytes('a.bin'))).toEqual([1, 2]);
    await writeFileBytes('a.bin', new Uint8Array([1, 2, 3]));
    v.expect(await fileExists('a.txt')).toBe(true);
    await removeFile('a.txt');
    v.expect(await listFiles('/docs')).toHaveLength(1);
    v.expect(fileDirectories()).toEqual({
      documents: '/docs',
      cache: '/cache',
    });
    v.expect(writes).toEqual([
      'text:a.txt:hello',
      'bytes:a.bin:3',
      'remove:a.txt',
    ]);
  });

  v.it('throws a capability error without a file port', () => {
    v.expect(() => readFileText('x')).toThrowError(/files/);
    v.expect(() => listFiles('/')).toThrowError(/files/);
  });

  v.it('uses the host file picker', async () => {
    setFilePickerPort({
      async pick(options) {
        v.expect(options).toEqual({ accept: 'image/*', multiple: true });
        return [
          {
            name: 'photo.png',
            type: 'image/png',
            size: 4,
            text: async () => 'data',
            bytes: async () => new Uint8Array([1, 2, 3, 4]),
          },
        ];
      },
    });
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    v.expect(files[0]!.name).toBe('photo.png');
    v.expect(await files[0]!.text()).toBe('data');
    v.expect(Array.from(await files[0]!.bytes())).toEqual([1, 2, 3, 4]);
  });
});

v.describe('update checker', () => {
  v.it('parses and compares semantic versions', () => {
    v.expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    v.expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    v.expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    v.expect(compareVersions('1.2', '1.2.0')).toBe(0);
    v.expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    v.expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  v.it('offers only newer versions and tracks errors', async () => {
    let response: { version: string; mandatory?: boolean } | null = {
      version: '1.2.0',
      mandatory: true,
    };
    const checker = createUpdateChecker({
      currentVersion: '1.1.0',
      check: async () => response,
    });
    v.expect(await checker.check()).toMatchObject({ version: '1.2.0' });
    v.expect(checker.update()?.version).toBe('1.2.0');
    checker.dismiss();
    v.expect(checker.update()?.version).toBe('1.2.0');

    response = { version: '1.1.0' };
    v.expect(await checker.check()).toBeNull();
    v.expect(checker.update()).toBeNull();

    const failing = createUpdateChecker({
      currentVersion: '1.0.0',
      check: async () => {
        throw new Error('offline');
      },
    });
    v.expect(await failing.check()).toBeNull();
    v.expect((failing.error() as Error).message).toBe('offline');
    v.expect(failing.checking()).toBe(false);
  });
});

v.describe('keyboard shortcuts', () => {
  v.it('parses combos', () => {
    v.expect(parseCombo('Mod+K')).toMatchObject({
      key: 'k',
      mod: true,
      shift: false,
    });
    v.expect(parseCombo('Shift+?')).toMatchObject({ key: '?', shift: true });
    v.expect(parseCombo('ArrowLeft').key).toBe('ArrowLeft');
    v.expect(parseCombo('Mod++').key).toBe('+');
    v.expect(parseCombo('Escape').key).toBe('Escape');
  });

  v.it('matches platform modifiers and exact shift state', () => {
    const combo = parseCombo('Mod+K');
    const ctrl = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    const meta = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    v.expect(matchesCombo(ctrl, combo, false)).toBe(true);
    v.expect(matchesCombo(meta, combo, true)).toBe(true);
    v.expect(matchesCombo(ctrl, combo, true)).toBe(false);
    v.expect(matchesCombo(meta, combo, false)).toBe(false);
    v.expect(
      matchesCombo(
        new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          shiftKey: true,
        }),
        combo,
        false,
      ),
    ).toBe(false);
  });

  v.it('runs the first matching shortcut and can prevent default', () => {
    const calls: string[] = [];
    const target = new EventTarget();
    const layer = createShortcuts(
      [
        {
          combo: 'Mod+K',
          handler: () => {
            calls.push('palette');
            return true;
          },
        },
        {
          combo: 'Shift+?',
          preventDefault: true,
          handler: () => {
            calls.push('help');
          },
        },
      ],
      target,
    );
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    });
    v.expect(layer.handle(event)).toBe(true);
    v.expect(calls).toEqual(['palette']);
    v.expect(event.defaultPrevented).toBe(true);

    const help = new KeyboardEvent('keydown', {
      key: '?',
      shiftKey: true,
      cancelable: true,
    });
    target.dispatchEvent(help);
    v.expect(calls).toEqual(['palette', 'help']);
    v.expect(help.defaultPrevented).toBe(true);

    v.expect(layer.handle(new KeyboardEvent('keydown', { key: 'x' }))).toBe(
      false,
    );
    layer.dispose();
  });
});

v.describe('back dispatcher', () => {
  v.it('runs handlers top-down and falls back to exit', () => {
    const calls: string[] = [];
    const back = createBackDispatcher({ onExit: () => calls.push('exit') });
    const removeFirst = back.push(() => {
      calls.push('first');
      return false;
    });
    const removeSecond = back.push(() => {
      calls.push('second');
      return true;
    });
    v.expect(back.handle()).toBe(true);
    v.expect(calls).toEqual(['second']);
    removeSecond();
    // The first handler returns false, so the exit action runs.
    v.expect(back.handle()).toBe(true);
    v.expect(calls).toEqual(['second', 'first', 'exit']);
    removeFirst();
    v.expect(back.handle()).toBe(true);
  });

  v.it('binds Escape/Backspace/GoBack to the dispatcher', () => {
    const target = new EventTarget();
    let backs = 0;
    const back = createBackDispatcher();
    back.push(() => {
      backs++;
      return true;
    });
    const dispose = bindBackKey(target, back);
    for (const key of ['Escape', 'Backspace', 'GoBack']) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
      );
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    v.expect(backs).toBe(3);
    dispose();
  });
});
