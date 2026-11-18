import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityError,
  installServices,
  loadService,
  peekService,
  serviceAvailable,
  useService,
} from '../src/sdk/services.js';
import { webAppServices } from '../src/hosts/web-services/index.js';
import { createNavigation } from '../src/sdk/navigation.js';
import { browserEditorHost } from '../src/sdk/editor.js';
import {
  expectIdleWebProviders,
  expectSameTurn,
  forbid,
  useWebServices,
  withoutServices,
} from './services-helpers.js';

useWebServices();

test('browser storage is namespaced and credentials never fall back to plain settings', async () => {
  const removeA = installServices(webAppServices('a'));
  const a = await loadService('settings');
  const removeB = installServices(webAppServices('b'));
  const b = await loadService('settings');
  try {
    await a.set('k', 'data');
    expect(await a.get('k')).toBe('data');
    expect(await b.get('k')).toBeNull();
    expect(serviceAvailable('secureStorage')).toBe('unavailable');
    expect(() => useService('secureStorage')).toThrow(CapabilityError);
    await expect(loadService('secureStorage')).rejects.toThrow(CapabilityError);
    await a.remove('k');
    expect(await a.get('k')).toBeNull();
  } finally {
    removeB();
    removeA();
  }
  expect(() => webAppServices('')).toThrow(/namespace/);
});
test('settings, push and background jobs need what only the app knows: its namespace and its service worker', () => {
  // `webServices` alone has none of them; the web host adds settings under
  // its `namespace` option (tests/host/start-app.test.tsx).

  for (const name of ['settings', 'push', 'jobs'] as const)
    expect(serviceAvailable(name)).toBe('unavailable');
  expect(Object.keys(webAppServices('a'))).toEqual(['settings']);
  const worker = {
    pushManager: {},
    sync: { register: async () => {} },
  } as unknown as ServiceWorkerRegistration;
  expect(Object.keys(webAppServices('a', worker))).toEqual([
    'settings',
    'notifications',
    'push',
    'jobs',
  ]);
  const plain = {} as unknown as ServiceWorkerRegistration;
  expect(Object.keys(webAppServices('a', plain))).toEqual([
    'settings',
    'notifications',
  ]);
});
test('asking for notification permission reaches the browser in the same turn, with or without a service worker', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
  const requestPermission = vi.fn(async () => 'granted');
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'default', requestPermission },
  });
  try {
    // Synchronously there: the prompt needs the user's gesture.
    const page = useService('notifications');
    await expectSameTurn(requestPermission, () => page.request());

    const shown = vi.fn(async () => {});
    const remove = installServices(
      webAppServices('a', {
        showNotification: shown,
      } as unknown as ServiceWorkerRegistration),
    );
    try {
      const viaWorker = useService('notifications');
      expect(viaWorker).not.toBe(page);
      await expectSameTurn(requestPermission, () => viaWorker.request());
      Object.defineProperty(globalThis, 'Notification', {
        configurable: true,
        value: { permission: 'granted', requestPermission },
      });
      await viaWorker.show({ title: 'Hi', body: 'There', id: 'n1' });
      expect(shown).toHaveBeenCalledWith('Hi', {
        body: 'There',
        tag: 'n1',
        data: undefined,
      });
    } finally {
      remove();
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'Notification', original);
    else delete (globalThis as { Notification?: unknown }).Notification;
  }
});
test('the browser lifecycle, connectivity and link services listen only while subscribed', async () => {
  const onWindow = vi.spyOn(window, 'addEventListener');
  const offWindow = vi.spyOn(window, 'removeEventListener');
  const onDocument = vi.spyOn(document, 'addEventListener');
  const offDocument = vi.spyOn(document, 'removeEventListener');
  try {
    const lifecycle = await loadService('lifecycle');
    const connectivity = await loadService('connectivity');
    const links = await loadService('links');
    expect(lifecycle.active()).toBe(!document.hidden);
    expect(connectivity.online()).toBe(navigator.onLine);
    expect(links.initial()).toBe(location.href);
    expect(onWindow).not.toHaveBeenCalled();
    expect(onDocument).not.toHaveBeenCalled();

    const seen: unknown[] = [];
    const stops = [
      lifecycle.subscribe((active) => seen.push(['active', active])),
      connectivity.subscribe((online) => seen.push(['online', online])),
      links.subscribe((link) => seen.push(['link', link])),
    ];
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual([
      ['active', !document.hidden],
      ['online', navigator.onLine],
      ['link', location.href],
    ]);
    for (const stop of stops) stop();
    expect(offDocument.mock.calls.map((call) => call[0])).toEqual([
      'visibilitychange',
    ]);
    expect(offWindow.mock.calls.map((call) => call[0]).sort()).toEqual(
      onWindow.mock.calls.map((call) => call[0]).sort(),
    );
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('popstate'));
    expect(seen).toHaveLength(3);
  } finally {
    for (const spy of [onWindow, offWindow, onDocument, offDocument])
      spy.mockRestore();
  }
});
test('browser notifications report the permission and refuse to show without it', async () => {
  const notifications = await loadService('notifications');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
  try {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: undefined,
    });
    expect(await notifications.permission()).toBe('unavailable');
    expect(await notifications.request()).toBe('unavailable');
    await expect(notifications.show({ title: 'Hi' })).rejects.toThrow(
      CapabilityError,
    );

    const shown: unknown[] = [];
    class FakeNotification {
      static permission = 'default';
      static requestPermission = async () =>
        (FakeNotification.permission = 'granted');
      constructor(title: string, options: unknown) {
        shown.push([title, options]);
      }
    }
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: FakeNotification,
    });
    expect(await notifications.permission()).toBe('prompt');
    await expect(notifications.show({ title: 'Hi' })).rejects.toThrow(
      /permission required/,
    );
    expect(await notifications.request()).toBe('granted');
    await notifications.show({ title: 'Hi', body: 'There', id: 'n1' });
    expect(shown).toEqual([
      ['Hi', { body: 'There', tag: 'n1', data: undefined }],
    ]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Notification', original);
    else delete (globalThis as { Notification?: unknown }).Notification;
  }
});
test('browser network requests go through fetch', async () => {
  const fetched = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('ok'));
  try {
    const { fetch: send } = await loadService('request');
    expect(
      await (await send('https://x.test/a', { method: 'POST' })).text(),
    ).toBe('ok');
    expect(fetched).toHaveBeenCalledWith('https://x.test/a', {
      method: 'POST',
    });
  } finally {
    fetched.mockRestore();
  }
});
test('a host with no app services reports them unavailable without touching the browser', async () => {
  const restores = [
    forbid(navigator, 'onLine'),
    forbid(document, 'hidden'),
    forbid(globalThis, 'localStorage'),
    forbid(globalThis, 'Notification'),
  ];
  const fetched = vi.spyOn(globalThis, 'fetch');
  try {
    await withoutServices(async () => {
      for (const name of [
        'settings',
        'secureStorage',
        'lifecycle',
        'connectivity',
        'links',
        'notifications',
        'push',
        'jobs',
        'request',
      ] as const) {
        expect(serviceAvailable(name), name).toBe('unavailable');
        expect(peekService(name), name).toBeUndefined();
        expect(() => useService(name), name).toThrow(CapabilityError);
        await expect(loadService(name), name).rejects.toMatchObject({
          name: 'CapabilityError',
          capability: name,
        });
      }
    });
    expect(fetched).not.toHaveBeenCalled();
  } finally {
    fetched.mockRestore();
    for (const restore of restores) restore();
  }
});
test('the web host reaches the lazily loaded implementations only through import()', () => {
  const dir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../src/hosts/web-services',
  );
  // Statically loaded with the web host: the manifests, and the plain objects
  // that synchronous SDK functions read or that need the user's gesture.
  for (const file of [
    'index.ts',
    'device.manifest.ts',
    'media.manifest.ts',
    'sensors.manifest.ts',
    'device.sync.ts',
    'media.sync.ts',
    'sensors.ts',
    '../web.ts',
  ]) {
    const source = readFileSync(resolve(dir, file), 'utf8');
    expect(source, file).not.toMatch(/from\s+['"]\.\/(?:device|media)\.js['"]/);
  }
  for (const group of ['device', 'media'])
    expect(
      readFileSync(resolve(dir, `${group}.manifest.ts`), 'utf8'),
    ).toContain(`import('./${group}.js')`);
});
test('the browser app services are installed without doing any work', () => {
  expectIdleWebProviders({
    lazy: ['lifecycle', 'connectivity', 'links', 'request'],
    eager: ['notifications'],
  });
});
test('editing preserves selection and composition, with an actual password-manager hint', () => {
  const input = browserEditorHost(document.body).createEditor({
    label: 'Password',
    purpose: 'current-password',
    onChange() {},
  });
  const el = document.querySelector('input')!;
  el.value = 'abc';
  el.setSelectionRange(1, 1);
  input.setValue('abc');
  expect(el.selectionStart).toBe(1);
  expect(el.type).toBe('password');
  expect(el.autocomplete).toBe('current-password');
  input.dispose();
  expect(el.value).toBe('');
});
test('new navigation after back replaces forward history', () => {
  const n = createNavigation({ path: '/' });
  n.push({ path: '/a' });
  n.push({ path: '/b' });
  n.back();
  n.replace({ path: '/c' });
  n.push({ path: '/d' });
  n.back();
  expect(n.route().path).toBe('/c');
  expect(n.back()).toBe(true);
  expect(n.back()).toBe(false);
});
