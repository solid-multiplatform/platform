import * as v from 'vitest';
import { setCapabilities } from '../src/sdk/capabilities.js';
import {
  getCurrentPosition,
  watchPosition,
  type GeoPosition,
} from '../src/sdk/geolocation.js';
import { authenticate, biometricsAvailable } from '../src/sdk/biometrics.js';
import {
  fileDirectories,
  fileExists,
  listFiles,
  pickFiles,
  readFileBytes,
  readFileText,
  removeFile,
  writeFileBytes,
  writeFileText,
  type FileSystemPort,
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
import { CapabilityError } from '../src/sdk/registry.js';
import { webServices } from '../src/hosts/web-services/index.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

v.describe('geolocation', () => {
  useWebServices();

  v.it('reads and watches through the host port', async () => {
    const position: GeoPosition = {
      latitude: 51.5,
      longitude: -0.12,
      accuracy: 8,
      timestamp: 10,
    };
    const optionsSeen: unknown[] = [];
    let stop: (() => void) | undefined;
    provide({
      geolocation: {
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

  v.it('the web provider uses navigator.geolocation', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    const calls: unknown[] = [];
    const fix = {
      coords: {
        latitude: 1,
        longitude: 2,
        accuracy: 3,
        altitude: null,
        heading: null,
        speed: 4,
      },
      timestamp: 5,
    };
    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: undefined,
      });
      await v
        .expect(getCurrentPosition())
        .rejects.toMatchObject({ capability: 'geolocation' });
      v.expect(() => watchPosition({}, () => {})).toThrowError(CapabilityError);

      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(
            done: (value: unknown) => void,
            _fail: unknown,
            options: unknown,
          ) {
            calls.push(['current', options]);
            done(fix);
          },
          watchPosition(
            next: (value: unknown) => void,
            _fail: unknown,
            options: unknown,
          ) {
            calls.push(['watch', options]);
            next(fix);
            return 7;
          },
          clearWatch(id: number) {
            calls.push(['clear', id]);
          },
        },
      });
      const expected = {
        latitude: 1,
        longitude: 2,
        accuracy: 3,
        altitude: undefined,
        heading: undefined,
        speed: 4,
        timestamp: 5,
      };
      v.expect(await getCurrentPosition({ timeout: 10 })).toEqual(expected);
      const seen: GeoPosition[] = [];
      const stop = watchPosition({ maximumAge: 1 }, (next) => seen.push(next));
      v.expect(seen).toEqual([expected]);
      stop();
      v.expect(calls).toEqual([
        ['current', { timeout: 10 }],
        ['watch', { maximumAge: 1 }],
        ['clear', 7],
      ]);
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else delete (navigator as { geolocation?: unknown }).geolocation;
    }
  });

  v.it(
    'a host without a geolocation service never asks the browser',
    async () => {
      const restore = forbid(navigator, 'geolocation');
      try {
        await withoutServices(async () => {
          await v.expect(getCurrentPosition()).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'geolocation',
          });
          v.expect(() => watchPosition({}, () => {})).toThrowError(
            CapabilityError,
          );
        });
      } finally {
        restore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['geolocation'] });
    },
  );
});

