// `Headers`, `Request`, `Response` and `fetch` (Fetch Standard) over a
// transport the host provides.
//
// What a browser's fetch has and this one has not, because the host has no
// origin, no cookie jar and no HTTP cache: CORS and the request modes,
// credentials modes, cache modes, referrers, and the forbidden header names
// (an app may set `Cookie` or `User-Agent` here). Those options are accepted
// and select nothing. Bodies are whole byte arrays: streams (`body`,
// `ReadableStream` and `FormData` bodies, `formData()`) throw by name, and
// so does `integrity`, a check that must not be skipped silently.
import { blobBytes } from '../globals.js';
import { AbortController, type AbortSignal } from './abort.js';
import { decodeUtf8, encodeUtf8, viewBytes } from './encoding.js';
import { URL } from './url.js';

// --- The transport ------------------------------------------------------------

export interface HttpRequest {
  method: string; // upper-case
  url: string; // absolute http(s) URL, serialised by URL
  headers: [string, string][];
  body?: Uint8Array;
  redirect: 'follow' | 'error' | 'manual';
}

export interface HttpResponse {
  status: number;
  statusText: string;
  url: string; // final URL after redirects
  redirected: boolean;
  headers: [string, string][];
  body: ArrayBuffer; // whole body, already content-decoded
}

export interface HttpTransport {
  /**
   * Starts the request. `done` is called exactly once, later (never
   * synchronously), unless the returned function was called first: that
   * aborts the request and `done` is then never called.
   */
  send(
    request: HttpRequest,
    done: (error: Error | null, response?: HttpResponse) => void,
  ): () => void;
}

// --- Headers ------------------------------------------------------------------

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// In a value: NUL, a line break, or a character that is not a byte.
const NOT_A_VALUE = /[\0\n\r]|[^\0-\xff]/;
const AROUND_A_VALUE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

export type HeadersInit =
  | Headers
  | Iterable<Iterable<string>>
  | Record<string, string>;

function headerName(name: string): string {
  const text = String(name);
  if (!TOKEN.test(text))
    throw new TypeError(`Headers: "${text}" is not a header name`);
  return text.toLowerCase();
}

function headerValue(name: string, value: string): string {
  const text = String(value).replace(AROUND_A_VALUE, '');
  if (NOT_A_VALUE.test(text))
    throw new TypeError(`Headers: invalid value for "${name}"`);
  return text;
}

// What the other classes need of a `Headers`' private state.
let freeze: (headers: Headers) => Headers;
let isFrozen: (headers: Headers) => boolean;
let listOf: (headers: Headers) => readonly (readonly [string, string])[];

export class Headers {
  // Lower-case name and value, in the order they were added.
  #list: [string, string][] = [];
  // The headers of a response fetch made, and of `Response.error()` and
  // `Response.redirect()`.
  #immutable = false;

  constructor(init?: HeadersInit) {
    if (init === undefined) return;
    if (typeof init !== 'object' || init === null)
      throw new TypeError('Headers: the initial value must be an object');
    if (Symbol.iterator in init) {
      for (const pair of init) {
        const items =
          typeof pair === 'object' && pair !== null ? [...pair] : [];
        if (items.length !== 2)
          throw new TypeError(
            'Headers: each pair must be an iterable of a name and a value',
          );
        this.append(items[0]!, items[1]!);
      }
    } else {
      for (const name of Object.keys(init)) this.append(name, init[name]!);
    }
  }

  #change(): void {
    if (this.#immutable) throw new TypeError('Headers: these are immutable');
  }

  append(name: string, value: string): void {
    const key = headerName(name);
    const text = headerValue(key, value);
    this.#change();
    this.#list.push([key, text]);
  }

  delete(name: string): void {
    const key = headerName(name);
    this.#change();
    this.#list = this.#list.filter((pair) => pair[0] !== key);
  }

