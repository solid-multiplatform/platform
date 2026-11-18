// The host package in a run without a window: the globals are there, the
// services that need no window work, the ones that need one are absent, and
// starting an app says why it cannot.
import { deviceInfo, deviceMemory } from '@solid-multiplatform/platform';
import {
  installServices,
  loadService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import { desktopHost } from '@solid-multiplatform/host-desktop';
import { desktopServices } from '../../src/services/manifest';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok)
    failures.push(detail === undefined ? name : `${name}: ${String(detail)}`);
};

async function run(): Promise<void> {
  for (const name of [
    'URL',
    'URLSearchParams',
    'TextEncoder',
    'TextDecoder',
    'AbortController',
    'Headers',
    'Request',
    'Response',
    'fetch',
    'structuredClone',
    'Event',
    'EventTarget',
    'Blob',
    'KeyboardEvent',
    'queueMicrotask',
    'setInterval',
  ]) {
    check(
      `${name} is a global`,
      typeof (globalThis as Record<string, unknown>)[name] === 'function',
    );
  }
  check(
    'no window, no document',
    typeof (globalThis as { window?: unknown }).window === 'undefined' &&
      typeof (globalThis as { document?: unknown }).document === 'undefined',
  );

  // Installing providers does nothing: no service is made, nothing is read.
  const before = __solid.stats().wakeups;
  const remove = installServices(
    desktopServices({ id: 'solid.test.headless', version: '9' }),
  );
  for (const name of [
    'settings',
    'fileSystem',
    'deviceInfo',
    'battery',
    'memory',
    'locale',
    'openExternal',
    'request',
  ] as const) {
    check(`${name} is available`, serviceAvailable(name) === 'available');
  }
  for (const name of [
    'clipboard',
    'keepAwake',
    'colorScheme',
    'lifecycle',
    'filePicker',
    'download',
    'keyEvents',
    'connectivity',
    'secureStorage',
    'notifications',
  ] as const) {
    check(
      `${name} is unavailable without a window`,
      serviceAvailable(name) === 'unavailable',
    );
  }
  // Started without arguments: the service is there and has no link.
  check('no arguments', __solid.args.length === 0, __solid.args);
  check('links', (await loadService('links')).initial() === null);
  check('deviceInfo', (await deviceInfo()).appVersion === '9');
  check('memory', (deviceMemory().deviceMemoryGb ?? 0) > 0);
  const settings = await loadService('settings');
  await settings.set('k', 'v');
  check('settings', (await settings.get('k')) === 'v');
  // A request with no window: the loop waits on its own condition variable.
  const setup = (await new Promise((resolve, reject) =>
    __solid.readText(`${__solid.appDir}/setup.json`, (error, text) =>
      error ? reject(error) : resolve(JSON.parse(text!)),
    ),
  )) as { server: string };
  const response = await fetch(`${setup.server}/json`);
  check(
    'fetch',
    response.status === 200 &&
      ((await response.json()) as { list: number[] }).list.length === 3,
  );
  remove();
  check('removed', serviceAvailable('settings') === 'unavailable');

  let message = '';
  try {
    desktopHost().launch(() => () => {});
  } catch (error) {
    message = (error as Error).message;
  }
  check(
    'an app cannot start without a window, and says so',
    /needs a window/.test(message),
    message,
  );

  // setInterval: fires until cleared, never in a burst.
  let ticks = 0;
  const interval = setInterval(() => {
    if (++ticks === 3) clearInterval(interval);
  }, 10);
  await new Promise((resolve) => setTimeout(resolve, 100));
  check('setInterval fires until cleared', ticks === 3, ticks);
  const idleBefore = __solid.stats().wakeups;
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(
    'nothing runs afterwards',
    __solid.stats().wakeups - idleBefore <= 1,
    __solid.stats().wakeups - idleBefore,
  );
  void before;

  if (failures.length > 0) console.error(failures.join('\n'));
  else console.log('host, headless: ok');
  __solid.exit(failures.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
