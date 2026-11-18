import * as v from 'vitest';
import {
  batteryState,
  deviceInfo,
  impact,
  keepAwake,
  lockOrientation,
  openExternal,
  readClipboard,
  resetDevicePorts,
  setAppVersion,
  setDevicePorts,
  share,
  vibrate,
  writeClipboard,
} from '../src/sdk/device.js';

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
  v.beforeEach(() => resetDevicePorts());

  v.it('uses host clipboard ports', async () => {
    const written: string[] = [];
    setDevicePorts({
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

  v.it('falls back to navigator.clipboard on the web', async () => {
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
    setDevicePorts({
      share: async (options) => {
        calls.push(options);
        return 'shared';
      },
    });
    v.expect(
      await share({ title: 'Read', url: 'https://example.test/a' }),
    ).toBe('shared');
    v.expect(calls).toEqual([{ title: 'Read', url: 'https://example.test/a' }]);
  });

  v.it('uses navigator.share and reports cancellation', async () => {
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
  });

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

  v.it('uses haptics ports and the Vibration API fallback', async () => {
    const impacts: string[] = [];
    setDevicePorts({
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

    resetDevicePorts();
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
    setDevicePorts({
      deviceInfo: async () => ({ platform: 'android', model: 'Pixel' }),
    });
    setAppVersion('1.2.3');
    v.expect(await deviceInfo()).toEqual({
      platform: 'android',
      model: 'Pixel',
      appVersion: '1.2.3',
    });
  });

  v.it('reads battery state from the host or the Battery API', async () => {
    setDevicePorts({
      battery: async () => ({ level: 0.4, charging: true }),
    });
    v.expect(await batteryState()).toEqual({ level: 0.4, charging: true });

    resetDevicePorts();
    define('getBattery', async () => ({ level: 0.8, charging: false }));
    v.expect(await batteryState()).toEqual({ level: 0.8, charging: false });
  });

  v.it('acquires and releases the wake lock', async () => {
    const actions: string[] = [];
    setDevicePorts({
      keepAwake: async (active) => {
        actions.push(active ? 'on' : 'off');
      },
    });
    await keepAwake(true);
    await keepAwake(false);
    v.expect(actions).toEqual(['on', 'off']);

    resetDevicePorts();
    define('wakeLock', {
      request: async () => ({
        release: async () => {
          actions.push('released');
        },
      }),
    });
    await keepAwake(true);
    await keepAwake(false);
    v.expect(actions).toEqual(['on', 'off', 'released']);
  });

  v.it(
    'locks orientation through a host port or Screen Orientation',
    async () => {
      const locks: string[] = [];
      setDevicePorts({
        lockOrientation: async (orientation) => {
          locks.push(orientation);
        },
      });
      await lockOrientation('landscape');
      v.expect(locks).toEqual(['landscape']);

      resetDevicePorts();
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
    },
  );

  v.it('opens external URLs through a host port', async () => {
    const opened: string[] = [];
    setDevicePorts({
      openExternal: async (url) => {
        opened.push(url);
      },
    });
    await openExternal('https://example.test/docs');
    v.expect(opened).toEqual(['https://example.test/docs']);
  });
});
