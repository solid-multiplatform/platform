/**
 * Browser globals the SolidTV stack reads that `@nativescript/canvas-polyfill`
 * 3.0.0-alpha.10 does not install, or installs in a shape nothing can use,
 * so an app written for the browser boots here unchanged.
 *
 * @remarks
 * Import for its side effect, after the polyfill and before anything that
 * imports the renderer or the router:
 *
 * ```ts
 * import '@nativescript/canvas-polyfill';
 * import '@solidtv/nativescript/shims';
 * ```
 *
 * What it installs:
 *
 * - `location`: a `file:` URL to `index.html` in the app folder, in place
 *   of the polyfill's, whose href is empty and whose protocol has no colon.
 *   The renderer decides at import from `location.protocol` how a relative
 *   URL resolves, so with this every `./assets/...` in an app is a file in
 *   the app folder. Assigning `location.hash` navigates, as in a browser.
 * - `history`: a real stack behind `pushState`, `replaceState` and `go`,
 *   raising `hashchange` and `popstate` on `window` when it moves, so a
 *   `HashRouter` works as in a browser and `history.back()` goes back. The
 *   router reads `history.state` at import, hence the import order above.
 * - `window.dispatchEvent`, delivering to listeners added through
 *   `window.addEventListener`, which the polyfill has but cannot reach.
 * - `document.addEventListener`, `removeEventListener` and `dispatchEvent`
 *   that work: the polyfill's drop every listener, since its document has
 *   no native emitter behind it, and a focus manager bound to `document`
 *   would hear nothing. A `KeyBridge` given `document` as its target feeds
 *   these.
 * - Three fixes to `XMLHttpRequest`. A file-backed request with
 *   `responseType` `json` or `text` decodes its data: the polyfill hands its
 *   decoder the object its file reader returned rather than the bytes in
 *   it, and yields an empty string, while blob responses were always
 *   intact. A request for `file:///app/...`, the virtual app root the
 *   runtime's module URLs and webpack's `import.meta.env.BASE_URL` name,
 *   reads the real app folder. And a request with no response type gets
 *   text, as in a browser: the polyfill otherwise parses a JSON response
 *   into an object, which `fetch`, built on such a request, cannot read.
 * - Two fixes to the HTTP layer behind that `XMLHttpRequest` on iOS and
 *   tvOS. Its requests share one `NSURLSession`: the polyfill makes one per
 *   request and never invalidates it, so every request, every image, paid
 *   its own DNS, TCP and TLS setup, 52 connections for 55 requests on one
 *   page of an app, and 56 sessions outlived a collection. Shared, the same
 *   page ran over two reused HTTP/2 connections. And a request's task leaves
 *   the polyfill's table of every request's task once it completes, where
 *   the polyfill kept each for good.
 * - `console.table`, which SolidTV's focus history prints with in dev
 *   builds and this console lacks.
 *
 * Each piece installs once, and `installShims` takes a host object so the
 * tests can hand it one. `@solidtv/nativescript/shims` is the entry that
 * calls it on the globals.
 */

/** The shape of an event the shims deliver. */
export interface ShimEvent {
  readonly type: string;
  defaultPrevented?: boolean;
}

export type ShimListener = (event: ShimEvent) => void;

/** `window`, `document` or any other object listeners are added to. */
export interface ShimEventTarget {
  addEventListener(
    type: string,
    listener: ShimListener,
    options?: unknown,
  ): void;
  removeEventListener(
    type: string,
    listener: ShimListener,
    options?: unknown,
  ): void;
  dispatchEvent(event: ShimEvent): boolean;
}

/** `window.location` as the shim provides it. */
export interface ShimLocation {
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly origin: string;
  readonly pathname: string;
  readonly href: string;
  search: string;
  hash: string;
  assign(url: string): void;
  replace(url: string): void;
  reload(): void;
  toString(): string;
}