  /** Every value of the name, joined with ", "; null when there is none. */
  get(name: string): string | null {
    const key = headerName(name);
    let value: string | null = null;
    for (const pair of this.#list)
      if (pair[0] === key)
        value = value === null ? pair[1] : value + ', ' + pair[1];
    return value;
  }

  /** `Set-Cookie` values cannot be joined: each one, as it arrived. */
  getSetCookie(): string[] {
    const values: string[] = [];
    for (const pair of this.#list)
      if (pair[0] === 'set-cookie') values.push(pair[1]);
    return values;
  }

  has(name: string): boolean {
    const key = headerName(name);
    return this.#list.some((pair) => pair[0] === key);
  }

  /** Replaces the first value of the name and drops its others. */
  set(name: string, value: string): void {
    const key = headerName(name);
    const text = headerValue(key, value);
    this.#change();
    const first = this.#list.find((pair) => pair[0] === key);
    if (first === undefined) {
      this.#list.push([key, text]);
      return;
    }
    first[1] = text;
    this.#list = this.#list.filter((pair) => pair === first || pair[0] !== key);
  }

  /** Sorted by name, one entry per name, except `set-cookie`: one per value. */
  #sorted(): [string, string][] {
    const names = [...new Set(this.#list.map((pair) => pair[0]))].sort();
    const entries: [string, string][] = [];
    for (const name of names) {
      if (name === 'set-cookie')
        for (const value of this.getSetCookie()) entries.push([name, value]);
      else entries.push([name, this.get(name)!]);
    }
    return entries;
  }

  forEach(
    callback: (value: string, name: string, parent: Headers) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.#sorted())
      callback.call(thisArg, value, name, this);
  }

  entries(): IterableIterator<[string, string]> {
    return this.#sorted().values();
  }

  *keys(): IterableIterator<string> {
    for (const entry of this.#sorted()) yield entry[0];
  }

  *values(): IterableIterator<string> {
    for (const entry of this.#sorted()) yield entry[1];
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'Headers';
  }

  static {
    freeze = (headers) => {
      headers.#immutable = true;
      return headers;
    };
    isFrozen = (headers) => headers.#immutable;
    listOf = (headers) => headers.#list;
  }
}

// --- Bodies -------------------------------------------------------------------

export type BodyInit = string | ArrayBuffer | ArrayBufferView | Blob | object;

const NOT_STREAMS =
  'streams are not implemented by the desktop host: read the body with arrayBuffer(), bytes(), text(), json() or blob()';

/** The content type the last `extract` found for its body, or null. */
let extractedType: string | null = null;

/**
 * The bytes of a body, in an array nothing else holds, and through
 * `extractedType` the content type that goes with it when none is given.
 */
function extract(body: BodyInit): Uint8Array {
  extractedType = null;
  if (typeof body === 'object') {
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
      return viewBytes(body).slice();
    const blob = blobBytes(body);
    if (blob !== undefined) {
      extractedType = (body as Blob).type || null;
      return blob.slice();
    }
    const tag = Object.prototype.toString.call(body).slice(8, -1);
    if (tag === 'URLSearchParams') {
      extractedType = 'application/x-www-form-urlencoded;charset=UTF-8';
      return encodeUtf8(String(body));
    }
    if (tag === 'FormData' || tag === 'ReadableStream' || tag === 'Blob')
      throw new Error(
        `fetch: a ${tag} body is not implemented by the desktop host`,
      );
  }
  extractedType = 'text/plain;charset=UTF-8';
  return encodeUtf8(String(body));
}

// What marks a body that was read: it is still not null.
const READ = new Uint8Array(0);

/** Takes the bytes out of a body, which is then used. Null when it has none. */
let take: (owner: Body) => Uint8Array | null;
/** The bytes of a body, left where they are. Throws when it was read. */
let peek: (owner: Body) => Uint8Array | null;

/** What `Request` and `Response` share: headers and a body read once. */
class Body {
  readonly #headers: Headers;
  #bytes: Uint8Array | null;
  #used = false;

  constructor(headers: Headers, bytes: Uint8Array | null) {
    this.#headers = headers;
    this.#bytes = bytes;
  }

  get headers(): Headers {
    return this.#headers;
  }

  /** Null without a body; with one it would be a stream, and throws. */
  get body(): null {
    if (this.#bytes !== null) throw new Error(`body: ${NOT_STREAMS}`);
    return null;
  }

  get bodyUsed(): boolean {
    return this.#used;
  }

  #read(): Promise<Uint8Array> {
    if (this.#used)
      return Promise.reject(new TypeError('The body has already been read'));
    return Promise.resolve(take(this) ?? new Uint8Array(0));
  }

  /** The body's own bytes: it gave them up when it was read. */
  bytes(): Promise<Uint8Array> {
    return this.#read();
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#read().then((bytes) =>
      bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer),
    );
  }

  text(): Promise<string> {
    return this.#read().then((bytes) => {
      const text = decodeUtf8(bytes, false);
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    });
  }

  json(): Promise<unknown> {
    return this.text().then(JSON.parse);
  }

  blob(): Promise<Blob> {
    return this.#read().then(
      (bytes) =>
        new Blob([bytes as BlobPart], {
          type: this.#headers.get('content-type') ?? '',
        }),
    );
  }

  formData(): Promise<never> {
    return Promise.reject(
      new Error('formData(): FormData is not implemented by the desktop host'),
    );
  }

  static {
    take = (owner) => {
      const bytes = owner.#bytes;
      if (bytes !== null) {
        owner.#used = true;
        owner.#bytes = READ;
      }
      return bytes;
    };
    peek = (owner) => {
      if (owner.#used) throw new TypeError('The body has already been read');
      return owner.#bytes;
    };
  }
}

// --- Request ------------------------------------------------------------------

type Redirect = 'follow' | 'error' | 'manual';

/** What `addEventListener` and fetch need of a signal, ours or another. */
type Signal = Pick<
  AbortSignal,
  'aborted' | 'reason' | 'addEventListener' | 'removeEventListener'
>;

export interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: Signal | null;
  redirect?: Redirect;
  integrity?: string;
  // Accepted, and select nothing: see the top of the file.
  mode?: string;
  credentials?: string;
  cache?: string;
  referrer?: string;
  referrerPolicy?: string;
  keepalive?: boolean;
  priority?: string;
  duplex?: string;
}

const NORMALIZED = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'];
const FORBIDDEN = ['CONNECT', 'TRACE', 'TRACK'];

/** The signal a request was given, without making one. */
let signalOf: (request: Request) => Signal | null;

export class Request extends Body {
  readonly #url: string;
  readonly #method: string;
  readonly #redirect: Redirect;
  #signal: Signal | null;

