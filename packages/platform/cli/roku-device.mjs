// Talks to a Roku in developer mode: install a ZIP, launch, send keys, read
// the debug console and take screenshots. Uses the device's own developer
// installer and External Control Protocol, so it needs no extra tools.
//
// The device is named by ROKU_DEV_IP, ROKU_DEV_USERNAME (default rokudev) and
// ROKU_DEV_PASSWORD. Nothing here prints them.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export function rokuDevice(env = process.env) {
  const ip = env.ROKU_DEV_IP;
  const user = env.ROKU_DEV_USERNAME || 'rokudev';
  const password = env.ROKU_DEV_PASSWORD;
  if (!ip || !password)
    throw new Error(
      'Set ROKU_DEV_IP and ROKU_DEV_PASSWORD to reach a Roku in developer mode.',
    );
  return { ip, user, password };
}

const md5 = (text) => createHash('md5').update(text).digest('hex');

/** `fetch` with HTTP digest authentication, which the developer installer requires. */
async function digestFetch(device, url, init = {}) {
  const method = init.method ?? 'GET';
  const challenge = await fetch(url, { method, redirect: 'manual' });
  await challenge.arrayBuffer();
  if (challenge.status !== 401) return fetch(url, init);
  const header = challenge.headers.get('www-authenticate') ?? '';
  const field = (name) =>
    new RegExp(name + '="?([^",]+)"?').exec(header)?.[1] ?? '';
  const realm = field('realm');
  const nonce = field('nonce');
  const qop = field('qop').split(',')[0]?.trim();
  const uri = new URL(url).pathname + new URL(url).search;
  const ha1 = md5(`${device.user}:${realm}:${device.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  let authorization = `Digest username="${device.user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) authorization += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  const opaque = field('opaque');
  if (opaque) authorization += `, opaque="${opaque}"`;
  return fetch(url, {
    ...init,
    headers: { ...init.headers, authorization },
  });
}

const ecp = (device, route, method = 'GET') =>
  fetch(`http://${device.ip}:8060/${route}`, {
    method,
    signal: AbortSignal.timeout(10_000),
  });

/** The id of the app on screen, such as `dev` or `tvinput.hdmi1`. */
export async function activeApp(device) {
  const xml = await (await ecp(device, 'query/active-app')).text();
  return /<app id="([^"]+)"/.exec(xml)?.[1];
}

/** Facts from the device: model, software version, developer mode. */
export async function deviceInfo(device) {
  const xml = await (await ecp(device, 'query/device-info')).text();
  const read = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
  return {
    model: read('model-name'),
    softwareVersion: read('software-version'),
    developerEnabled: read('developer-enabled') === 'true',
    uiResolution: read('ui-resolution'),
    isTv: read('is-tv') === 'true',
  };
}

/** Launches an installed app; `params` become launch (deep link) parameters. */
export async function launch(device, appId = 'dev', params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await ecp(
    device,
    `launch/${appId}${query ? '?' + query : ''}`,
    'POST',
  );
  if (!response.ok) throw new Error(`Launch of ${appId} failed: ${response.status}`);
}

/** Sends input to the running app, as a deep link while it is open does. */
export async function sendInput(device, params) {
  const response = await ecp(
    device,
    'input?' + new URLSearchParams(params).toString(),
    'POST',
  );
  if (!response.ok) throw new Error(`Input failed: ${response.status}`);
}

/** Presses remote keys in order: `Home`, `Select`, `Up`, `Lit_a`, ... */
export async function keypress(device, keys, gapMs = 150) {
  for (const key of [].concat(keys)) {
    const response = await ecp(
      device,
      'keypress/' + encodeURIComponent(key),
      'POST',
    );
    if (!response.ok) throw new Error(`Key ${key} failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}

/**
 * Installs a ZIP in the developer slot, replacing what is there, and the
 * device then launches it. Throws with the device's message on failure.
 */
export async function sideload(device, zipFile) {
  const form = new FormData();
  form.set('mysubmit', 'Install');
  form.set(
    'archive',
    new Blob([readFileSync(zipFile)], { type: 'application/zip' }),
    path.basename(zipFile),
  );
  const response = await digestFetch(
    device,
    `http://${device.ip}/plugin_install`,
    { method: 'POST', body: form },
  );
  const page = await response.text();
  if (response.status === 401)
    throw new Error('The Roku rejected the developer user name or password.');
  if (/Install Success|Identical to previous version/.test(page)) return;
  const reason =
    /(Install Failure[^<"\\]*|Compilation Failed[^<"\\]*)/.exec(page)?.[1] ??
    `HTTP ${response.status}`;
  throw new Error('Sideload failed: ' + reason);
}

/** A PNG of what the developer app is showing. */
export async function screenshot(device) {
  const form = new FormData();
  form.set('mysubmit', 'Screenshot');
  form.set('passwd', '');
  form.set('archive', new Blob([]), '');
  const taken = await digestFetch(
    device,
    `http://${device.ip}/plugin_inspect`,
    { method: 'POST', body: form },
  );
  const page = await taken.text();
  const file = /pkgs\/dev\.(png|jpg)/.exec(page)?.[0];
  if (!file) throw new Error('The Roku did not return a screenshot.');
  const image = await digestFetch(device, `http://${device.ip}/${file}`);
  if (!image.ok) throw new Error(`Screenshot download failed: ${image.status}`);
  return Buffer.from(await image.arrayBuffer());
}

/**
 * Streams the developer console (port 8085) line by line until `onLine`
 * returns true, the time runs out, or the returned `stop` is called. Resolves
 * with every line seen. The device allows one console connection at a time.
 */
export function readConsole(device, onLine, timeoutMs = 60_000) {
  const lines = [];
  let stop = () => {};
  const done = new Promise((resolve, reject) => {
    const socket = net.connect(8085, device.ip);
    let pending = '';
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(lines);
    };
    const timer = setTimeout(finish, timeoutMs);
    stop = () => finish();
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        // The console colours some lines; keep the text only.
        const line = pending
          .slice(0, end)
          .replace(/\r$/, '')
          // eslint-disable-next-line no-control-regex
          .replace(/\u001b\[[0-9;]*m/g, '');
        pending = pending.slice(end + 1);
        lines.push(line);
        if (onLine?.(line) === true) return finish();
      }
    });
    socket.on('error', finish);
    socket.on('close', () => finish());
  });
  return { done, stop: () => stop() };
}