/** `window.history` as the shim provides it. */
export interface ShimHistory {
  readonly length: number;
  readonly state: unknown;
  scrollRestoration: 'auto' | 'manual';
  pushState(state: unknown, unused: string, url?: string | null): void;
  replaceState(state: unknown, unused: string, url?: string | null): void;
  go(delta?: number): void;
  back(): void;
  forward(): void;
}

/** `window`, or the host itself where the polyfill made no separate one. */
export type HostWindow = Partial<ShimEventTarget> & {
  location?: unknown;
  history?: unknown;
};

/** The globals `installShims` reads and writes. */
export interface ShimHost {
  window?: HostWindow;
  self?: { location?: unknown };
  document?: Partial<ShimEventTarget> & { baseURI?: unknown };
  location?: unknown;
  history?: unknown;
  XMLHttpRequest?: { prototype: object };
  NSURLSession?: UrlSessionClass;
  console?: ConsoleLike;
}

/** An `NSURLSessionTask`, as far as the shims touch it. */
export interface UrlSessionTask {
  /** `NSURLSessionTaskState`: 3 once completed. */
  readonly state?: number;
  delegate?: unknown;
}

/** An `NSURLSession`: the one method the polyfill calls on its sessions. */
export interface UrlSession {
  dataTaskWithRequest(request: unknown): UrlSessionTask;
}

/** `NSURLSession`, the class: its two factories. */
export interface UrlSessionClass {
  sessionWithConfiguration(configuration: unknown): UrlSession;
  sessionWithConfigurationDelegateDelegateQueue(
    configuration: unknown,
    delegate: unknown,
    queue: unknown,
  ): unknown;
}

/** The part of `console` the shim touches. */
export interface ConsoleLike {
  table?: unknown;
  log(...args: unknown[]): void;
}

const listenersOf = (
  map: Map<string, ShimListener[]>,
  type: string,
): ShimListener[] => {
  let list = map.get(type);
  if (list === undefined) {
    list = [];
    map.set(type, list);
  }
  return list;
};

const addTo = (
  map: Map<string, ShimListener[]>,
  type: string,
  listener: ShimListener,
): void => {
  const list = listenersOf(map, type);
  if (list.indexOf(listener) === -1) {
    list.push(listener);
  }
};

const removeFrom = (
  map: Map<string, ShimListener[]>,
  type: string,
  listener: ShimListener,
): void => {
  const list = map.get(type);
  if (list === undefined) {
    return;
  }
  const index = list.indexOf(listener);
  if (index !== -1) {
    list.splice(index, 1);
  }
};

const dispatchTo = (
  map: Map<string, ShimListener[]>,
  event: ShimEvent,
): boolean => {
  const list = map.get(event.type);
  if (list !== undefined) {
    // A copy: a listener may remove itself, or another, while this runs.
    const listeners = list.slice();
    for (let i = 0; i < listeners.length; i++) {
      (listeners[i] as ShimListener)(event);
    }
  }
  return event.defaultPrevented !== true;
};

/**
 * Gives `document` listeners that work: own-property methods over a
 * listener map, in place of the polyfill's, which drop every listener.
 * Once per document: a second install would start an empty map and cut off
 * every listener the first one holds, a focus manager's among them. The
 * polyfill's inert methods are there either way, so what tells an installed
 * document is the mark on the method this installs.
 */
export function shimDocumentEvents(document: Partial<ShimEventTarget>): void {
  const current = document.addEventListener as
    | (ShimEventTarget['addEventListener'] & { solidtv?: boolean })
    | undefined;
  if (current !== undefined && current.solidtv === true) {
    return;
  }
  const map = new Map<string, ShimListener[]>();
  const add: ShimEventTarget['addEventListener'] & { solidtv?: boolean } = (
    type,
    listener,
  ) => {
    addTo(map, type, listener);
  };
  add.solidtv = true;
  document.addEventListener = add;
  document.removeEventListener = (type, listener) => {
    removeFrom(map, type, listener);
  };
  document.dispatchEvent = (event) => dispatchTo(map, event);
}

