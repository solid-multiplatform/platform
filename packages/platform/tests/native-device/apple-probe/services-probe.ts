// Runs inside the generated app on a simulator (tests/cli/apple-smoke.sh):
// uses each service the Apple host installed through the registry and writes
// one result per service to Documents/services-probe.json. The file is
// rewritten after every service, so a crash still leaves the earlier results.
import {
  installedServices,
  loadService,
  peekService,
  serviceAvailable,
} from '@solid-multiplatform/platform/services';
import type {} from '@solid-multiplatform/platform/device';
import type {} from '@solid-multiplatform/platform/i18n';
import type {} from '@solid-multiplatform/platform/shortcuts';
import type {} from '@solid-multiplatform/platform/theme';

const NSDocumentDirectory = 9;
const NSUserDomainMask = 1;

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runServicesProbe(form: 'phone' | 'tv'): Promise<void> {
  const results: Record<string, unknown> = {};
  const file =
    NSSearchPathForDirectoriesInDomains(
      NSDocumentDirectory,
      NSUserDomainMask,
      true,
    ).firstObject + '/services-probe.json';
  const write = () =>
    NSString.stringWithString(
      JSON.stringify(results),
    ).writeToFileAtomicallyEncodingError(file, true, NSUTF8StringEncoding);
  const check = async (name: string, run: () => unknown) => {
    try {
      results[name] = (await run()) ?? 'ok';
    } catch (error) {
      results[name] = 'fail: ' + String(error);
    }
    write();
  };

  results.form = form;
  results.installed = installedServices();
  results.unavailable = (
    ['battery', 'clipboard', 'haptics', 'share'] as const
  ).filter((name) => serviceAvailable(name) === 'unavailable');
  write();

  await check('settings', async () => {
    const store = await loadService('settings');
    await store.set('probe', 'value');
    expect((await store.get('probe')) === 'value', 'read after write');
    expect(
      NSUserDefaults.standardUserDefaults.stringForKey('solid:probe') ===
        'value',
      'key is not namespaced',
    );
    await store.remove('probe');
    expect((await store.get('probe')) === null, 'read after remove');
  });
  await check('deviceInfo', async () => {
    const info = await (await loadService('deviceInfo')).get();
    expect(info.platform === (form === 'tv' ? 'tv' : 'ios'), info.platform);
    expect(!!info.model, 'model');
    expect(/^\d+(\.\d+)*$/.test(info.osVersion ?? ''), 'osVersion');
    return JSON.stringify(info);
  });
  await check('locale', () => {
    const tag = peekService('locale')?.current();
    expect(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(tag ?? ''), String(tag));
    return tag;
  });
  await check('colorScheme', () => {
    const port = peekService('colorScheme');
    expect(port !== undefined, 'not synchronous');
    const scheme = port!.current();
    expect(scheme === 'light' || scheme === 'dark', String(scheme));
    port!.subscribe(() => {})();
    return scheme;
  });
  await check('memory', () => {
    const info = peekService('memory')?.get();
    expect((info?.deviceMemoryGb ?? 0) > 0, 'deviceMemoryGb');
    return String(info?.deviceMemoryGb);
  });
  await check('keyEvents', () => {
    const port = peekService('keyEvents');
    expect(typeof port?.target().addEventListener === 'function', 'target');
    expect(port?.primaryModifier?.() === 'meta', 'primaryModifier');
  });
  await check('lifecycle', async () => {
    const port = await loadService('lifecycle');
    for (let n = 0; n < 50 && !port.active(); n++) await wait(200);
    expect(port.active(), 'not active');
    port.subscribe(() => {})();
  });
  await check('keepAwake', async () => {
    const port = await loadService('keepAwake');
    const application = UIApplication.sharedApplication;
    await port.set(true);
    expect(application.idleTimerDisabled === true, 'idle timer still on');
    await port.set(false);
    expect(application.idleTimerDisabled === false, 'idle timer still off');
  });
  await check('openExternal', async () => {
    // Opening a URL would leave the app: only that the port loads.
    const port = await loadService('openExternal');
    expect(typeof port.open === 'function', 'open');
    return 'loaded';
  });
  if (form === 'phone') {
    await check('clipboard', async () => {
      const port = await loadService('clipboard');
      await port.writeText('solid-probe');
      expect((await port.readText()) === 'solid-probe', 'round trip');
    });
    await check('battery', async () => {
      const state = await (await loadService('battery')).get();
      expect(
        UIDevice.currentDevice.batteryMonitoringEnabled === false,
        'monitoring left on',
      );
      return state === undefined
        ? 'no battery reported'
        : JSON.stringify(state);
    });
    await check('haptics', async () => {
      await (await loadService('haptics')).impact('light');
    });
  }
  await check('secureStorage', async () => {
    const store = await loadService('secureStorage');
    await store.set('probe', 'secret');
    expect((await store.get('probe')) === 'secret', 'read after write');
    await store.remove('probe');
    expect((await store.get('probe')) === null, 'read after remove');
  });
  // Last: C interop with Network.framework and SystemConfiguration.
  await check('connectivity', async () => {
    const port = await loadService('connectivity');
    const before = port.online();
    expect(typeof before === 'boolean', 'online()');
    let reported: boolean | undefined;
    const stop = port.subscribe((online) => (reported = online));
    for (let n = 0; n < 25 && reported === undefined; n++) await wait(200);
    stop();
    expect(reported !== undefined, 'no path update within 5 s');
    return 'online ' + before + ', monitor ' + reported;
  });
  results.done = true;
  write();
}
