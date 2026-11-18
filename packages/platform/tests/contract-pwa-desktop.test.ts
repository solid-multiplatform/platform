import * as v from 'vitest';
import {
  activateServiceWorkerUpdate,
  createInstallPrompt,
  isStandalone,
  registerServiceWorker,
  unregisterServiceWorkers,
} from '../src/sdk/pwa.js';
import {
  downloadBytes,
  downloadFile,
  downloadText,
  downloadUrl,
} from '../src/sdk/download.js';
import {
  findMenuItem,
  menusAvailable,
  runMenuItem,
  setApplicationMenu,
  setTray,
  type ApplicationMenu,
} from '../src/sdk/menus.js';
import {
  createWindowStateStore,
  normalizeWindowBounds,
} from '../src/sdk/window-state.js';
import type { Store } from '../src/sdk/services.js';
import { CapabilityError } from '../src/sdk/registry.js';
import { webServices } from '../src/hosts/web-services/index.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  provide,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

const memoryStore = (
  seed: Record<string, string> = {},
): Store & {
  map: Map<string, string>;
} => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
};

v.describe('PWA service worker', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  v.afterEach(() => {
    if (original) Object.defineProperty(navigator, 'serviceWorker', original);
    else
      Object.defineProperty(navigator, 'serviceWorker', {
        value: undefined,
        configurable: true,
      });
    v.vi.unstubAllGlobals();
  });

  const fakeServiceWorker = () => {
    const named = new Map<string, () => void>();
    let stateListener: (() => void) | undefined;
    const waiting = { postMessage: v.vi.fn() };
    const installing = {
      state: 'installing',
      addEventListener(type: string, listener: () => void) {
        if (type === 'statechange') stateListener = listener;
      },
    };
    const registration = {
      installing,
      waiting,
      addEventListener(type: string, listener: () => void) {
        named.set(type, listener);
      },
      unregister: async () => true,
    };
    const serviceWorker = {
      register: v.vi.fn(async () => registration),
      getRegistrations: v.vi.fn(async () => [registration]),
      controller: {},
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    return {
      registration,
      serviceWorker,
      waiting,
      fireUpdate() {
        named.get('updatefound')?.();
      },
      install() {
        installing.state = 'installed';
        stateListener?.();
      },
    };
  };

  v.it('registers a worker and surfaces updates', async () => {
    const fake = fakeServiceWorker();
    const ready: unknown[] = [];
    const updates: unknown[] = [];
    const registration = await registerServiceWorker({
      scope: './',
      onReady: (value) => ready.push(value),
      onUpdate: (value) => updates.push(value),
    });
    v.expect(registration).toBe(fake.registration);
    v.expect(fake.serviceWorker.register).toHaveBeenCalledWith('./sw.js', {
      scope: './',
    });
    v.expect(ready).toEqual([fake.registration]);

    fake.fireUpdate();
    fake.install();
    v.expect(updates).toEqual([fake.registration]);

    await activateServiceWorkerUpdate(fake.registration as never);
    v.expect(fake.waiting.postMessage).toHaveBeenCalledWith({
      type: 'SKIP_WAITING',
    });

    v.expect(await unregisterServiceWorkers()).toBe(true);
    v.expect(fake.serviceWorker.getRegistrations).toHaveBeenCalled();
  });

  v.it('returns undefined without service worker support', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });
    v.expect(await registerServiceWorker()).toBeUndefined();
    v.expect(await unregisterServiceWorkers()).toBe(false);
  });

  v.it('detects standalone mode and captures the install prompt', async () => {
    v.vi.stubGlobal('matchMedia', () => ({ matches: true }));
    v.expect(isStandalone()).toBe(true);

    const target = new EventTarget();
    const install = createInstallPrompt(target);
    v.expect(install.available()).toBe(false);
    const event = new Event('beforeinstallprompt', {
      cancelable: true,
    }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
      }>;
    };
    event.prompt = v.vi.fn(async () => {});
    event.userChoice = Promise.resolve({
      outcome: 'accepted' as const,
      platform: 'web',
    });
    target.dispatchEvent(event);
    v.expect(event.defaultPrevented).toBe(true);
    v.expect(install.available()).toBe(true);
    v.expect(await install.prompt()).toBe('accepted');
    v.expect(install.available()).toBe(false);
    v.expect(await install.prompt()).toBe('unavailable');
  });
});