/**
 * Gives `window` a `dispatchEvent` where it has none, delivering to the
 * listeners added through its `addEventListener`, which keeps doing what
 * the polyfill made it do besides.
 */
export function shimWindowEvents(window: Partial<ShimEventTarget>): void {
  if (typeof window.dispatchEvent === 'function') {
    return;
  }
  const map = new Map<string, ShimListener[]>();
  const add = window.addEventListener;
  const remove = window.removeEventListener;
  window.addEventListener = (type, listener, options) => {
    addTo(map, type, listener);
    if (typeof add === 'function') {
      add.call(window, type, listener, options);
    }
  };
  window.removeEventListener = (type, listener, options) => {
    removeFrom(map, type, listener);
    if (typeof remove === 'function') {
      remove.call(window, type, listener, options);
    }
  };
  window.dispatchEvent = (event) => dispatchTo(map, event);
}

/** `#/path` for `/path`, `#path` or `#/path`; the empty string stays. */
const asHash = (value: string): string =>
  value === '' || value.charAt(0) === '#' ? value : '#' + value;

interface HistoryEntry {
  state: unknown;
  search: string;
  hash: string;
}

class Location implements ShimLocation {
  readonly protocol = 'file:';
  readonly host = '';
  readonly hostname = '';
  readonly port = '';
  readonly origin = 'file://';
  readonly pathname: string;
  search = '';
  private currentHash = '';
  /** Set by the history once it exists: a hash assignment navigates. */
  navigate: ((hash: string) => void) | null = null;

  constructor(appPath: string) {
    this.pathname = appPath + '/index.html';
  }

  get href(): string {
    return 'file://' + this.pathname + this.search + this.currentHash;
  }

  get hash(): string {
    return this.currentHash;
  }

  set hash(value: string) {
    const hash = asHash(value);
    if (hash === this.currentHash) {
      return;
    }
    if (this.navigate !== null) {
      this.navigate(hash);
      return;
    }
    this.currentHash = hash;
  }

  /** The history's write: no navigation of its own. */
  set(search: string, hash: string): void {
    this.search = search;
    this.currentHash = hash;
  }

  assign(url: string): void {
    // Only a hash can be followed: the app folder is where the app is.
    const index = url.indexOf('#');
    if (index !== -1) {
      this.hash = url.slice(index);
    }
  }

  replace(url: string): void {
    this.assign(url);
  }

  reload(): void {}

  toString(): string {
    return this.href;
  }
}

class History implements ShimHistory {
  scrollRestoration: 'auto' | 'manual' = 'auto';
  private readonly entries: HistoryEntry[];
  private index = 0;

  constructor(
    private readonly location: Location,
    private readonly window: Pick<ShimEventTarget, 'dispatchEvent'>,
  ) {
    this.entries = [
      { state: null, search: location.search, hash: location.hash },
    ];
    location.navigate = (hash) => {
      // A hash assignment is a push that also raises hashchange.
      const oldURL = location.href;
      this.pushState(null, '', hash);
      this.moved(oldURL);
    };
  }

  get length(): number {
    return this.entries.length;
  }

  get state(): unknown {
    return (this.entries[this.index] as HistoryEntry).state;
  }

  pushState(state: unknown, _unused: string, url?: string | null): void {
    const entry = this.entryFor(state, url);
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    this.index = this.entries.length - 1;
    this.location.set(entry.search, entry.hash);
  }

  replaceState(state: unknown, _unused: string, url?: string | null): void {
    const entry = this.entryFor(state, url);
    this.entries[this.index] = entry;
    this.location.set(entry.search, entry.hash);
  }

  go(delta: number = 0): void {
    const target = this.index + delta;
    if (delta === 0 || target < 0 || target >= this.entries.length) {
      return;
    }
    const oldURL = this.location.href;
    this.index = target;
    const entry = this.entries[target] as HistoryEntry;
    this.location.set(entry.search, entry.hash);
    this.moved(oldURL);
  }

  back(): void {
    this.go(-1);
  }

  forward(): void {
    this.go(1);
  }