  constructor(input: string | URL | Request, init: RequestInit = {}) {
    const from =
      typeof input === 'object' && input !== null && #url in input
        ? input
        : null;
    let url: string;
    if (from !== null) {
      url = from.#url;
    } else {
      const parsed = new URL(String(input));
      if (parsed.username !== '' || parsed.password !== '')
        throw new TypeError(
          `Request: the URL "${parsed.href}" has credentials in it`,
        );
      url = parsed.href;
    }

    let method = from === null ? 'GET' : from.#method;
    if (init.method !== undefined) {
      method = String(init.method);
      const upper = method.toUpperCase();
      if (!TOKEN.test(method) || FORBIDDEN.includes(upper))
        throw new TypeError(`Request: "${method}" is not an allowed method`);
      if (NORMALIZED.includes(upper)) method = upper;
    }

    const redirect =
      init.redirect ?? (from === null ? 'follow' : from.#redirect);
    if (redirect !== 'follow' && redirect !== 'error' && redirect !== 'manual')
      throw new TypeError(
        `Request: "${String(redirect)}" is not a redirect mode`,
      );

    const signal =
      init.signal !== undefined
        ? init.signal
        : from === null
          ? null
          : from.#signal;
    if (
      signal !== null &&
      (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')
    )
      throw new TypeError('Request: the signal is not an AbortSignal');

    if (init.integrity)
      throw new Error(
        'Request: integrity (subresource integrity) is not implemented by the desktop host',
      );

    const headers = new Headers(init.headers ?? from?.headers);
    // Its own body, or the one of the request it is made from; reading that
    // one throws when it was read before.
    const given = init.body ?? null;
    const moved = given === null && from !== null && peek(from) !== null;
    if ((given !== null || moved) && (method === 'GET' || method === 'HEAD'))
      throw new TypeError(`Request: a ${method} request cannot have a body`);
    let bytes: Uint8Array | null = null;
    if (given !== null) {
      bytes = extract(given);
      if (extractedType !== null && !headers.has('content-type'))
        headers.append('content-type', extractedType);
    } else if (moved) {
      bytes = take(from!);
    }

    super(headers, bytes);
    this.#url = url;
    this.#method = method;
    this.#redirect = redirect;
    this.#signal = signal;
  }

  get url(): string {
    return this.#url;
  }

  get method(): string {
    return this.#method;
  }

  get redirect(): Redirect {
    return this.#redirect;
  }

  /** The signal given; without one, a signal that never aborts. */
  get signal(): Signal {
    return (this.#signal ??= new AbortController().signal);
  }

  clone(): Request {
    return new Request(this.#url, {
      method: this.#method,
      headers: this.headers,
      redirect: this.#redirect,
      signal: this.#signal,
      // Copied by the constructor.
      body: peek(this),
    });
  }

  get [Symbol.toStringTag](): string {
    return 'Request';
  }

  static {
    signalOf = (request) => request.#signal;
  }
}

// --- Response -----------------------------------------------------------------

type ResponseType = 'basic' | 'default' | 'error';

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

const NULL_BODY_STATUS = [101, 103, 204, 205, 304];
const REDIRECT_STATUS = [301, 302, 303, 307, 308];
const REASON_PHRASE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** A response as fetch and the static methods make it: nothing is checked. */
interface Made {
  bytes: Uint8Array | null;
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  redirected: boolean;
  type: ResponseType;
}

// Reaches the constructor only from this module.
let made: Made | null = null;

function make(parts: Made): Response {
  made = parts;
  return new Response();
}

export class Response extends Body {
  readonly #made: Made;

  constructor(body?: BodyInit | null, init: ResponseInit = {}) {
    let parts = made;
    made = null;
    if (parts === null) {
      const status = init.status === undefined ? 200 : Number(init.status);
      if (!Number.isInteger(status) || status < 200 || status > 599)
        throw new RangeError(
          `Response: the status ${String(init.status)} is not between 200 and 599`,
        );
      const statusText =
        init.statusText === undefined ? '' : String(init.statusText);
      if (!REASON_PHRASE.test(statusText))
        throw new TypeError('Response: invalid statusText');
      const headers = new Headers(init.headers);
      let bytes: Uint8Array | null = null;
      if (body !== undefined && body !== null) {
        if (NULL_BODY_STATUS.includes(status))
          throw new TypeError(
            `Response: a response with status ${status} cannot have a body`,
          );
        bytes = extract(body);
        if (extractedType !== null && !headers.has('content-type'))
          headers.append('content-type', extractedType);
      }
      parts = {
        bytes,
        status,
        statusText,
        headers,
        url: '',
        redirected: false,
        type: 'default',
      };
    }
    super(parts.headers, parts.bytes);
    // The bytes are the body's from here on.
    parts.bytes = null;
    this.#made = parts;
  }

  /** A network error: what a failed fetch would resolve with if it resolved. */
  static error(): Response {
    return make({
      bytes: null,
      status: 0,
      statusText: '',
      headers: freeze(new Headers()),
      url: '',
      redirected: false,
      type: 'error',
    });
  }

  static redirect(url: string | URL, status = 302): Response {
    const location = new URL(String(url)).href;
    if (!REDIRECT_STATUS.includes(status))
      throw new RangeError(
        `Response.redirect: ${status} is not a redirect status`,
      );
    return make({
      bytes: null,
      status,
      statusText: '',
      headers: freeze(new Headers({ location })),
      url: '',
      redirected: false,
      type: 'default',
    });
  }

  static json(data: unknown, init: ResponseInit = {}): Response {
    const text = JSON.stringify(data);
    if (text === undefined)
      throw new TypeError('Response.json: the value cannot be written as JSON');
    const headers = new Headers(init.headers);
    if (!headers.has('content-type'))
      headers.append('content-type', 'application/json');
    return new Response(text, {
      status: init.status,
      statusText: init.statusText,
      headers,
    });
  }

  get type(): ResponseType {
    return this.#made.type;
  }

  get url(): string {
    return this.#made.url;
  }

  get redirected(): boolean {
    return this.#made.redirected;
  }

  get status(): number {
    return this.#made.status;
  }

  get ok(): boolean {
    return this.#made.status >= 200 && this.#made.status <= 299;
  }

  get statusText(): string {
    return this.#made.statusText;
  }

  clone(): Response {
    const bytes = peek(this);
    const headers = new Headers(this.headers);
    return make({
      ...this.#made,
      bytes: bytes === null ? null : bytes.slice(),
      headers: isFrozen(this.headers) ? freeze(headers) : headers,
    });
  }

  get [Symbol.toStringTag](): string {
    return 'Response';
  }
}

// --- fetch --------------------------------------------------------------------

/**
 * `fetch` over a transport. A response arrives whole. With
 * `redirect: 'manual'` the redirect response itself is returned, status and
 * `Location` readable, where a browser returns an opaque one.
 */
export function createFetch(transport: HttpTransport): typeof fetch {
  const desktopFetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> =>
    // What throws in here rejects the promise.
    new Promise((resolve, reject) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new TypeError(
          `fetch: the scheme "${url.protocol}" is not implemented by the desktop host (only http: and https: are)`,
        );
      // A fragment is not sent.
      url.hash = '';
      const signal = signalOf(request);
      if (signal?.aborted) throw signal.reason;

      const headers = listOf(request.headers).map((pair): [string, string] => [
        pair[0],
        pair[1],
      ]);
      if (!request.headers.has('accept')) headers.push(['accept', '*/*']);
      const method = request.method;
      const sent: HttpRequest = {
        // The transport's contract; `Request.method` keeps the case given.
        method: method.toUpperCase(),
        url: url.href,
        headers,
        redirect: request.redirect,
      };
      const body = take(request);
      if (body !== null) sent.body = body;

      const onAbort = (): void => {
        abort();
        reject(signal!.reason);
      };
      const abort = transport.send(sent, (error, response) => {
        signal?.removeEventListener('abort', onAbort);
        try {
          if (error !== null || response === undefined)
            throw new TypeError(
              `fetch failed: ${error?.message ?? 'the transport gave no response'}`,
              { cause: error },
            );
          const status = response.status;
          if (sent.redirect === 'error' && REDIRECT_STATUS.includes(status))
            throw new TypeError(
              `fetch failed: ${sent.url} redirects (${status}) and the redirect mode is "error"`,
            );
          const received = new Headers();
          for (const pair of response.headers)
            received.append(pair[0], pair[1]);
          resolve(
            make({
              bytes:
                method === 'HEAD' || NULL_BODY_STATUS.includes(status)
                  ? null
                  : new Uint8Array(response.body),
              status,
              statusText: response.statusText,
              headers: freeze(received),
              url: response.url,
              redirected: response.redirected,
              type: 'basic',
            }),
          );
        } catch (failure) {
          reject(failure);
        }
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  return desktopFetch as unknown as typeof fetch;
}
