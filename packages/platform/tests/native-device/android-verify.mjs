// The device checks behind `android-probe.mjs verify`: every service the
// Android providers offer is driven through the probe app and then checked
// from outside it with adb. Each check waits on a condition with a bound, no
// fixed sleeps, and every device setting a check changes is put back, also
// when the check fails.
//
// `shared` is for an emulator someone else is using: the checks that would
// change a device-wide setting (battery override, wifi and data, night mode,
// the virtual sensors) only read, and say so in their row.
import { createServer } from 'node:http';
import {
  ANDROID_SERVICES,
  androidServiceSupported,
} from '../../hosts/nativescript/providers/android/requirements.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `read` until it returns something truthy; throws `what` at the bound. */
async function until(what, read, timeout = 15000, interval = 250) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await read();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    if (Date.now() > end)
      throw new Error(
        `${what} (waited ${timeout} ms; last: ${String(last).slice(0, 160)})`,
      );
    await sleep(interval);
  }
}

/** Thrown by a check that cannot run on this device as it is being used. */
class Skipped extends Error {}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const near = (a, b, tolerance) =>
  typeof a === 'number' && Math.abs(a - b) <= tolerance;

/**
 * Runs the checks for one form on one emulator. Returns the result object
 * that `verify` prints and writes; `failed` counts the failing rows.
 */
