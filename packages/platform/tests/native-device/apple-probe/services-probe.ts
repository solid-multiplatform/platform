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
import type {} from '@solid-multiplatform/platform/biometrics';
import type {} from '@solid-multiplatform/platform/device';
import type {} from '@solid-multiplatform/platform/files';
import type {} from '@solid-multiplatform/platform/geolocation';
import type {} from '@solid-multiplatform/platform/media';
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
    [
      'appReview',
      'battery',
      'biometrics',
      'clipboard',
      'geolocation',
      'haptics',
      'notifications',
      'orientation',
      'share',
    ] as const
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
    await check('biometrics', async () => {
      // A simulator has no enrolled face or finger: the refusal is the result.
      const result = await (
        await loadService('biometrics')
      ).authenticate({ reason: 'Services probe' });
      expect(result.success === false, 'authenticated without enrolment');
      expect(
        result.error === 'not-enrolled' || result.error === 'unavailable',
        String(result.error),
      );
      return String(result.error);
    });
    await check('notifications', async () => {
      // Asking would show the system prompt: only the current permission.
      const permission = await (
        await loadService('notifications')
      ).permission();
      expect(permission === 'prompt', permission);
      return permission;
    });
  }
  await check('fileSystem', async () => {
    const port = peekService('fileSystem');
    expect(port !== undefined, 'not synchronous');
    const files = port!;
    expect(!!files.cacheDirectory, 'cacheDirectory');
    expect(
      (files.documentDirectory !== undefined) === (form === 'phone'),
      'documentDirectory ' + files.documentDirectory,
    );
    await files.writeText('probe/a.txt', 'héllo');
    expect((await files.readText('probe/a.txt')) === 'héllo', 'text');
    const bytes = new Uint8Array([0, 1, 2, 250]);
    const cached = files.cacheDirectory + '/probe/b.bin';
    await files.writeBytes(cached, bytes);
    expect((await files.readBytes(cached)).join() === bytes.join(), 'bytes');
    const listed = await files.list('probe');
    expect(
      listed.some((entry) => entry.name === 'a.txt'),
      'list',
    );
    expect(listed.find((entry) => entry.name === 'a.txt')?.size === 6, 'size');
    await files.remove('probe/a.txt');
    await files.remove(cached);
    expect(!(await files.exists('probe/a.txt')), 'removed');
    let refused = false;
    await files.readText('../../etc/hosts').catch(() => (refused = true));
    expect(refused, 'read outside the app directories');
    refused = false;
    await files.exists('/etc/hosts').catch(() => (refused = true));
    expect(refused, 'absolute path outside the app directories');
  });
  await check('mediaSession', () => {
    const session = peekService('mediaSession');
    expect(session !== undefined, 'not synchronous');
    const center = MPNowPlayingInfoCenter.defaultCenter();
    session!.setMetadata({ title: 'Probe', artist: 'Solid' });
    session!.setPlaybackState('playing');
    session!.setPositionState?.({ duration: 60, position: 5 });
    const info = center.nowPlayingInfo;
    expect(info?.objectForKey(MPMediaItemPropertyTitle) === 'Probe', 'title');
    expect(
      info?.objectForKey(MPMediaItemPropertyPlaybackDuration) === 60,
      'duration',
    );
    const play = MPRemoteCommandCenter.sharedCommandCenter().playCommand;
    session!.setActionHandler('play', () => {});
    expect(play.enabled === true, 'play command not enabled');
    session!.setActionHandler('play', undefined);
    expect(play.enabled === false, 'play command left enabled');
    session!.setPlaybackState('none');
    expect(!center.nowPlayingInfo, 'now playing info left behind');
  });
  await check('secureStorage', async () => {
    const store = await loadService('secureStorage');
    await store.set('probe', 'secret');
    expect((await store.get('probe')) === 'secret', 'read after write');
    await store.remove('probe');
    expect((await store.get('probe')) === null, 'read after remove');
  });
  if (form === 'phone') {
    await check('geolocation', async () => {
      // The smoke script granted the permission and set the simulated place.
      const port = peekService('geolocation');
      expect(port !== undefined, 'not synchronous');
      const near = (value: number, wanted: number) =>
        Math.abs(value - wanted) < 0.01;
      const once = await port!.getCurrent({ timeout: 20000 });
      expect(near(once.latitude, 48.8584), 'latitude ' + once.latitude);
      expect(near(once.longitude, 2.2945), 'longitude ' + once.longitude);
      let watched: number | undefined;
      const stop = port!.watch({}, (position) => (watched = position.latitude));
      for (let n = 0; n < 50 && watched === undefined; n++) await wait(200);
      stop();
      expect(watched !== undefined, 'no watched position within 10 s');
      expect(near(watched!, 48.8584), 'watched latitude ' + watched);
      return once.latitude + ',' + once.longitude;
    });
    if (serviceAvailable('orientation') === 'available')
      await check('orientation', async () => {
        const port = await loadService('orientation');
        const application = UIApplication.sharedApplication;
        const window = application.keyWindow;
        const scene = window?.windowScene;
        expect(!!scene, 'no window scene');
        // What the delegate tells UIKit the window supports. UIApplication's
        // own method of that name only reads Info.plist.
        const allowed = () =>
          Number(
            application.delegate.applicationSupportedInterfaceOrientationsForWindow?.(
              application,
              window!,
            ),
          );
        const declared = allowed();
        // UIInterfaceOrientation: 1 portrait, 3 and 4 landscape.
        const turned = async (landscape: boolean) => {
          for (let n = 0; n < 40; n++) {
            if (Number(scene!.interfaceOrientation) >= 3 === landscape)
              return true;
            await wait(200);
          }
          return false;
        };
        await port.lock('landscape');
        expect(allowed() === 24, 'landscape lock allows ' + allowed());
        expect(await turned(true), 'did not turn to landscape');
        await port.lock('portrait');
        expect(allowed() === 2, 'portrait lock allows ' + allowed());
        expect(await turned(false), 'did not turn back to portrait');
        // The lock holds: UIKit refuses a rotation out of it.
        let refusal = '';
        scene!.requestGeometryUpdateWithPreferencesErrorHandler(
          UIWindowSceneGeometryPreferencesIOS.alloc().initWithInterfaceOrientations(
            24,
          ),
          (error) => (refusal = error.localizedDescription),
        );
        await wait(2500);
        expect(
          Number(scene!.interfaceOrientation) < 3,
          'turned to landscape while locked to portrait',
        );
        await port.lock('any');
        expect(allowed() === declared, 'unlocked allows ' + allowed());
        return 'Info.plist allows ' + declared + '; refused: ' + refusal;
      });
  }
  // The host installs `links` only when the delegate method it added is live.
  results.delegateOpensURLs =
    UIApplication.sharedApplication.delegate?.respondsToSelector(
      'application:openURL:options:',
    ) === true;
  const links = peekService('links');
  let opened: string | undefined;
  const stopLinks = links?.subscribe((link) => (opened = link));
  const arrives = async (link: string, seconds: number) => {
    for (let n = 0; n < seconds * 5 && opened !== link; n++) await wait(200);
    return opened === link;
  };
  await check('openExternal', async () => {
    // The app's own URL scheme: the system hands the URL straight back.
    const port = await loadService('openExternal');
    if (!links) return 'loaded only: nothing here receives the URL';
    await port.open('solidprobe://services/probe?from=app');
  });
  if (links) {
    await check('links', async () => {
      expect(
        await arrives('solidprobe://services/probe?from=app', 10),
        'the URL this app opened did not arrive: ' + opened,
      );
      return opened;
    });
    // Soft: the system may ask the user before it opens a URL for simctl.
    await check('linksFromSystem', async () => {
      const lifecycle = await loadService('lifecycle');
      const seen: boolean[] = [];
      const stop = lifecycle.subscribe((active) => seen.push(active));
      // The smoke script opens the URL with `simctl openurl` once it sees this.
      results.awaitingLink = true;
      write();
      const arrived = await arrives(
        'solidprobe://services/probe?from=simctl',
        15,
      );
      stop();
      expect(arrived, 'not delivered; lifecycle changes: ' + seen.join());
      return opened;
    });
  }
  stopLinks?.();
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
  await check('colorSchemeChange', async () => {
    const port = peekService('colorScheme');
    expect(port !== undefined, 'not synchronous');
    const before = port!.current();
    let changed: string | undefined;
    const stop = port!.subscribe((scheme) => (changed = scheme));
    // The smoke script flips the simulator's appearance once it sees this.
    results.awaitingAppearance = true;
    write();
    for (let n = 0; n < 75 && changed === undefined; n++) await wait(200);
    stop();
    expect(changed !== undefined, 'no change reported after ' + before);
    expect(changed !== before, 'reported ' + changed + ' again');
    expect(port!.current() === changed, 'current() disagrees');
    return before + ' -> ' + changed;
  });
  if (form === 'phone') {
    // Last: the system may put its review prompt over the app.
    await check('appReview', async () => {
      const requested = await (await loadService('appReview')).request();
      expect(requested === true, 'no scene to ask in');
      return 'requested';
    });
  }
  results.done = true;
  write();
}
