// The web-standard globals the host package supplies (src/web), in the
// runtime without a window: URL parsing and setters against the URL
// Standard's reference implementation (url-cases.ts), UTF-8 encoding and
// decoding, abort signals, events, headers, requests and responses over a
// transport made here, and structured clone.
import {
  AbortController,
  AbortSignal,
  createFetch,
  DOMException,
  Event,
  EventTarget,
  Headers,
  Response,
  structuredClone,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  type HttpTransport,
} from '../../src/web/index';
import { PARSE, SETTERS } from './url-cases';

const failures: string[] = [];
let checks = 0;
function equal(name: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) failures.push(`${name}: ${a} is not ${b}`);
}
function throws(name: string, kind: string, action: () => unknown): void {
  checks++;
  try {
    action();
    failures.push(`${name}: did not throw`);
  } catch (error) {
    if ((error as Error).name !== kind) {
      failures.push(`${name}: threw ${(error as Error).name}, not ${kind}`);
    }
  }
}
async function rejects(
  name: string,
  kind: string,
  action: () => Promise<unknown>,
): Promise<void> {
  checks++;
  try {
    await action();
    failures.push(`${name}: did not reject`);
  } catch (error) {
    if ((error as Error).name !== kind) {
      failures.push(`${name}: rejected with ${(error as Error).name}`);
    }
  }
}

function urls(): void {
  for (const [input, base, href] of PARSE) {
    let actual: string | null;
    try {
      actual = new URL(input, base ?? undefined).href;
    } catch {
      actual = null;
    }
    equal(
      `URL(${JSON.stringify(input)}, ${JSON.stringify(base)})`,
      actual,
      href,
    );
  }
  for (const [href, property, value, expected] of SETTERS) {
    const url = new URL(href);
    // A leading "!" in the table: the setter throws and nothing changes.
    let threw = false;
    try {
      (url as unknown as Record<string, string>)[property] = value;
    } catch {
      threw = true;
    }
    equal(
      `${href} .${property} = ${JSON.stringify(value)}`,
      (threw ? '!' : '') + url.href,
      expected,
    );
  }
  const url = new URL('https://user:pw@example.com:8443/a/b?x=1&y=2#top');
  equal(
    'URL parts',
    [
      url.protocol,
      url.username,
      url.password,
      url.host,
      url.hostname,
      url.port,
      url.pathname,
      url.search,
      url.hash,
      url.origin,
    ],
    [
      'https:',
      'user',
      'pw',
      'example.com:8443',
      'example.com',
      '8443',
      '/a/b',
      '?x=1&y=2',
      '#top',
      'https://example.com:8443',
    ],
  );
  url.searchParams.append('z', 'a b&c');
  equal('searchParams writes through', url.search, '?x=1&y=2&z=a+b%26c');
  url.search = '?only=1';
  equal('search writes through', [...url.searchParams], [['only', '1']]);
  equal(
    'canParse',
    [URL.canParse('http://a'), URL.canParse('nope')],
    [true, false],
  );
  throws('an invalid URL', 'TypeError', () => new URL('http://'));
  const params = new URLSearchParams('a=1&b=2&a=3&c=%C3%A9+x');
  equal(
    'URLSearchParams',
    [
      params.get('a'),
      params.getAll('a'),
      params.get('c'),
      params.has('b'),
      params.toString(),
    ],
    ['1', ['1', '3'], 'é x', true, 'a=1&b=2&a=3&c=%C3%A9+x'],
  );
  params.sort();
  params.delete('b');
  equal(
    'URLSearchParams sort and delete',
    params.toString(),
    'a=1&a=3&c=%C3%A9+x',
  );
}