export async function runChecks({ emulator, probe: app, form, shared }) {
  const { adb, shell, tryShell } = emulator;
  const id = app.id;
  const rows = [];
  const restored = [];
  let restores = [];
  /** Registers how to put back what the running check changes. */
  const restoring = (name, undo) => restores.push({ name, undo });
  /** Puts back what a check changed, whether it passed or not. */
  const restore = async () => {
    const pending = restores.reverse();
    restores = [];
    for (const { name, undo } of pending) {
      try {
        await undo();
        restored.push(name);
      } catch (error) {
        rows.push({
          service: 'restore ' + name,
          gate: '',
          status: 'fail',
          detail: error.message.split('\n')[0],
          ms: 0,
        });
      }
    }
  };

  const topActivity = () =>
    /(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ ([^\s/}]+)\/([^\s}]+)/.exec(
      tryShell('dumpsys activity activities'),
    ) ?? [];
  const onTop = () => topActivity()[1] === id;
  /** Brings the probe back to the front through its own link channel. */
  const front = () =>
    // Asked again while another app's activity is still arriving on top.
    until(
      'probe activity on top',
      async () => {
        if (onTop()) return true;
        await app.step('available', { names: 'links' });
        return onTop();
      },
      20000,
      500,
    );
  let uid;
  const ownUid = () =>
    (uid ??= /uid:(\d+)/.exec(
      shell(`cmd package list packages -U ${id}`),
    )?.[1]);
  /** The dump of the probe's own window. */
  const ownWindow = () =>
    tryShell('dumpsys window windows')
      .split(/\n(?=\s*Window #\d+)/)
      .filter(
        (block) => /^\s*Window #\d+/.test(block) && block.includes(id + '/'),
      )
      .join('\n');
  const section = (text, from, to) => {
    const start = text.search(from);
    if (start < 0) return '';
    const rest = text.slice(start);
    const end = rest.slice(1).search(to);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };
  /** Runs a recording step and returns the name of its result file. */
  const record = async (step, args) => {
    const name = app.send(step, args);
    await app.wait(name);
    return name;
  };
  const events = (name) => app.read(name)?.value?.events ?? [];
  /** A later step's answer proves the app handled everything sent before. */
  const settled = () => app.step('available', { names: 'links' });

  const boot = await app.restart();
  const installed = new Set(boot.services);
  const preview = new Set(boot.preview);
  const has = boot.features;

  const checks = {
    async clipboard() {
      const text = 'probe clip ' + Date.now();
      expect(
        (await app.step('clipboard', { text })) === text,
        'write then read differs',
      );
      expect(
        (await app.step('clipboard-read')) === text,
        'second read differs',
      );
      return 'round trip';
    },
    async share() {
      const name = app.send('share', { text: 'shared by verify' });
      // With several targets the chooser stays until it is answered; with
      // one, it starts that target and closes by itself (the TV emulator).
      let seen = 0;
      const chooser = await until('share chooser on top, or an answer', () => {
        const [, pkg, activity] = topActivity();
        seen = pkg && pkg !== id ? seen + 1 : 0;
        return seen >= 3
          ? `${pkg}/${activity}`
          : app.read(name)
            ? 'answered'
            : null;
      });
      if (chooser === 'answered') {
        const answer = app.read(name);
        expect(
          answer.ok && answer.value === 'shared',
          'answered ' + JSON.stringify(answer),
        );
        await front();
        return 'the chooser started its only target: shared';
      }
      shell('input keyevent KEYCODE_BACK');
      await until('chooser dismissed', onTop);
      const answer = await app.wait(name);
      expect(
        answer.ok && answer.value === 'dismissed',
        'answered ' + JSON.stringify(answer),
      );
      return `chooser ${chooser.split('.').pop()} shown, BACK dismissed`;
    },
    async haptics() {
      await app.step('haptics', { ms: '120' });
      await until('vibration in dumpsys vibrator_manager', () =>
        tryShell('dumpsys vibrator_manager').includes(id),
      );
      return 'vibrator_manager entry';
    },
    async deviceInfo() {
      const info = await app.step('deviceInfo');
      expect(
        typeof info.platform === 'string' &&
          typeof info.model === 'string' &&
          info.model.length > 0 &&
          typeof info.osVersion === 'string',
        'unexpected shape: ' + Object.keys(info),
      );
      return `platform ${info.platform}; ${Object.keys(info).sort().join(', ')}`;
    },
    async battery() {
      const shape = (state) =>
        state &&
        state.level >= 0 &&
        state.level <= 1 &&
        typeof state.charging === 'boolean';
      if (shared) {
        expect(shape(await app.step('battery')), 'unexpected shape');
        return 'shape only (shared device: no battery override)';
      }
      restoring('battery', () => shell('dumpsys battery reset'));
      shell('dumpsys battery set level 37');
      shell('dumpsys battery unplug');
      const state = await until('level 0.37, not charging', async () => {
        const value = await app.step('battery');
        return near(value.level, 0.37, 0.001) && value.charging === false
          ? value
          : null;
      });
      shell('dumpsys battery reset');
      return `level ${state.level}, charging ${state.charging}; reset`;
    },
    async memory() {
      const info = await app.step('memory');
      const total =
        Number(/MemTotal:\s+(\d+)/.exec(shell('cat /proc/meminfo'))?.[1]) /
        2 ** 20;
      expect(
        info.deviceMemoryGb > total * 0.7 && info.deviceMemoryGb < total * 1.5,
        `${info.deviceMemoryGb} GiB against MemTotal ${total.toFixed(2)} GiB`,
      );
      expect(typeof info.lowMemory === 'boolean', 'lowMemory is not a boolean');
      return `${info.deviceMemoryGb} GiB, MemTotal ${total.toFixed(2)} GiB`;
    },
    async keepAwake() {
      await app.step('keepAwake', { on: '1' });
      await until('KEEP_SCREEN_ON set', () =>
        ownWindow().includes('KEEP_SCREEN_ON'),
      );
      await app.step('keepAwake', { on: '0' });
      await until('KEEP_SCREEN_ON cleared', () => {
        const dump = ownWindow();
        return dump && !dump.includes('KEEP_SCREEN_ON');
      });
      return 'window flag on, then off';
    },
    async orientation() {
      const size = () => {
        const match = /cur=(\d+)x(\d+)/.exec(
          tryShell('dumpsys window displays'),
        );
        return match ? Number(match[1]) - Number(match[2]) : 0;
      };
      const before = Math.sign(size());
      restoring('rotation', async () => {
        await app.attempt('orientation', { lock: 'any' });
        await until(
          'rotation restored',
          () => Math.sign(size()) === before,
          10000,
        );
      });
      await app.step('orientation', { lock: 'landscape' });
      await until('display landscape', () => size() > 0);
      await app.step('orientation', { lock: 'portrait' });
      await until('display portrait', () => size() < 0);
      await app.step('orientation', { lock: 'any' });
      await until('rotation restored', () => Math.sign(size()) === before);
      return 'landscape, portrait, released';
    },
    async systemBars() {
      await app.step('systemBars', { light: '1' });
      await until('LIGHT_STATUS_BARS set', () =>
        /LIGHT_STATUS_BARS/.test(ownWindow()),
      );
      expect(
        /LIGHT_NAVIGATION_BARS/.test(ownWindow()),
        'no LIGHT_NAVIGATION_BARS',
      );
      await app.step('systemBars', { light: '0' });
      await until('LIGHT_STATUS_BARS cleared', () => {
        const dump = ownWindow();
        return dump && !/LIGHT_STATUS_BARS/.test(dump);
      });
      await app.step('systemBars', { restore: '1' });
      return 'appearance flags set, cleared, restored';
    },
    async openExternal() {
      const since = shell("date +'%m-%d %H:%M:%S.000'").trim();
      await app.step('openExternal', { url: 'https://example.com/' });
      // Another app's activity on top, or, where it closes at once, the
      // system's record of having started it for this link.
      const started = new RegExp(
        `START u0 \\{act=android\\.intent\\.action\\.VIEW dat=https://example\\.com[^}]*cmp=(?!${id.replaceAll('.', '\\.')}/)`,
      );
      const how = await until('the link opened in another app', () => {
        const pkg = topActivity()[1];
        if (pkg && pkg !== id) return 'on top';
        return started.test(
          tryShell(`logcat -d -T '${since}' -s ActivityTaskManager:I`),
        )
          ? 'started'
          : null;
      });
      await front();
      return `browser activity ${how}, probe brought back`;
    },
    async links() {
      // Cold: `restart` force-stops the app and starts it with a VIEW intent,
      // which the app reads as its initial link. Warm: a link to the running
      // app, delivered to the subscription.
      const cold = await app.restart();
      expect(cold.form === form, 'cold link did not run the boot step');
      const before = shell(`pidof ${id}`).trim();
      await app.step('available', { names: 'links' });
      expect(
        shell(`pidof ${id}`).trim() === before,
        'warm link restarted the app',
      );
      return 'cold (initial) and warm (subscription) VIEW intents';
    },
    async connectivity() {
      // Live requests are listed one per line; the log of past ones, which
      // starts each line with a time, is not counted.
      const callbacks = () =>
        (
          tryShell('dumpsys connectivity').match(
            new RegExp(
              `^\\s+NetworkRequest \\[.*RequestorPkg: ${id.replaceAll('.', '\\.')}\\b`,
              'gm',
            ),
          ) ?? []
        ).length;
      const base = callbacks();
      const name = await record('connectivity-subscribe');
      await until('callback registered', () => callbacks() > base);
      let detail = 'shared device: wifi and data left alone';
      if (!shared) {
        const online = () => {
          shell('svc wifi enable');
          shell('svc data enable');
        };
        restoring('wifi and data', online);
        shell('svc wifi disable');
        shell('svc data disable');
        await until('offline event', () => events(name).includes(false), 30000);
        online();
        await until(
          'online event after offline',
          () => events(name).lastIndexOf(true) > events(name).indexOf(false),
          45000,
        );
        expect(
          (await app.step('connectivity')) === true,
          'online() is not true',
        );
        detail = `events ${JSON.stringify(events(name))}`;
      } else
        expect(
          (await app.step('connectivity')) === true,
          'online() is not true',
        );
      await app.step('unsubscribe', { name: 'connectivity' });
      await until('callback unregistered', () => callbacks() <= base);
      return `${detail}; callback registered while subscribed, none after dispose`;
    },
    async lifecycle() {
      const name = await record('lifecycle-subscribe');
      shell('input keyevent KEYCODE_HOME');
      await until('inactive after HOME', () => events(name).includes(false));
      await front();
      await until(
        'active after relaunch',
        () => events(name).lastIndexOf(true) > events(name).indexOf(false),
      );
      await app.step('unsubscribe', { name: 'lifecycle' });
      return `events ${JSON.stringify(events(name))}`;
    },
    async settings() {
      const value = 'kept-' + Date.now();
      await app.step('settings', { key: 'verify', set: value });
      await until('value in the settings XML', () =>
        tryShell(
          `run-as ${id} cat shared_prefs/solid.settings.probe.xml`,
        ).includes(value),
      );
      await app.restart();
      expect(
        (await app.step('settings', { key: 'verify' })) === value,
        'lost after force-stop',
      );
      return 'XML holds the value; read back after force-stop';
    },
    async secureStorage() {
      const secret = 'plain-' + Date.now();
      const prefs = () =>
        tryShell(
          `run-as ${id} cat shared_prefs/solid.secure.probe.xml 2>/dev/null`,
        );
      // `set` resolves before the file is written: wait for this write, not
      // for an entry an earlier run may have left.
      const before = prefs();
      await app.step('secure', { key: 'verify', set: secret });
      const xml = await until('a new entry in the secure prefs', () => {
        const text = prefs();
        return text.includes('name="verify"') && text !== before ? text : null;
      });
      expect(!xml.includes(secret), 'plaintext found in the prefs file');
      // Everything the app stores, except the probe's own step results.
      const grep = tryShell(
        `run-as ${id} sh -c 'grep -rc ${secret} shared_prefs databases no_backup cache 2>/dev/null'`,
      )
        .split('\n')
        .filter((line) => /:[1-9]\d*$/.test(line.trim()));
      expect(grep.length === 0, 'plaintext found in app data');
      await app.restart();
      expect(
        (await app.step('secure', { key: 'verify' })) === secret,
        'did not decrypt after restart',
      );
      return 'ciphertext in prefs, plaintext grep 0, decrypts after restart';
    },
    async notifications() {
      const permission = 'android.permission.POST_NOTIFICATIONS';
      tryShell(`pm revoke ${id} ${permission}`); // kills the app
      await app.restart();
      const revoked = await app.step('notification-permission');
      expect(revoked !== 'granted', 'granted while revoked');
      shell(`pm grant ${id} ${permission}`);
      await until(
        'permission granted',
        async () => (await app.step('notification-permission')) === 'granted',
      );
      const title = 'Verify ' + Date.now();
      await app.step('notify', { tag: 'verify', title });
      await until('notification posted', () =>
        tryShell('dumpsys notification --noredact').includes(title),
      );
      return `revoked: ${revoked}; granted: posted, in dumpsys notification`;
    },
    async jobs() {
      tryShell(`run-as ${id} rm -f files/probe/job-ran.json`);
      await app.step('job');
      await until(
        'job 7001 ran',
        () => {
          tryShell(`cmd jobscheduler run -f ${id} 7001`);
          return app.read('job-ran')?.value?.jobId === 7001;
        },
        20000,
        1000,
      );
      return 'scheduled an hour out; ran when forced';
    },
    async fileSystem() {
      const result = await app.step('fs');
      expect(result.bytesMatch, 'bytes differ');
      expect(
        JSON.stringify(result.listed).includes('a.txt'),
        'listing lacks a.txt',
      );
      expect(result.existsAfterRemove === false, 'file exists after remove');
      const read = Object.entries(result.refused).filter(
        ([, why]) => why === 'READ',
      );
      expect(
        read.length === 0,
        'read outside the roots: ' + read.map(([path]) => path),
      );
      // A link inside a root that points out of every root.
      const documents = result.directories.documents;
      shell(
        `run-as ${id} sh -c 'echo outside > shared_prefs/verify-outside.txt'`,
      );
      shell(
        `run-as ${id} ln -sfn ../../shared_prefs ${documents}/probe-fs/escape`,
      );
      const escaped = await app.attempt('fs-read', {
        path: 'probe-fs/escape/verify-outside.txt',
      });
      tryShell(
        `run-as ${id} rm -f ${documents}/probe-fs/escape shared_prefs/verify-outside.txt`,
      );
      expect(!escaped.ok, 'read through a symlink that leaves the roots');
      return `round trip; ${Object.keys(result.refused).length} traversals and a symlink escape refused`;
    },
    async locale() {
      const tag = await app.step('locale');
      expect(
        /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(tag),
        'not a language tag: ' + tag,
      );
      const device =
        tryShell('getprop persist.sys.locale').trim() ||
        tryShell('getprop ro.product.locale').trim();
      if (device)
        expect(
          tag.split('-')[0] === device.split('-')[0],
          `${tag} against ${device}`,
        );
      return `language tag ${tag}`;
    },
    async colorScheme() {
      const night = () =>
        /Night mode: (\w+)/.exec(tryShell('cmd uimode night'))?.[1] ?? 'no';
      const original = night();
      const scheme = { yes: 'dark', no: 'light' };
      if (shared) {
        const current = await app.step('colorScheme');
        expect(
          current === 'dark' || current === 'light',
          'unexpected value ' + current,
        );
        if (scheme[original])
          expect(
            current === scheme[original],
            `${current} with night ${original}`,
          );
        return `${current} (shared device: night mode left alone)`;
      }
      restoring('night mode', () => shell(`cmd uimode night ${original}`));
      const first = original === 'yes' ? 'no' : 'yes';
      const second = first === 'yes' ? 'no' : 'yes';
      const name = await record('colorScheme-subscribe');
      const seen = (value) =>
        events(name).some(
          (event) => event.scheme === value && event.signal === value,
        );
      shell(`cmd uimode night ${first}`);
      await until(scheme[first] + ' event', () => seen(scheme[first]));
      shell(`cmd uimode night ${second}`);
      await until(scheme[second] + ' event', () => seen(scheme[second]));
      await app.step('unsubscribe', { name: 'colorScheme' });
      const count = events(name).length;
      shell(`cmd uimode night ${first}`);
      await until(
        'app saw the change',
        async () => (await app.step('colorScheme')) === scheme[first],
      );
      expect(events(name).length === count, 'an event arrived after dispose');
      shell(`cmd uimode night ${original}`);
      return `events ${events(name)
        .map((event) => event.scheme)
        .join(', ')}; none after dispose`;
    },
    async audio() {
      // A focus stack entry names its owner as `-- pack: <package>`.
      const held = () => tryShell('dumpsys audio').includes(`pack: ${id}`);
      const played = await app.step('audio-play', {}, 30000);
      expect(played.playing === true, 'not playing');
      await until('audio focus held', held);
      await app.step('audio-stop');
      await until('audio focus released', () => !held());
      return 'focus held while playing, released on stop';
    },
    async mediaSession() {
      const sessions = () => tryShell('dumpsys media_session');
      const own = () =>
        sessions()
          .split(/\n(?=\s{2,6}\S.* \S+\/\S+ \(userId=\d+\))/)
          .filter((block) => block.includes(id))
          .join('\n');
      const name = await record('media-session');
      await until('active session with metadata', () => {
        const dump = own();
        return /active=true/.test(dump) && dump.includes('Probe Track');
      });
      // The pause key goes to the media button session: only send it when
      // that is the probe's.
      await until('probe holds the media button session', () =>
        new RegExp(`Media button session is ${id.replaceAll('.', '\\.')}`).test(
          sessions(),
        ),
      );
      shell('cmd media_session dispatch pause');
      await until('pause action delivered', () =>
        events(name).includes('pause'),
      );
      await app.step('media-session-clear');
      await until('session released', () => !/active=true/.test(own()));
      return 'active with metadata; dispatched pause delivered; released';
    },

    async keyEvents() {
      const name = await record('keys');
      shell('input keyevent KEYCODE_DPAD_DOWN');
      await until('keydown ArrowDown on the key target', () =>
        events(name).some(
          (event) => event.type === 'keydown' && event.key === 'ArrowDown',
        ),
      );
      await until(
        'the ArrowDown shortcut to fire (the keydown arrived)',
        () => events(name).some((event) => event.shortcut === 'ArrowDown'),
        5000,
      );
      await app.step('unsubscribe', { name: 'keys' });
      const count = events(name).length;
      shell('input keyevent KEYCODE_DPAD_DOWN');
      await settled();
      expect(events(name).length === count, 'an event arrived after dispose');
      return 'DPAD_DOWN: keydown ArrowDown and the shortcut; none after dispose';
    },
    async download() {
      const stamp = Date.now();
      const text = 'probe download ' + stamp;
      const saved = `verify-${stamp}.txt`;
      const fetched = `verify-url-${stamp}.txt`;
      const body = 'served to DownloadManager ' + stamp;
      let requests = 0;
      const server = createServer((request, response) => {
        requests++;
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': Buffer.byteLength(body),
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const cat = (name) =>
        tryShell(`cat /sdcard/Download/${name} 2>/dev/null`);
      try {
        adb('reverse', `tcp:${port}`, `tcp:${port}`);
        await app.step('download', { name: saved, text });
        await until('saved file in Downloads', () => cat(saved) === text);
        await app.step('download-url', {
          url: `http://127.0.0.1:${port}/${fetched}`,
          name: fetched,
        });
        await until(
          'fetched file in Downloads',
          () => cat(fetched) === body,
          30000,
        );
        expect(requests > 0, 'the test server saw no request');
      } finally {
        try {
          adb('reverse', '--remove', `tcp:${port}`);
        } catch {
          // already gone
        }
        await new Promise((resolve) => server.close(resolve));
        for (const name of [saved, fetched]) {
          tryShell(`rm -f /sdcard/Download/${name}`);
          tryShell(
            `content delete --uri content://media/external/downloads --where "_display_name='${name}'"`,
          );
        }
      }
      return 'save() to Downloads; saveUrl() fetched from a host server over adb reverse';
    },
    async geolocation() {
      if (shared)
        throw new Skipped(
          'needs `adb emu geo fix`, not sent to a shared device',
        );
      for (const name of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'])
        shell(`pm grant ${id} android.permission.${name}`);
      // A provider's live listeners are `<uid>/<package>/<key> Request[...]`;
      // the event log's lines start with a time.
      const listener = new RegExp(
        `^\\s+\\d+/${id.replaceAll('.', '\\.')}/\\S+ Request\\[`,
        'm',
      );
      const registered = () => listener.test(tryShell('dumpsys location'));
      expect(!registered(), 'a location listener exists before any watch');
      const fix = (latitude, longitude) =>
        adb('emu', 'geo', 'fix', String(longitude), String(latitude));
      const pending = app.send('geo', { timeout: '20000' });
      const current = await until(
        'a current position',
        () => {
          fix(52.37, 4.9);
          return app.read(pending);
        },
        25000,
        1000,
      );
      expect(current.ok, 'getCurrentPosition: ' + current.error);
      expect(
        near(current.value.latitude, 52.37, 0.01) &&
          near(current.value.longitude, 4.9, 0.01),
        `position ${current.value.latitude}, ${current.value.longitude}`,
      );
      const name = await record('geo-watch');
      await until('watch registered', registered);
      await until(
        'a watched position',
        () => {
          fix(48.85, 2.35);
          return events(name).some((event) =>
            near(event.latitude, 48.85, 0.01),
          );
        },
        25000,
        1000,
      );
      await app.step('unsubscribe', { name: 'geo' });
      await until('watch unregistered', () => !registered());
      return 'geo fix read as current position and by a watch; no registration after dispose';
    },
    async sensors() {
      const available = await app.step('sensors');
      expect(available.accelerometer === true, 'no accelerometer reported');
      // A connection is listed by its listener's class and the app's uid.
      const connected = () =>
        new RegExp(`\\| uid ${ownUid()} \\|`).test(
          section(
            tryShell('dumpsys sensorservice'),
            /\d+ (?:open event|active) connections/,
            /\d+ (?:open )?direct connections|Previous Registrations/,
          ),
        );
      expect(!connected(), 'a sensor connection exists before any watch');
      if (!shared) adb('emu', 'sensor', 'set', 'acceleration', '1.5:2.5:9');
      const name = app.send('sensor-watch', { type: 'accelerometer' });
      const reading = await until('accelerometer readings', () => {
        const value = app.read(name)?.value;
        if (!value?.latest) return null;
        return shared || near(value.latest.x, 1.5, 0.3) ? value.latest : null;
      });
      expect(connected(), 'no sensor connection while watching');
      await app.step('unsubscribe', { name: 'sensor' });
      await until('sensor connection closed', () => !connected());
      if (!shared) adb('emu', 'sensor', 'set', 'acceleration', '0:9.81:0');
      return `${shared ? 'readings' : `x ${reading.x.toFixed(1)} y ${reading.y.toFixed(1)}`}; connection only while watched`;
    },
    async fullscreen() {
      const parts = [];
      if (form === 'phone') {
        const statusBar = () =>
          /type=statusBars[^\n]*visible=(true|false)/.exec(
            tryShell('dumpsys window displays'),
          )?.[1] ??
          /type=statusBars[^\n]*visible=(true|false)/.exec(
            tryShell('dumpsys window'),
          )?.[1];
        await app.step('fullscreen', { on: '0' });
        await until('status bar visible first', () => statusBar() === 'true');
        await app.step('fullscreen', { on: '1' });
        await until('status bar hidden', () => statusBar() === 'false');
        await app.step('fullscreen', { on: '0' });
        await until('status bar back', () => statusBar() === 'true');
        parts.push('immersive on and off');
      }
      if (has.pictureInPicture && has.sdk >= 26) {
        const pinned = () => {
          const dump = tryShell('dumpsys activity activities');
          return dump
            .split(/\n(?=\s*\* Task\{)/)
            .some(
              (task) =>
                task.includes(id) &&
                /mode=pinned|WINDOWING_MODE_PINNED/i.test(task),
            );
        };
        await app.step('pip');
        await until('activity pinned', pinned);
        // Not `am start -W`, which the probe's steps use: it can wait for
        // ever on an activity that is still entering picture-in-picture.
        await until(
          'activity out of picture-in-picture and on top',
          () => {
            if (!pinned() && onTop()) return true;
            shell(
              `am start -a android.intent.action.VIEW -d 'solidprobe://run/available?id=expand&names=links' ${id} >/dev/null`,
            );
            return false;
          },
          20000,
          1000,
        );
        parts.push('picture-in-picture entered and left');
      }
      expect(parts.length > 0, 'nothing to check on this device');
      return parts.join('; ');
    },
    async mediaCapabilities() {
      const value = await app.step('mediaCapabilities');
      expect(
        Array.isArray(value.drm) && Array.isArray(value.codecs),
        'unexpected shape',
      );
      expect(typeof value.hdr === 'boolean', 'hdr is not a boolean');
      expect(
        value.codecs.includes('video/avc') &&
          value.codecs.includes('audio/mp4a-latm'),
        'no H.264 or AAC decoder listed',
      );
      expect(
        value.drm.every((name) => /^(com|org)\./.test(name)),
        'unexpected DRM names',
      );
      return `${value.codecs.length} decoder types, DRM [${value.drm.join(', ')}], hdr ${value.hdr}`;
    },
    async contacts() {
      // 2,000 contacts, written by the probe with a permission only it has
      // (the provider under test never writes), and deleted afterwards.
      const seeded =
        'content://com.android.contacts/raw_contacts?caller_is_syncadapter=true';
      const clean = () =>
        tryShell(
          `content delete --uri '${seeded}' --where "display_name LIKE 'Seed Person%'"`,
        );
      for (const name of ['READ_CONTACTS', 'WRITE_CONTACTS'])
        shell(`pm grant ${id} android.permission.${name}`);
      clean();
      restoring('seeded contacts', clean);
      for (let from = 0; from < 2000; from += 250)
        await app.step(
          'contacts-seed',
          { from: String(from), count: '250' },
          60000,
        );
      const all = await app.step('contacts', { limit: '2000' }, 60000);
      expect(all.count === 2000, `read ${all.count} of 2000`);
      // The scene's frame callbacks kept arriving while the rows were read.
      expect(
        all.worstFrameGapMs < 100 && all.frames > all.ms / 50,
        `worst frame gap ${all.worstFrameGapMs} ms, ${all.frames} frames in ${all.ms} ms`,
      );
      const first = await app.step('contacts', { limit: '100' });
      const second = await app.step('contacts', {
        limit: '100',
        after: first.last,
      });
      expect(
        first.count === 100 &&
          second.count === 100 &&
          Number(second.first[0].id) > Number(first.last),
        'the second page does not continue the first',
      );
      const found = await app.step('contacts', { search: 'Person1999' });
      expect(
        found.count === 1 && found.first[0].displayName === 'Seed Person1999',
        'search did not find the one contact',
      );
      expect(
        found.first[0].phones?.length === 1,
        'the contact has no phone number',
      );
      clean();
      return `2000 read in ${all.ms} ms over ${all.frames} frames, worst frame gap ${all.worstFrameGapMs} ms (Choreographer, in the app); pages of 100 continue; search finds one`;
    },
    async calendar() {
      const account = 'account_name=verify&account_type=LOCAL';
      const calendars = `content://com.android.calendar/calendars?caller_is_syncadapter=true&${account}`;
      const clean = () =>
        tryShell(
          `content delete --uri '${calendars}' --where "account_name='verify'"`,
        );
      shell(`pm grant ${id} android.permission.READ_CALENDAR`);
      clean();
      restoring('test calendar', clean);
      shell(
        `content insert --uri '${calendars}' --bind account_name:s:verify --bind account_type:s:LOCAL --bind name:s:verify --bind calendar_displayName:s:Verify --bind calendar_access_level:i:700 --bind ownerAccount:s:verify --bind visible:i:1 --bind sync_events:i:1`,
      );
      const calendarId = /_id=(\d+)/.exec(
        shell(
          `content query --uri content://com.android.calendar/calendars --projection _id --where "account_name='verify'"`,
        ),
      )?.[1];
      expect(calendarId, 'the test calendar was not created');
      const start = Date.UTC(2031, 0, 6, 9);
      const hour = 3600000;
      for (let i = 0; i < 3; i++)
        shell(
          `content insert --uri content://com.android.calendar/events --bind calendar_id:i:${calendarId} --bind title:s:VerifyEvent${i} --bind dtstart:l:${start + i * 2 * hour} --bind dtend:l:${start + i * 2 * hour + hour} --bind eventTimezone:s:UTC`,
        );
      const range = {
        start: String(start - hour),
        end: String(start + 8 * hour),
      };
      const listed = await until('three inserted events', async () => {
        const value = await app.step('calendar', range);
        return value.events.length === 3 ? value : null;
      });
      expect(
        listed.events.map((event) => event.title).join() ===
          'VerifyEvent0,VerifyEvent1,VerifyEvent2' &&
          listed.events[0].start === start &&
          listed.events[0].calendarId === calendarId,
        'unexpected events: ' + JSON.stringify(listed.events).slice(0, 200),
      );
      const limited = await app.step('calendar', { ...range, limit: '2' });
      expect(
        limited.events.length === 2,
        'limit 2 returned ' + limited.events.length,
      );
      const outside = await app.step('calendar', {
        start: String(start + 24 * hour),
        end: String(start + 48 * hour),
      });
      expect(outside.events.length === 0, 'events outside the range');
      clean();
      return 'three inserted events read in order; limit and range respected; calendar removed';
    },
    async maps() {
      await app.step('maps');
      await until('a maps activity on top', () => {
        const pkg = topActivity()[1];
        return pkg && pkg !== id;
      });
      await front();
      return 'geo: intent resolved and opened; probe brought back';
    },
  };

  const availability = await app.step('available', {
    names: ANDROID_SERVICES.join(','),
  });
  try {
    for (const service of ANDROID_SERVICES) {
      const gate = preview.has(service) ? 'preview' : 'default';
      const started = Date.now();
      const row = { service, gate, status: 'pass', detail: '' };
      if (!installed.has(service)) {
        row.gate = androidServiceSupported(service, form) ? gate : 'phone only';
        row.status = 'unavailable';
        if (availability[service] !== 'unavailable') {
          row.status = 'fail';
          row.detail = `not installed, yet reported ${availability[service]}`;
        } else
          row.detail = androidServiceSupported(service, form)
            ? 'the device or the manifest cannot support it'
            : 'reports unavailable on a TV';
      } else if (!androidServiceSupported(service, form)) {
        row.status = 'fail';
        row.detail = 'a phone-only service is installed on a TV';
      } else if (!checks[service]) {
        row.status = gate === 'default' ? 'fail' : 'not checked';
        row.detail =
          gate === 'default'
            ? 'a default service without a check'
            : 'preview: no check';
      } else {
        try {
          row.detail = await checks[service]();
        } catch (error) {
          // A default service must be checked; a preview may be left out.
          row.status =
            gate === 'default'
              ? 'fail'
              : error instanceof Skipped
                ? 'not checked'
                : 'preview failed';
          row.detail = error.message.split('\n')[0];
          // Whatever state the failure left, the next check starts clean.
          await restore();
          await app.restart().catch(() => {});
        }
        await restore();
      }
      row.ms = Date.now() - started;
      rows.push(row);
      console.error(`${row.status.padEnd(14)} ${service}`);
    }
  } finally {
    await restore();
  }
  return {
    form,
    sdk: boot.sdk,
    shared: Boolean(shared),
    featureDetectionMs: boot.detectMs,
    hostServices: boot.hostServices,
    restored,
    rows,
    failed: rows.filter((row) => row.status === 'fail').length,
  };
}

/** The result as a text table. */
export function table(result) {
  const columns = ['service', 'gate', 'status', 'ms', 'detail'];
  const cells = result.rows.map((row) =>
    columns.map((name) => String(row[name] ?? '')),
  );
  const widths = columns.map((name, i) =>
    Math.max(
      name.length,
      ...cells.map((row) => (i === columns.length - 1 ? 0 : row[i].length)),
    ),
  );
  const line = (row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i])))
      .join('  ');
  return [
    `Android ${result.form}, API ${result.sdk}${result.shared ? ', shared device' : ''}; feature detection ${result.featureDetectionMs} ms`,
    line(columns),
    ...cells.map(line),
    `${result.rows.length} rows, ${result.failed} failed`,
  ].join('\n');
}
