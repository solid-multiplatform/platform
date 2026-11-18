import * as v from 'vitest';
import {
  batteryState,
  deviceInfo,
  impact,
  keepAwake,
  lockOrientation,
  openExternal,
  readClipboard,
  setAppVersion,
  share,
  vibrate,
  writeClipboard,
} from '../src/sdk/device.js';
import { CapabilityError } from '../src/sdk/registry.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

const defineOn = (target: object, name: string, value: unknown) => {
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
  });
};

const define = (name: string, value: unknown) =>
  defineOn(navigator, name, value);

v.describe('device services', () => {
  useWebServices();
  v.afterEach(() => setAppVersion(undefined));

  v.it('uses host clipboard ports', async () => {
    const written: string[] = [];
    provide({
      clipboard: {
        readText: async () => 'from-host',
        writeText: async (text) => {
          written.push(text);
        },
      },
    });
    v.expect(await readClipboard()).toBe('from-host');
    await writeClipboard('to-host');
    v.expect(written).toEqual(['to-host']);
  });

  v.it('the web provider uses navigator.clipboard', async () => {
    const written: string[] = [];
    define('clipboard', {
      readText: async () => 'web',
      writeText: async (text: string) => {
        written.push(text);
      },
    });
    v.expect(await readClipboard()).toBe('web');
    await writeClipboard('copied');
    v.expect(written).toEqual(['copied']);
  });

  v.it('shares through the host port', async () => {
    const calls: unknown[] = [];
    provide({
      share: {
        share: async (options) => {
          calls.push(options);
          return 'shared';
        },
      },
    });
    v.expect(
      await share({ title: 'Read', url: 'https://example.test/a' }),
    ).toBe('shared');
    v.expect(calls).toEqual([{ title: 'Read', url: 'https://example.test/a' }]);
  });

  v.it(
    'the web provider uses navigator.share and reports cancellation',
    async () => {
      let calls = 0;
      define('share', async () => {
        calls++;
      });
      v.expect(await share({ text: 'hello' })).toBe('shared');
      v.expect(calls).toBe(1);

      define('share', async () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      });
      v.expect(await share({ text: 'hello' })).toBe('dismissed');
    },
  );

  v.it('copies to the clipboard when no share sheet exists', async () => {
    define('share', undefined);
    const written: string[] = [];
    define('clipboard', {
      readText: async () => '',
      writeText: async (text: string) => {
        written.push(text);
      },
    });
    v.expect(
      await share({ title: 'Solid', text: 'Look', url: 'https://x.test' }),
    ).toBe('copied');
    v.expect(written).toEqual(['Solid\nLook\nhttps://x.test']);
  });

  v.it(
    'copies to the clipboard when the host has no share service',
    async () => {
      const written: string[] = [];
      await withoutServices(async () => {
        provide({
          clipboard: {
            readText: async () => '',
            writeText: async (text) => {
              written.push(text);
            },
          },
        });
        const restore = forbid(navigator, 'share');
        try {
          v.expect(await share({ title: 'Solid', url: 'https://x.test' })).toBe(
            'copied',
          );
        } finally {
          restore();
        }
      });
      v.expect(written).toEqual(['Solid\nhttps://x.test']);
    },
  );

  v.it('uses haptics ports and the Vibration API on the web', async () => {
    const impacts: string[] = [];
    const remove = provide({
      haptics: {
        impact: async (style) => {
          impacts.push(style);
        },
        vibrate: async (ms) => {
          impacts.push(`vibrate:${ms}`);
        },
      },
    });
    await impact('heavy');
    await vibrate(15);
    v.expect(impacts).toEqual(['heavy', 'vibrate:15']);

    remove();
    const patterns: number[] = [];
    define('vibrate', (ms: number) => {
      patterns.push(ms);
      return true;
    });
    await impact('light');
    await vibrate(50);
    v.expect(patterns).toEqual([10, 50]);
  });

  v.it('reports host device info with the app version', async () => {
    provide({
      deviceInfo: {
        get: async () => ({ platform: 'android', model: 'Pixel' }),
      },
    });
    setAppVersion('1.2.3');
    v.expect(await deviceInfo()).toEqual({
      platform: 'android',
      model: 'Pixel',
      appVersion: '1.2.3',
    });
  });

  v.it('the web provider reports the browser as the device', async () => {
    v.expect(await deviceInfo()).toEqual({
      platform: 'web',
      model: navigator.userAgent,
      userAgent: navigator.userAgent,
    });
  });

  v.it('reads battery state from the host or the Battery API', async () => {
    const remove = provide({
      battery: { get: async () => ({ level: 0.4, charging: true }) },
    });
    v.expect(await batteryState()).toEqual({ level: 0.4, charging: true });

    remove();
    define('getBattery', undefined);
    v.expect(await batteryState()).toBeUndefined();
    define('getBattery', async () => ({ level: 0.8, charging: false }));
    v.expect(await batteryState()).toEqual({ level: 0.8, charging: false });
  });

  v.it('acquires and releases the wake lock', async () => {
    const actions: string[] = [];
    const remove = provide({
      keepAwake: {
        set: async (active) => {
          actions.push(active ? 'on' : 'off');
        },
      },
    });
    await keepAwake(true);
    await keepAwake(false);
    v.expect(actions).toEqual(['on', 'off']);

    remove();
    define('wakeLock', undefined);
    await v.expect(keepAwake(true)).rejects.toBeInstanceOf(CapabilityError);
    define('wakeLock', {
      request: async () => {
        actions.push('requested');
        return {
          release: async () => {
            actions.push('released');
          },
        };
      },
    });
    await keepAwake(true);
    await keepAwake(true);
    await keepAwake(false);
    await keepAwake(false);
    v.expect(actions).toEqual(['on', 'off', 'requested', 'released']);
  });

  v.it(
    'locks orientation through a host port or Screen Orientation',
    async () => {
      const locks: string[] = [];
      const remove = provide({
        orientation: {
          lock: async (orientation) => {
            locks.push(orientation);
          },
        },
      });
      await lockOrientation('landscape');
      v.expect(locks).toEqual(['landscape']);

      remove();
      defineOn(screen, 'orientation', {
        lock: async (value: string) => {
          locks.push(value);
        },
        unlock: () => {
          locks.push('unlock');
        },
      });
      await lockOrientation('portrait');
      await lockOrientation('any');
      v.expect(locks).toEqual(['landscape', 'portrait', 'unlock']);

      defineOn(screen, 'orientation', undefined);
      await lockOrientation('any');
      await v.expect(lockOrientation('portrait')).rejects.toMatchObject({
        name: 'CapabilityError',
        capability: 'orientation',
      });
    },
  );

  v.it('opens external URLs through a host port', async () => {
    const opened: string[] = [];
    provide({
      openExternal: {
        open: async (url) => {
          opened.push(url);
        },
      },
    });
    await openExternal('https://example.test/docs');
    v.expect(opened).toEqual(['https://example.test/docs']);
  });

  v.it('the web provider opens external URLs in a new tab', async () => {
    const opener = { opener: {} as unknown };
    const open = v.vi
      .spyOn(window, 'open')
      .mockReturnValue(opener as unknown as Window);
    try {
      await openExternal('https://example.test/docs');
      v.expect(open).toHaveBeenCalledWith(
        'https://example.test/docs',
        '_blank',
        'noopener,noreferrer',
      );
      v.expect(opener.opener).toBeNull();
      open.mockReturnValue(null);
      await v
        .expect(openExternal('https://example.test/blocked'))
        .rejects.toBeInstanceOf(CapabilityError);
    } finally {
      open.mockRestore();
    }
  });

  v.it(
    'a host with no device services reports them unavailable without touching the browser',
    async () => {
      const restores = [
        ...['clipboard', 'share', 'vibrate', 'userAgent', 'getBattery'].map(
          (name) => forbid(navigator, name),
        ),
        forbid(navigator, 'wakeLock'),
        forbid(screen, 'orientation'),
      ];
      const open = v.vi.spyOn(window, 'open');
      const create = v.vi.spyOn(document, 'createElement');
      try {
        await withoutServices(async () => {
          const unavailable = (capability: string) => ({
            name: 'CapabilityError',
            capability,
          });
          await v
            .expect(readClipboard())
            .rejects.toMatchObject(unavailable('clipboard'));
          await v
            .expect(writeClipboard('x'))
            .rejects.toMatchObject(unavailable('clipboard'));
          // No share service and no clipboard to copy to instead.
          await v
            .expect(share({ text: 'x' }))
            .rejects.toMatchObject(unavailable('clipboard'));
          // Documented as silent no-ops and soft results.
          await v.expect(impact('heavy')).resolves.toBeUndefined();
          await v.expect(vibrate(10)).resolves.toBeUndefined();
          await v.expect(batteryState()).resolves.toBeUndefined();
          await v.expect(lockOrientation('any')).resolves.toBeUndefined();
          await v
            .expect(deviceInfo())
            .rejects.toMatchObject(unavailable('deviceInfo'));
          await v
            .expect(keepAwake(true))
            .rejects.toMatchObject(unavailable('keepAwake'));
          await v
            .expect(lockOrientation('portrait'))
            .rejects.toMatchObject(unavailable('orientation'));
          await v
            .expect(openExternal('https://example.test'))
            .rejects.toMatchObject(unavailable('openExternal'));
        });
        v.expect(open).not.toHaveBeenCalled();
        v.expect(create).not.toHaveBeenCalled();
      } finally {
        open.mockRestore();
        create.mockRestore();
        for (const restore of restores) restore();
      }
    },
  );

  // Browsers allow these only while handling the user's gesture, so nothing
  // may come between the app's call and the browser's: no import, no tick.
  v.describe('reaches the browser in the same turn as the call', () => {
    const fake = <T extends object>(target: object, name: string, value: T) => {
      const original = Object.getOwnPropertyDescriptor(target, name);
      Object.defineProperty(target, name, { configurable: true, value });
      v.onTestFinished(() => {
        if (original) Object.defineProperty(target, name, original);
        else delete (target as Record<string, unknown>)[name];
      });
      return value;
    };

    v.it('clipboard: read and write', async () => {
      const api = fake(navigator, 'clipboard', {
        readText: v.vi.fn(async () => 'text'),
        writeText: v.vi.fn(async () => {}),
      });
      await expectSameTurn(api.readText, () => readClipboard());
      await expectSameTurn(api.writeText, () => writeClipboard('x'));
      v.expect(api.writeText).toHaveBeenCalledWith('x');
    });

    v.it(
      'clipboard: the copy command where there is no Clipboard API',
      async () => {
        fake(navigator, 'clipboard', undefined as unknown as object);
        const copy = fake(
          document,
          'execCommand',
          v.vi.fn(() => true),
        );
        await expectSameTurn(copy, () => writeClipboard('x'));
        v.expect(copy).toHaveBeenCalledWith('copy');
      },
    );

    v.it(
      'share: the share sheet, or the clipboard when there is none',
      async () => {
        const sheet = fake(
          navigator,
          'share',
          v.vi.fn(async () => {}),
        );
        await expectSameTurn(sheet, () => share({ text: 'hello' }));

        fake(navigator, 'share', undefined as unknown as object);
        const api = fake(navigator, 'clipboard', {
          readText: async () => '',
          writeText: v.vi.fn(async () => {}),
        });
        let result: unknown;
        await expectSameTurn(api.writeText, () =>
          share({ text: 'hello' }).then((value) => (result = value)),
        );
        v.expect(result).toBe('copied');
      },
    );

    v.it('openExternal: window.open', async () => {
      const open = v.vi
        .spyOn(window, 'open')
        .mockReturnValue({ opener: {} } as unknown as Window);
      v.onTestFinished(() => open.mockRestore());
      await expectSameTurn(open, () => openExternal('https://example.test'));
    });

    v.it('orientation: screen.orientation.lock and unlock', async () => {
      const api = fake(screen, 'orientation', {
        lock: v.vi.fn(async () => {}),
        unlock: v.vi.fn(),
      });
      await expectSameTurn(api.lock, () => lockOrientation('landscape'));
      await expectSameTurn(api.unlock, () => lockOrientation('any'));
    });

    v.it('keepAwake: navigator.wakeLock.request', async () => {
      const released = v.vi.fn(async () => {});
      const api = fake(navigator, 'wakeLock', {
        request: v.vi.fn(async () => ({ release: released })),
      });
      await expectSameTurn(api.request, () => keepAwake(true));
      await expectSameTurn(released, () => keepAwake(false));
    });
  });

  v.it('the web providers are installed without doing any work', () => {
    expectIdleWebProviders({
      lazy: ['haptics', 'deviceInfo', 'battery'],
      eager: [
        'clipboard',
        'share',
        'openExternal',
        'orientation',
        'keepAwake',
        'memory',
        'systemBars',
      ],
    });
  });
});