  /** The current search and hash with `url` applied over them. */
  private entryFor(state: unknown, url?: string | null): HistoryEntry {
    const current = this.entries[this.index] as HistoryEntry;
    if (url === undefined || url === null || url === '') {
      return { state, search: current.search, hash: current.hash };
    }
    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
    const searchIndex = beforeHash.indexOf('?');
    // A url with only a hash keeps the search; anything else replaces it.
    const search =
      hashIndex === 0
        ? current.search
        : searchIndex === -1
          ? ''
          : beforeHash.slice(searchIndex);
    return { state, search, hash };
  }

  private moved(oldURL: string): void {
    const newURL = this.location.href;
    this.window.dispatchEvent({
      type: 'popstate',
      state: this.state,
    } as ShimEvent);
    this.window.dispatchEvent({
      type: 'hashchange',
      oldURL,
      newURL,
    } as ShimEvent);
  }
}

/**
 * Installs `location` and `history` on the host, over the polyfill's
 * location. `appPath` is the app folder, `document.baseURI` on the
 * polyfill; `window` must be able to dispatch events already.
 */
export function shimLocation(host: ShimHost, appPath: string): void {
  const window: HostWindow =
    host.window === undefined ? (host as HostWindow) : host.window;
  const location = new Location(appPath);
  const history = new History(location, window as ShimEventTarget);
  host.location = location;
  window.location = location;
  if (host.self !== undefined && (host.self as unknown) !== window) {
    host.self.location = location;
  }
  host.history = history;
  window.history = history;
}

/** What the polyfill's HTTP layer resolves a request with. */
interface HttpResult {
  content?: unknown;
  responseText?: unknown;
}

/** A request as the HTTP layer returns it: `abort()` calls its `cancel`. */
type HttpRequest = Promise<HttpResult> & { cancel?: () => void };

/** The polyfill's HTTP client, one per request object. */
interface PolyfillHttp {
  request?: ((options: unknown) => HttpRequest) & {
    solidtv?: boolean;
  };
}

/** What the polyfill's XMLHttpRequest keeps that the fixes touch. */
interface PolyfillXhr {
  _toJSString?: ((data: unknown) => string) & { solidtv?: boolean };
  _didUserSetResponseType?: boolean;
  _responseType?: string | null;
  _http?: PolyfillHttp;
  open?: ((method: string, url: string, ...rest: unknown[]) => void) & {
    solidtv?: boolean;
  };
  send?: ((body?: unknown) => void) & { solidtv?: boolean };
}

/**
 * The HTTP layer parses a JSON body into an object before the request
 * object types the response, and a request typed `blob`, a `fetch` say,
 * then gets the bytes of that object's `toString`: put the text back, and
 * every response type builds from it.
 */
const withTextContent = (result: HttpResult): HttpResult => {
  const content = result.content;
  if (
    content === null ||
    typeof content !== 'object' ||
    typeof result.responseText !== 'string'
  ) {
    return result;
  }
  const proto: unknown = Object.getPrototypeOf(content);
  if (proto === Object.prototype || proto === null || Array.isArray(content)) {
    result.content = result.responseText;
  }
  return result;
};

/** `NSURLSessionTaskStateCompleted`. */
const TASK_COMPLETED = 3;

/**
 * Removes the completed tasks from the polyfill's table of every request's
 * task by id, `Http._tasks`, which it adds to and never removes from. A
 * task still running stays: cancelling its request looks it up there.
 */
const dropCompletedTasks = (tasks: unknown): void => {
  if (!(tasks instanceof Map)) {
    return;
  }
  tasks.forEach((task: UrlSessionTask | null | undefined, id: unknown) => {
    if (task !== null && task !== undefined && task.state === TASK_COMPLETED) {
      tasks.delete(id);
    }
  });
};

/**
 * Wraps the HTTP client's `request`, on its class's prototype, once: the
 * result gets its JSON text back, and as the request settles, either way,
 * the completed tasks leave the class's `_tasks`. The polyfill settles a
 * request from its task's completion, so the task goes then or, should its
 * state lag, as the next request settles. The request's `cancel` carries
 * over to the returned promise, where the request object's `abort()` calls
 * it.
 */
