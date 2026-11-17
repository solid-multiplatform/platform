import type { RendererSettings } from '../settings.js';

/**
 * What `Platform.fetch` resolves with: a Blob, an ArrayBuffer, or parsed
 * JSON (an SDF font's atlas description; an engine without
 * `responseType = 'json'` may resolve the text instead, which the font
 * loader parses).
 */
export type FetchResponseType = 'blob' | 'arraybuffer' | 'json';

/**
 * ms an image request may take, its whole transfer included, before it
 * fails (into the retries): the web platform's fetch, the image worker's
 * XHR and the `<img>` paths. A stalled request would otherwise hold one of
 * the loader's in-flight slots for good (spec 14, item 43).
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * What a host overrides to run the renderer outside a browser (spec 12.3,
 * for example NativeScript on Apple TV); loop policy lives in core. Phase 2
 * defined the loop and canvas members and phase 3 the image members (decode,
 * fetch, the image worker). SDF fonts need nothing more: their atlas
 * description comes through `fetch` and their atlas through the image path.
 */
export abstract class Platform {
  /**
   * Adjust the app's settings before any default applies: a host that
   * cannot honour a setting returns a copy with it replaced. Unchanged by
   * default.
   */
  resolveSettings(
    settings: Partial<RendererSettings>,
  ): Partial<RendererSettings> {
    return settings;
  }

  abstract createCanvas(): HTMLCanvasElement;

  abstract getElementById(id: string): HTMLElement | null;

  /**
   * Size the canvas once: `width` x `height` is the backing store in device
   * pixels, `logicalWidth` x `logicalHeight` the presented size in the
   * host's layout units (CSS pixels on the web).
   */
  abstract sizeCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    logicalWidth: number,
    logicalHeight: number,
  ): void;

  /**
   * Schedule `callback` for the next frame; the return value is the handle
   * `cancelAnimationFrame` takes. The callback receives the frame's
   * timestamp in ms on `now()`'s clock; a host that cannot provide one may
   * pass 0, and the loop then reads `now()` for that frame instead.
   */
  abstract requestAnimationFrame(callback: (time: number) => void): number;

  abstract cancelAnimationFrame(handle: number): void;

  abstract setTimeout(callback: () => void, ms: number): void;

  /**
   * The page is hidden, so its animation frames are paused on purpose: the
   * loop then arms no wake fallback. Shown by default.
   */
  hidden(): boolean {
    return false;
  }

  /**
   * Put the last frame drawn into `canvas` on screen, for an engine that
   * shows a WebGL frame drawn outside its refresh cycle (an animation
   * frame that wakes the loop from idle, on Xumo's WPE WebKit 601) only
   * once something makes it repaint. Called once per idle period, after
   * the frame that went idle, with `presentOnIdle` on. Does nothing by
   * default.
   */
  present(_canvas: HTMLCanvasElement): void {}

  /**
   * Monotonic ms on the animation frames' clock. Read for adaptiveDuration,
   * texture grace periods and the idle upload budget, never per node: the
   * loop runs on the frame timestamps.
   */
  abstract now(): number;

  /**
   * `createImageBitmap(source, options)`, or with a number second argument
   * `createImageBitmap(source, sx, sy, sw, sh, options)`. Rejects where the
   * host has none (Chrome 38 to 49): the startup probe then picks the
   * `<img>` path.
   */
  abstract createImageBitmap(
    source: ImageBitmapSource,
    sxOrOptions?: number | ImageBitmapOptions,
    sy?: number,
    sw?: number,
    sh?: number,
    options?: ImageBitmapOptions,
  ): Promise<ImageBitmap>;

  /** A new image element, for the `<img>` decode path and SVG rasterizing. */
  abstract createImage(): HTMLImageElement;

  /**
   * GET `url` (XMLHttpRequest on the web). Resolves with the response on
   * any 2xx, and on status 0 with a response (a `file://` load on WebOS and
   * Tizen); rejects on anything else, and when the request, transfer
   * included, has not completed within REQUEST_TIMEOUT ms (a stalled
   * request would hold a loader slot).
   */
  abstract fetch(
    url: string,
    responseType: FetchResponseType,
  ): Promise<unknown>;

  /**
   * Start a worker running the script `source`, or return null where the
   * host cannot (no Worker, or a CSP that forbids `blob:` workers): images
   * then decode on the main thread.
   */
  abstract createWorker(source: string): Worker | null;
}

export type PlatformConstructor = new () => Platform;

let defaultPlatform: PlatformConstructor | null = null;

/**
 * Register the platform a renderer uses when its settings name none (a host
 * that boots an app written for the browser); null restores the web
 * platform. A `platform` setting still wins.
 */
export const setDefaultPlatform = (
  platform: PlatformConstructor | null,
): void => {
  defaultPlatform = platform;
};

export const getDefaultPlatform = (): PlatformConstructor | null =>
  defaultPlatform;