function encoding(): void {
  const text = 'aé€😀\u0000z';
  const bytes = new TextEncoder().encode(text);
  equal(
    'encode',
    Array.from(bytes),
    [97, 195, 169, 226, 130, 172, 240, 159, 152, 128, 0, 122],
  );
  equal('decode', new TextDecoder().decode(bytes), text);
  equal(
    'a lone surrogate encodes as U+FFFD',
    Array.from(new TextEncoder().encode('\ud800')),
    [239, 191, 189],
  );
  // Split at every byte: the pieces decode to the whole.
  for (let at = 0; at <= bytes.length; at++) {
    const decoder = new TextDecoder();
    const joined =
      decoder.decode(bytes.subarray(0, at), { stream: true }) +
      decoder.decode(bytes.subarray(at));
    equal(`streaming, split at ${at}`, joined, text);
  }
  const invalid: [number[], string][] = [
    [[0xc0, 0xaf], '��'],
    [[0xed, 0xa0, 0x80], '���'],
    [[0xf4, 0x90, 0x80, 0x80], '����'],
    [[0xe2, 0x82], '�'],
    [[0x61, 0xff, 0x62], 'a�b'],
    [[0xf0, 0x9f, 0x98, 0x41], '�A'],
  ];
  for (const [input, expected] of invalid) {
    equal(
      `invalid ${String(input)}`,
      new TextDecoder().decode(Uint8Array.from(input)),
      expected,
    );
    throws(`fatal ${String(input)}`, 'TypeError', () =>
      new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(input)),
    );
  }
  equal(
    'a byte order mark is dropped',
    new TextDecoder().decode(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])),
    'A',
  );
  equal(
    'unless asked to keep it',
    new TextDecoder('utf8', { ignoreBOM: true }).decode(
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]),
    ),
    '﻿A',
  );
  throws('another encoding', 'RangeError', () => new TextDecoder('utf-16le'));
  const into = new Uint8Array(4);
  equal(
    'encodeInto stops at a whole character',
    [new TextEncoder().encodeInto('a€€', into), Array.from(into)],
    [{ read: 2, written: 4 }, [97, 226, 130, 172]],
  );
}

async function signals(): Promise<void> {
  const controller = new AbortController();
  const heard: string[] = [];
  controller.signal.addEventListener('abort', () => heard.push('listener'), {
    once: true,
  });
  controller.signal.onabort = () => heard.push('onabort');
  controller.abort();
  controller.abort();
  equal(
    'abort fires once',
    [
      controller.signal.aborted,
      heard.sort(),
      (controller.signal.reason as Error).name,
    ],
    [true, ['listener', 'onabort'], 'AbortError'],
  );
  throws('throwIfAborted', 'AbortError', () =>
    controller.signal.throwIfAborted(),
  );
  equal(
    'AbortSignal.abort',
    [AbortSignal.abort('why').aborted, AbortSignal.abort('why').reason],
    [true, 'why'],
  );
  const either = AbortSignal.any([
    new AbortController().signal,
    AbortSignal.abort('first'),
  ]);
  equal('AbortSignal.any', [either.aborted, either.reason], [true, 'first']);
  const timed = AbortSignal.timeout(20);
  await new Promise((resolve) => setTimeout(resolve, 60));
  equal(
    'AbortSignal.timeout',
    [timed.aborted, (timed.reason as Error).name],
    [true, 'TimeoutError'],
  );
  equal(
    'DOMException',
    [
      new DOMException('m', 'AbortError').code,
      new DOMException('m') instanceof Error,
    ],
    [20, true],
  );

  const target = new EventTarget();
  const order: string[] = [];
  const twice = (): void => void order.push('twice');
  target.addEventListener('ping', twice);
  target.addEventListener('ping', twice);
  target.addEventListener('ping', {
    handleEvent: () => void order.push('object'),
  });
  target.addEventListener('ping', (event) => event.preventDefault(), {
    once: true,
  });
  const first = target.dispatchEvent(new Event('ping', { cancelable: true }));
  target.removeEventListener('ping', twice);
  const second = target.dispatchEvent(new Event('ping', { cancelable: true }));
  equal(
    'EventTarget',
    [order, first, second],
    [['twice', 'object', 'object'], false, true],
  );
}

