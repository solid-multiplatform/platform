// What the native runtime (packages/host-desktop/native) puts on the global
// object. Only this package reads it: apps use the platform's APIs.

/** A decoded image: 8-bit RGBA pixels, row by row from the top. */
interface SolidDecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Frees the pixels now rather than at the next collection. */
  close(): void;
}

interface SolidWindowSize {
  /** Layout units: what the scene is laid out in. */
  width: number;
  height: number;
  /** The drawing buffer, in pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** Pixels per layout unit: the display's scale. */
  scale: number;
}

/** One event of a turn's batch; which fields it has depends on `type`. */
interface SolidInputEvent {
  readonly type:
    | 'keydown'
    | 'keyup'
    | 'textinput'
    | 'textediting'
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'pointercancel'
    | 'pointerleave'
    | 'wheel'
    | 'resize'
    | 'expose'
    | 'focus'
    | 'blur'
    | 'windowstate'
    | 'close'
    | 'theme'
    | 'locale'
    | 'dropfile'
    | 'droptext';
  // Keys.
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  // Text: committed, composed (with the marked range) or dropped.
  readonly text: string;
  readonly start: number;
  readonly length: number;
  readonly path: string;
  // Pointers and the wheel, in layout units.
  readonly pointerId: number;
  readonly pointerType: 'mouse' | 'touch' | 'pen';
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly pressure: number;
  readonly deltaX: number;
  readonly deltaY: number;
}

interface SolidFileEntry {
  name: string;
  size: number;
  modified?: number;
  directory: boolean;
}

type SolidDone<T> = (error: Error | null, result?: T) => void;

interface SolidNative {
  /** The directory of the running script: relative asset paths start here. */
  readonly appDir: string;
  /**
   * What the app was started with, after the runtime's own options: a URL
   * of the app's scheme when the system opened it for one.
   */
  readonly args: readonly string[];
  /** The window's WebGL-shaped context; absent in a run without a window. */
  readonly gl?: WebGLRenderingContext;
  readonly window?: {
    size(): SolidWindowSize;
    /** In layout units. */
    setSize(width: number, height: number): void;
    setTitle(title: string): void;
    state(): {
      focused: boolean;
      minimized: boolean;
      occluded: boolean;
      hidden: boolean;
    };
    hasTouch(): boolean;
    theme(): 'light' | 'dark' | 'unknown';
    /** Returns whether the system took the request. */
    allowScreenSaver(allow: boolean): boolean;
    screenSaverAllowed(): boolean;
  };
  /** Present with a window. */
  readonly input?: {
    /**
     * `listener(events, count)` once per turn of the loop in which something
     * happened: the first `count` entries of `events`, which is reused.
     */
    listen(
      listener: ((events: SolidInputEvent[], count: number) => void) | null,
    ): void;
  };
  readonly text?: {
    start(purpose: string, multiline: boolean): void;
    stop(): void;
    active(): boolean;
    /** The edited text's place and the caret's offset in it, layout units. */
    area(
      x: number,
      y: number,
      width: number,
      height: number,
      caret: number,
    ): void;
    /** Where each user-perceived character starts, then the length. */
    graphemes(text: string): number[];
  };
  readonly clipboard?: {
    read(): string;
    write(text: string): void;
  };
  readonly dialog?: {
    open(
      filters: string[],
      multiple: boolean,
      done: SolidDone<{ path: string; size: number }[]>,
    ): void;
    save(
      name: string,
      filters: string[],
      data: string | ArrayBuffer | ArrayBufferView,
      done: SolidDone<string | null>,
    ): void;
  };
  readonly system: {
    info(): {
      os: 'linux' | 'windows' | 'macos';
      arch: string;
      osVersion?: string;
      model?: string;
      memoryMb: number;
    };
    power(): {
      state: 'battery' | 'charging' | 'charged' | 'none' | 'unknown';
      percent?: number;
      seconds?: number;
    };
    locales(): string[];
    openURL(url: string): void;
  };
  readonly fs: {
    dirs(id: string): { data?: string; cache?: string; documents?: string };
    read(path: string, asText: false, done: SolidDone<ArrayBuffer>): void;
    read(path: string, asText: true, done: SolidDone<string>): void;
    write(
      path: string,
      data: string | ArrayBuffer | ArrayBufferView,
      done: SolidDone<void>,
    ): void;
    stat(path: string, done: SolidDone<SolidFileEntry | null>): void;
    list(path: string, done: SolidDone<SolidFileEntry[]>): void;
    remove(path: string, done: SolidDone<void>): void;
  };
  readonly store: {
    load(id: string, done: SolidDone<string | null>): void;
    save(id: string, text: string, done: SolidDone<void>): void;
  };
  readonly http: {
    send(
      method: string,
      url: string,
      headers: string[],
      body: Uint8Array | undefined,
      follow: boolean,
      done: (
        error: Error | null,
        status?: number,
        statusText?: string,
        url?: string,
        redirected?: boolean,
        headers?: string[],
        body?: ArrayBuffer,
      ) => void,
    ): number;
    abort(id: number): void;
  };
  /**
   * The scene's semantics for assistive technology (native/src/a11y.rs);
   * absent without a window and in a runtime built without it.
   */
  readonly a11y?: {
    /** Absent strings are `null`, absent numbers `NaN`; `parent` 0 is the window. */
    set(
      id: number,
      parent: number,
      role: string,
      label: string,
      description: string | null,
      value: string | null,
      x: number,
      y: number,
      width: number,
      height: number,
      flags: number,
      level: number,
      min: number,
      max: number,
      now: number,
    ): void;
    remove(id: number): void;
    /** Ends a batch; `focus` 0 is the window itself. */
    commit(focus: number, scale: number): void;
    listen(callback: (action: 'focus' | 'click', id: number) => void): void;
    /** Whether assistive technology has asked for the tree. */
    active(): boolean;
  };
  /** Made-up input, when SOLID_DESKTOP_TEST is set: see native/src/testing.rs. */
  readonly test?: {
    key(
      down: boolean,
      scancode: number,
      keycode: number,
      modifiers?: number,
      repeat?: boolean,
    ): void;
    text(text: string, start?: number, length?: number): void;
    mouse(
      kind: 'move' | 'down' | 'up' | 'wheel',
      x: number,
      y: number,
      button?: number,
      a?: number,
      b?: number,
    ): void;
    finger(
      kind: 'down' | 'move' | 'up' | 'cancel',
      id: number,
      x: number,
      y: number,
    ): void;
    window(kind: string): void;
    drop(kind: 'file' | 'text', data: string, x: number, y: number): void;
    setScale(scale: number): void;
  };
  readFile(
    path: string,
    done: (error: Error | null, data?: ArrayBuffer) => void,
  ): void;
  readText(
    path: string,
    done: (error: Error | null, text?: string) => void,
  ): void;
  decodeImage(
    encoded: ArrayBuffer | ArrayBufferView,
    x: number | undefined,
    y: number | undefined,
    width: number | undefined,
    height: number | undefined,
    premultiply: boolean,
    done: (error: Error | null, image?: SolidDecodedImage) => void,
  ): void;
  exit(code: number): void;
  stats(): { wakeups: number; frames: number; presents: number };
  write(stream: 1 | 2, text: string): void;
}

declare const __solid: SolidNative;