const shimHttp = (http: PolyfillHttp | undefined): void => {
  if (http === undefined || http === null) {
    return;
  }
  const proto = Object.getPrototypeOf(http) as PolyfillHttp | null;
  const target =
    proto !== null && typeof proto.request === 'function' ? proto : http;
  const request = target.request;
  if (typeof request !== 'function' || request.solidtv === true) {
    return;
  }
  const patched = function (this: unknown, options: unknown): HttpRequest {
    const pending = request.call(this, options);
    const tasks = (this as { constructor?: { _tasks?: unknown } }).constructor
      ?._tasks;
    const settled: HttpRequest = pending
      .finally(() => {
        dropCompletedTasks(tasks);
      })
      .then(withTextContent);
    if (typeof pending.cancel === 'function') {
      settled.cancel = pending.cancel;
    }
    return settled;
  };
  patched.solidtv = true;
  target.request = patched;
};

/** The virtual root the runtime gives the app folder in module URLs. */
export const APP_ROOT_URL = 'file:///app/';

/** The bytes inside a file reader's result object; anything else as is. */
const unwrapFileData = (data: unknown): unknown => {
  if (
    data === null ||
    typeof data !== 'object' ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data)
  ) {
    return data;
  }
  const buffer = (data as { buffer?: unknown }).buffer;
  return buffer === undefined ? data : buffer;
};

/**
 * Fixes the polyfill's `XMLHttpRequest` on its prototype, each once: a
 * file-backed `json` or `text` response decodes, since the decoder gets the
 * bytes rather than the reader's result object around them; a request for
 * {@link APP_ROOT_URL} reads the real app folder, `appPath`, when one is
 * given; a request whose response type was never set gets `text` rather
 * than whatever the content type suggests; a JSON response keeps its text
 * through the HTTP layer, so a request typed `blob`, which is what `fetch`
 * sends, gets the body's bytes rather than `[object Object]`; and a request's
 * task leaves the HTTP layer's table of them once it completes.
 */
export function shimXhr(
  xhr: { prototype: object } | undefined,
  appPath: string,
): void {
  if (xhr === undefined) {
    return;
  }
  const proto = xhr.prototype as PolyfillXhr;
  const decode = proto._toJSString;
  if (typeof decode === 'function' && decode.solidtv !== true) {
    const patched = function (this: unknown, data: unknown): string {
      return decode.call(this, unwrapFileData(data));
    };
    patched.solidtv = true;
    proto._toJSString = patched;
  }
  const open = proto.open;
  if (typeof open === 'function' && open.solidtv !== true && appPath !== '') {
    const root = 'file://' + appPath + '/';
    const patched = function (
      this: unknown,
      method: string,
      url: string,
      ...rest: unknown[]
    ): void {
      const target =
        typeof url === 'string' && url.startsWith(APP_ROOT_URL)
          ? root + url.slice(APP_ROOT_URL.length)
          : url;
      open.call(this, method, target, ...rest);
    };
    patched.solidtv = true;
    proto.open = patched;
  }
  const send = proto.send;
  if (typeof send === 'function' && send.solidtv !== true) {
    const patched = function (this: PolyfillXhr, body?: unknown): void {
      if (this._didUserSetResponseType !== true) {
        this._responseType = 'text';
        this._didUserSetResponseType = true;
      }
      shimHttp(this._http);
      send.call(this, body);
    };
    patched.solidtv = true;
    proto.send = patched;
  }
}

/**
 * The static the polyfill gives the delegate class it makes a session with
 * for every request, and so the mark of one of its delegates.
 */
const POLYFILL_DELEGATE_FACTORY =
  'initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener';

const isPolyfillDelegate = (delegate: unknown): boolean => {
  if (delegate === null || delegate === undefined) {
    return false;
  }
  const type = (delegate as { constructor?: Record<string, unknown> })
    .constructor;
  return (
    type !== null &&
    type !== undefined &&
    typeof type[POLYFILL_DELEGATE_FACTORY] === 'function'
  );
};