v.describe('downloads', () => {
  useWebServices();
  v.afterEach(() => {
    v.vi.unstubAllGlobals();
    v.vi.useRealTimers();
  });

  v.it('uses a host download port', async () => {
    const saved: unknown[] = [];
    provide({
      download: {
        async save(data, options) {
          saved.push([data, options]);
        },
      },
    });
    await downloadFile('hello', { name: 'a.txt', mimeType: 'text/plain' });
    v.expect(saved).toEqual([
      ['hello', { name: 'a.txt', mimeType: 'text/plain' }],
    ]);
    // This host saves data but cannot fetch a URL itself.
    v.expect(() => downloadUrl('https://x.test/file.zip')).toThrowError(
      /download\.url/,
    );
    provide({
      download: {
        async save() {},
        saveUrl: (url, name) => saved.push([url, name]),
      },
    });
    downloadUrl('https://x.test/file.zip', 'file.zip');
    v.expect(saved.at(-1)).toEqual(['https://x.test/file.zip', 'file.zip']);
  });

  v.it(
    'the web provider downloads through an anchor and an object URL',
    async () => {
      const urls: string[] = [];
      v.vi.stubGlobal('URL', {
        createObjectURL: (value: unknown) => {
          urls.push(value instanceof Blob ? 'blob:blob' : String(value));
          return 'blob:test';
        },
        revokeObjectURL: v.vi.fn(),
      });
      let clicked: { href: string; download: string } | undefined;
      const click = v.vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          clicked = { href: this.href, download: this.download };
        });
      v.vi.useFakeTimers();
      await downloadText('hello', 'a.txt');
      v.expect(clicked).toEqual({ href: 'blob:test', download: 'a.txt' });
      v.expect(urls).toEqual(['blob:blob']);
      v.vi.advanceTimersByTime(1000);
      v.expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
      click.mockRestore();
    },
  );

  v.it('downloads bytes and existing URLs', async () => {
    v.vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:bytes',
      revokeObjectURL: v.vi.fn(),
    });
    const click = v.vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    v.vi.useFakeTimers();
    await downloadBytes(new Uint8Array([1, 2]), 'a.bin');
    downloadUrl('https://x.test/file.zip', 'file.zip');
    v.expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  v.it('the web download starts in the same turn as the call', async () => {
    v.vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:same-turn',
      revokeObjectURL: v.vi.fn(),
    });
    const click = v.vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    v.vi.useFakeTimers();
    try {
      await expectSameTurn(click, () => downloadText('hello', 'a.txt'));
      await expectSameTurn(click, () =>
        downloadFile(new Uint8Array([1]), { name: 'a.bin' }),
      );
      await expectSameTurn(click, () => downloadUrl('https://x.test/a.zip'));
    } finally {
      click.mockRestore();
    }
  });

  v.it(
    'a host without a download service saves nothing and adds nothing to the page',
    async () => {
      const create = v.vi.spyOn(document, 'createElement');
      const objectUrl = v.vi.spyOn(URL, 'createObjectURL');
      try {
        await withoutServices(async () => {
          await v.expect(downloadText('hello', 'a.txt')).rejects.toMatchObject({
            name: 'CapabilityError',
            capability: 'download',
          });
          await v
            .expect(downloadBytes(new Uint8Array([1]), 'a.bin'))
            .rejects.toThrowError(CapabilityError);
          v.expect(() => downloadUrl('https://x.test/file.zip')).toThrowError(
            CapabilityError,
          );
        });
        v.expect(create).not.toHaveBeenCalled();
        v.expect(objectUrl).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
        objectUrl.mockRestore();
      }
    },
  );

  v.it(
    'the web provider is a plain object the registry reads synchronously',
    () => {
      expectIdleWebProviders({ eager: ['download'] });
    },
  );
});