v.describe('biometrics', () => {
  useWebServices();

  v.it('reports availability and returns host results', async () => {
    v.expect(biometricsAvailable()).toBe(false);
    v.expect(await authenticate({ reason: 'Unlock' })).toEqual({
      success: false,
      error: 'unavailable',
    });

    provide({
      biometrics: {
        authenticate: async ({ reason }) => ({
          success: reason === 'Unlock',
          error: reason === 'Unlock' ? undefined : 'cancelled',
        }),
      },
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

  v.it(
    'is unavailable in the browser and on a host that installed nothing',
    async () => {
      const credentials = forbid(navigator, 'credentials');
      try {
        v.expect(webServices.biometrics).toBeUndefined();
        await withoutServices(async () => {
          v.expect(biometricsAvailable()).toBe(false);
          v.expect(await authenticate({ reason: 'Unlock' })).toEqual({
            success: false,
            error: 'unavailable',
          });
        });
      } finally {
        credentials();
      }
    },
  );
});

v.describe('files', () => {
  useWebServices();

  v.it('forwards file operations to the host port', async () => {
    const writes: string[] = [];
    const fileSystem: FileSystemPort = {
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
    };
    provide({ fileSystem });
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

  v.it('throws a capability error without a file system service', async () => {
    const check = async () => {
      v.expect(fileDirectories()).toEqual({
        documents: undefined,
        cache: undefined,
      });
      await v.expect(readFileText('x')).rejects.toMatchObject({
        name: 'CapabilityError',
        capability: 'fileSystem',
      });
      await v.expect(listFiles('/')).rejects.toThrowError(CapabilityError);
      await v.expect(fileExists('x')).rejects.toThrowError(CapabilityError);
    };
    // A page has no app-owned directories: no browser provider.
    v.expect(webServices.fileSystem).toBeUndefined();
    await check();
    await withoutServices(check);
  });

  v.it('uses the host file picker', async () => {
    provide({
      filePicker: {
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
      },
    });
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    v.expect(files[0]!.name).toBe('photo.png');
    v.expect(await files[0]!.text()).toBe('data');
    v.expect(Array.from(await files[0]!.bytes())).toEqual([1, 2, 3, 4]);
  });

  v.it(
    'the web picker is a hidden file input, removed after the choice',
    async () => {
      const click = v.vi
        .spyOn(HTMLInputElement.prototype, 'click')
        .mockImplementation(function (this: HTMLInputElement) {
          v.expect(this.isConnected).toBe(true);
          v.expect([this.type, this.accept, this.multiple]).toEqual([
            'file',
            '.txt',
            true,
          ]);
          Object.defineProperty(this, 'files', {
            value: [new File(['hello'], 'a.txt', { type: 'text/plain' })],
          });
          this.dispatchEvent(new Event('change'));
        });
      try {
        const picked = await pickFiles({ accept: '.txt', multiple: true });
        v.expect(
          picked.map((file) => [file.name, file.type, file.size]),
        ).toEqual([['a.txt', 'text/plain', 5]]);
        v.expect(document.querySelector('input[type="file"]')).toBeNull();

        click.mockImplementation(function (this: HTMLInputElement) {
          this.dispatchEvent(new Event('cancel'));
        });
        v.expect(await pickFiles()).toEqual([]);
        v.expect(document.querySelector('input[type="file"]')).toBeNull();
      } finally {
        click.mockRestore();
      }
    },
  );

  v.it('a host without a file picker adds nothing to the page', async () => {
    const create = v.vi.spyOn(document, 'createElement');
    try {
      await withoutServices(async () => {
        await v.expect(pickFiles()).rejects.toMatchObject({
          name: 'CapabilityError',
          capability: 'filePicker',
        });
      });
      v.expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  v.it('the web picker opens in the same turn as the call', async () => {
    const click = v.vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(function (this: HTMLInputElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('cancel')));
      });
    try {
      await expectSameTurn(click, () => pickFiles());
    } finally {
      click.mockRestore();
    }
  });

  v.it('the web file picker is installed without doing any work', () => {
    expectIdleWebProviders({ eager: ['filePicker'] });
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
  useWebServices();

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

  const combo = (init: KeyboardEventInit) =>
    new KeyboardEvent('keydown', { key: 'k', cancelable: true, ...init });

  v.it(
    'listens where the host delivers keys, and takes Mod from the host',
    () => {
      const keys = new EventTarget();
      const calls: string[] = [];
      let modifier: 'meta' | 'ctrl' = 'ctrl';
      provide({
        keyEvents: { target: () => keys, primaryModifier: () => modifier },
      });
      const layer = createShortcuts([
        { combo: 'Mod+K', handler: () => void calls.push('palette') },
      ]);
      keys.dispatchEvent(combo({ ctrlKey: true }));
      keys.dispatchEvent(combo({ metaKey: true }));
      v.expect(calls).toEqual(['palette']);
      // An Apple keyboard: Command is the shortcut key.
      modifier = 'meta';
      keys.dispatchEvent(combo({ ctrlKey: true }));
      keys.dispatchEvent(combo({ metaKey: true }));
      v.expect(calls).toEqual(['palette', 'palette']);
      v.expect(
        matchesCombo(combo({ metaKey: true }), parseCombo('Mod+K')),
      ).toBe(true);
      // The window is not this host's key target.
      window.dispatchEvent(combo({ metaKey: true }));
      v.expect(calls).toHaveLength(2);
      layer.dispose();
      keys.dispatchEvent(combo({ metaKey: true }));
      v.expect(calls).toHaveLength(2);
    },
  );

  v.it('the web provider listens on the window and reads the platform', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'platform');
    const calls: string[] = [];
    try {
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        value: 'MacIntel',
      });
      const layer = createShortcuts([
        { combo: 'Mod+K', handler: () => void calls.push('palette') },
      ]);
      window.dispatchEvent(combo({ ctrlKey: true }));
      window.dispatchEvent(combo({ metaKey: true }));
      v.expect(calls).toEqual(['palette']);
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        value: 'Linux x86_64',
      });
      window.dispatchEvent(combo({ ctrlKey: true }));
      v.expect(calls).toEqual(['palette', 'palette']);
      layer.dispose();
      window.dispatchEvent(combo({ ctrlKey: true }));
      v.expect(calls).toHaveLength(2);
    } finally {
      if (original) Object.defineProperty(navigator, 'platform', original);
      else delete (navigator as { platform?: unknown }).platform;
    }
  });

  v.it(
    'without a key events service: no listener, Mod is Control, and no browser API is read',
    async () => {
      const restore = forbid(navigator, 'platform');
      const listen = v.vi.spyOn(window, 'addEventListener');
      const calls: string[] = [];
      try {
        await withoutServices(() => {
          const layer = createShortcuts([
            { combo: 'Mod+K', handler: () => void calls.push('palette') },
          ]);
          window.dispatchEvent(combo({ ctrlKey: true }));
          v.expect(calls).toEqual([]);
          // Events the app feeds in itself still match.
          layer.handle(combo({ ctrlKey: true }));
          v.expect(calls).toEqual(['palette']);
          layer.handle(combo({ metaKey: true }));
          v.expect(calls).toEqual(['palette']);
          layer.dispose();
        });
        v.expect(listen).not.toHaveBeenCalled();
      } finally {
        listen.mockRestore();
        restore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['keyEvents'] });
    },
  );
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

  v.it('binds Escape and GoBack; Backspace only on a remote', () => {
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
    // On a keyboard host Backspace is a text-editing key, not Back.
    v.expect(backs).toBe(2);
    // On a remote it is the Back button.
    setCapabilities('roku');
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
    );
    v.expect(backs).toBe(3);
    dispose();
  });
});