/**
 * Puts the polyfill's HTTP requests on one `NSURLSession`. The polyfill
 * makes a session per request, with the request's delegate as the
 * session's, and never invalidates one, so each request opened a connection
 * of its own and every session stayed alive. A call to the factory with
 * one of its delegates gets a stand-in instead, whose one method, the only
 * one the polyfill calls, makes the task on the shared session and gives it
 * that delegate as its own, which iOS and tvOS 15 honour: the delegate
 * hears everything it did, and the tasks share the session's connections.
 * Every other caller, a WebSocket or core's `Http` say, gets a session of
 * its own from the factory as before.
 *
 * The shared session is made on the first such call, from the
 * configuration it passes, the one the polyfill passes for every request:
 * so it is the session the polyfill would have made, less the delegate,
 * and a host that never requests makes none. A no-op without
 * `NSURLSession`, on Android and in tests; once per class.
 */
export function shimUrlSession(sessions: UrlSessionClass | undefined): void {
  if (sessions === undefined || sessions === null) {
    return;
  }
  const create = sessions.sessionWithConfigurationDelegateDelegateQueue as
    | (UrlSessionClass['sessionWithConfigurationDelegateDelegateQueue'] & {
        solidtv?: boolean;
      })
    | undefined;
  if (
    typeof create !== 'function' ||
    create.solidtv === true ||
    typeof sessions.sessionWithConfiguration !== 'function'
  ) {
    return;
  }
  let shared: UrlSession | null = null;
  const patched = function (
    configuration: unknown,
    delegate: unknown,
    queue: unknown,
  ): unknown {
    if (!isPolyfillDelegate(delegate)) {
      return create.call(sessions, configuration, delegate, queue);
    }
    if (shared === null) {
      shared = sessions.sessionWithConfiguration(configuration);
    }
    const session = shared;
    return {
      dataTaskWithRequest(request: unknown): UrlSessionTask {
        const task = session.dataTaskWithRequest(request);
        task.delegate = delegate;
        return task;
      },
    };
  };
  patched.solidtv = true;
  sessions.sessionWithConfigurationDelegateDelegateQueue = patched;
}

/**
 * Gives a console without `table` one that logs a line per row, with the
 * row's plain values; a row's objects, an element say, are left out.
 */
export function shimConsole(console: ConsoleLike): void {
  if (typeof console.table === 'function') {
    return;
  }
  console.table = (data: unknown): void => {
    if (!Array.isArray(data)) {
      console.log(data);
      return;
    }
    for (let i = 0; i < data.length; i++) {
      const row: unknown = data[i];
      if (row === null || typeof row !== 'object') {
        console.log(row);
        continue;
      }
      const keys = Object.keys(row);
      let line = '';
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k] as string;
        const value = (row as Record<string, unknown>)[key];
        if (
          value !== null &&
          (typeof value === 'object' || typeof value === 'function')
        ) {
          continue;
        }
        line += (line === '' ? '' : ' ') + key + '=' + String(value);
      }
      console.log(line);
    }
  };
}

/** Installs every shim on `host`, `globalThis` by default, once. */
export function installShims(
  host: ShimHost = globalThis as unknown as ShimHost,
): void {
  const window: HostWindow =
    host.window === undefined ? (host as HostWindow) : host.window;
  shimWindowEvents(window);
  if (host.document !== undefined) {
    shimDocumentEvents(host.document);
  }
  const baseURI =
    host.document === undefined ? undefined : host.document.baseURI;
  const appPath = typeof baseURI === 'string' ? baseURI : '';
  const location = window.location as { protocol?: unknown } | undefined;
  if (location === undefined || location.protocol !== 'file:') {
    shimLocation(host, appPath);
  }
  shimXhr(host.XMLHttpRequest, appPath);
  shimUrlSession(host.NSURLSession);
  shimConsole(host.console === undefined ? console : host.console);
}