async function fetching(): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'text/plain', 'X-A': '1' });
  headers.append('x-a', '2');
  equal(
    'Headers',
    [
      headers.get('content-type'),
      headers.get('X-A'),
      headers.has('x-b'),
      [...headers.keys()],
    ],
    ['text/plain', '1, 2', false, ['content-type', 'x-a']],
  );
  throws(
    'an invalid header name',
    'TypeError',
    () => new Headers({ 'a b': '1' }),
  );

  const sent: {
    method: string;
    url: string;
    body?: number[];
    headers: [string, string][];
  }[] = [];
  let aborted = 0;
  const body = (text: string): ArrayBuffer =>
    new TextEncoder().encode(text).buffer as ArrayBuffer;
  const transport: HttpTransport = {
    send(request, done) {
      sent.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body && Array.from(request.body),
      });
      const path = new URL(request.url).pathname;
      let cancelled = false;
      const timer = setTimeout(
        () => {
          if (cancelled) return;
          if (path === '/down') {
            done(new Error('connection refused'));
          } else if (path === '/moved') {
            done(null, {
              status: 302,
              statusText: 'Found',
              url: request.url,
              redirected: false,
              headers: [['location', '/there']],
              body: new ArrayBuffer(0),
            });
          } else {
            done(null, {
              status: path === '/missing' ? 404 : 200,
              statusText: 'OK',
              url: request.url,
              redirected: false,
              headers: [['Content-Type', 'application/json']],
              body: body('{"ok":true,"é":1}'),
            });
          }
        },
        path === '/slow' ? 200 : 0,
      );
      return () => {
        cancelled = true;
        aborted++;
        clearTimeout(timer);
      };
    },
  };
  const fetch = createFetch(transport);
  const response = await fetch('http://host/data?x=1', {
    method: 'post',
    body: 'héllo',
    headers: { 'X-Token': 't' },
  });
  equal(
    'fetch: response',
    [
      response.status,
      response.ok,
      response.headers.get('content-type'),
      await response.json(),
    ],
    [200, true, 'application/json', { ok: true, é: 1 }],
  );
  equal(
    'fetch: what was sent',
    [
      sent[0]!.method,
      sent[0]!.url,
      sent[0]!.body,
      sent[0]!.headers.some(([name]) => name.toLowerCase() === 'content-type'),
    ],
    ['POST', 'http://host/data?x=1', [104, 195, 169, 108, 108, 111], true],
  );
  await rejects('a body is read once', 'TypeError', () => response.text());
  equal('fetch: 404', (await fetch('http://host/missing')).status, 404);
  equal(
    'fetch: redirect manual',
    (await fetch('http://host/moved', { redirect: 'manual' })).status,
    302,
  );
  await rejects('fetch: redirect error', 'TypeError', () =>
    fetch('http://host/moved', { redirect: 'error' }),
  );
  await rejects('fetch: network error', 'TypeError', () =>
    fetch('http://host/down'),
  );
  await rejects('fetch: not http', 'TypeError', () => fetch('ftp://host/x'));
  await rejects('fetch: GET with a body', 'TypeError', () =>
    fetch('http://host/x', { body: 'x' }),
  );
  const controller = new AbortController();
  // This package's AbortSignal, which the DOM's type does not know.
  const slow = fetch('http://host/slow', {
    signal: controller.signal as never,
  });
  controller.abort();
  await rejects('fetch: abort', 'AbortError', () => slow);
  equal('fetch: abort reaches the transport', aborted, 1);
  const before = sent.length;
  await rejects('fetch: already aborted', 'AbortError', () =>
    fetch('http://host/x', { signal: AbortSignal.abort() as never }),
  );
  equal('fetch: an aborted signal sends nothing', sent.length, before);
  const made = Response.json({ a: [1, 2] }, { status: 201 });
  const copy = made.clone();
  equal(
    'Response.json and clone',
    [made.status, await made.text(), await copy.json()],
    [201, '{"a":[1,2]}', { a: [1, 2] }],
  );
  throws(
    'Response.body is not implemented, by name',
    'Error',
    () => new Response('x').body,
  );
}

function cloning(): void {
  const shared = new Uint8Array([1, 2, 3]);
  const source: Record<string, unknown> = {
    date: new Date(5),
    pattern: /a+/gi,
    map: new Map([['k', { deep: true }]]),
    set: new Set([1, 2]),
    bytes: shared,
    again: shared,
    big: 10n ** 20n,
    error: new RangeError('bad'),
  };
  source.self = source;
  const copy = structuredClone(source) as typeof source & {
    map: Map<string, { deep: boolean }>;
  };
  equal(
    'structuredClone',
    [
      copy !== source && copy.self === copy,
      (copy.date as Date).getTime(),
      String(copy.pattern),
      copy.map.get('k'),
      [...(copy.set as Set<number>)],
      Array.from(copy.bytes as Uint8Array),
      copy.bytes === copy.again && copy.bytes !== shared,
      String(copy.big),
      (copy.error as Error).name + ':' + (copy.error as Error).message,
    ],
    [
      true,
      5,
      '/a+/gi',
      { deep: true },
      [1, 2],
      [1, 2, 3],
      true,
      '100000000000000000000',
      'RangeError:bad',
    ],
  );
  throws('a function is not cloned', 'DataCloneError', () =>
    structuredClone({ f() {} }),
  );
  throws('a symbol is not cloned', 'DataCloneError', () =>
    structuredClone(Symbol('s')),
  );
}

async function run(): Promise<void> {
  urls();
  encoding();
  await signals();
  await fetching();
  cloning();
  // Nothing is left running.
  const before = __solid.stats().wakeups;
  await new Promise((resolve) => setTimeout(resolve, 500));
  equal('idle afterwards', __solid.stats().wakeups - before <= 1, true);
  if (failures.length > 0) console.error(failures.join('\n'));
  else console.log(`web globals: ${checks} checks ok`);
  __solid.exit(failures.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  __solid.exit(1);
});