v.describe('desktop menus', () => {
  useWebServices();

  v.it('installs menus/tray and runs/toggles items', () => {
    const menus: unknown[] = [];
    const trays: unknown[] = [];
    provide({
      menus: {
        setApplicationMenu(menu) {
          menus.push(menu);
        },
        setTray(tray) {
          trays.push(tray);
        },
      },
    });
    v.expect(menusAvailable()).toBe(true);
    let selected = 0;
    const menu: ApplicationMenu = {
      items: [
        { id: 'file', label: 'File', submenu: [{ id: 'quit', label: 'Quit' }] },
        {
          id: 'wrap',
          label: 'Wrap',
          type: 'checkbox',
          checked: false,
          onSelect: () => selected++,
        },
        { id: 'off', label: 'Off', disabled: true },
        { id: 'sep', type: 'separator' },
      ],
    };
    v.expect(setApplicationMenu(menu)).toBe(true);
    v.expect(
      setTray({ icon: 'icon.png', tooltip: 'App', menu: menu.items }),
    ).toBe(true);
    v.expect(menus).toEqual([menu]);
    v.expect(trays).toHaveLength(1);
    v.expect(findMenuItem(menu, 'quit')?.label).toBe('Quit');
    v.expect(runMenuItem(menu, 'wrap')).toBe(true);
    v.expect(selected).toBe(1);
    v.expect(menu.items.find((item) => item.id === 'wrap')?.checked).toBe(true);
    v.expect(runMenuItem(menu, 'off')).toBe(false);
    v.expect(runMenuItem(menu, 'sep')).toBe(false);
    v.expect(runMenuItem(menu, 'missing')).toBe(false);
  });

  v.it('returns false when no host menu provider exists', async () => {
    const check = () => {
      v.expect(menusAvailable()).toBe(false);
      v.expect(setApplicationMenu({ items: [] })).toBe(false);
      v.expect(setTray(null)).toBe(false);
    };
    // A page has no application menu or tray: no browser provider.
    v.expect(webServices.menus).toBeUndefined();
    check();
    await withoutServices(check);
  });
});

v.describe('window state', () => {
  v.it('normalizes corrupt bounds against defaults and minimums', () => {
    v.expect(
      normalizeWindowBounds(
        { x: 10, y: -5, width: 0, height: Number.NaN },
        { width: 960, height: 600, minWidth: 400, minHeight: 300 },
      ),
    ).toEqual({ x: 10, y: -5, width: 400, height: 600 });
    v.expect(
      normalizeWindowBounds(undefined, { width: 800, height: 500 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 500 });
  });

  v.it('persists, restores and resets window bounds', async () => {
    const storage = memoryStore();
    const store = createWindowStateStore({
      storage,
      key: 'win',
      defaults: { width: 960, height: 600 },
    });
    v.expect(await store.load()).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 600,
    });
    v.expect(
      await store.save({ x: 20, y: 30, width: 1200, height: 800 }),
    ).toEqual({ x: 20, y: 30, width: 1200, height: 800 });
    v.expect(JSON.parse(storage.map.get('win')!)).toMatchObject({
      x: 20,
      width: 1200,
    });
    v.expect(await store.load()).toEqual({
      x: 20,
      y: 30,
      width: 1200,
      height: 800,
    });
    v.expect(await store.reset()).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 600,
    });
    v.expect(storage.map.has('win')).toBe(false);
  });

  v.it('falls back to defaults for malformed JSON', async () => {
    const store = createWindowStateStore({
      storage: memoryStore({ win: '{not json' }),
      key: 'win',
      defaults: { width: 800, height: 500 },
    });
    v.expect(await store.load()).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 500,
    });
  });
});
