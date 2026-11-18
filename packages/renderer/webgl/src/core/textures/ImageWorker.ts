import { REQUEST_TIMEOUT, type Platform } from '../../platform/Platform.js';
import type { CreateImageBitmapSupport } from './probes.js';

/** What a decode produced: the bitmap, and whether WebGL must premultiply it. */
export interface DecodedImage {
  data: ImageBitmap;
  premultiplyAlpha: boolean;
}

type Settle = [(value: DecodedImage) => void, (reason: Error) => void];

/**
 * Decode an image blob with createImageBitmap: the one copy of that logic,
 * for the image worker and for main-thread decoding alike (ported from
 * 1.10). `premultiplyAlpha` in the result means "WebGL premultiplies this
 * on upload": where the device ignores the premultiply option
 * (`premultiplyHonored` false) a straight bitmap is asked for instead.
 *
 * ES5 only (CLAUDE.md: worker source is stringified ES5): the worker gets
 * this function as source text, so it may not reference anything outside
 * itself, and no build may inject helpers into it (see createImageWorker
 * for the function rule that follows). `create` is called with
 * `createThis` as its receiver, so the main thread can pass
 * `platform.createImageBitmap` without binding it.
 */
export function decodeImageBlob(
  create: (...args: unknown[]) => Promise<ImageBitmap>,
  createThis: unknown,
  blob: Blob | HTMLCanvasElement,
  premultiplyAlpha: boolean | null,
  sx: number | null,
  sy: number | null,
  sw: number | null,
  sh: number | null,
  supportsOptions: boolean,
  supportsFull: boolean,
  premultiplyHonored: boolean | null,
  timeoutMs?: number,
): Promise<DecodedImage> {
  var withAlphaChannel =
    premultiplyAlpha !== undefined && premultiplyAlpha !== null
      ? premultiplyAlpha
      : typeof (blob as Blob).type === 'string' &&
        (blob as Blob).type.indexOf('image/png') !== -1;
  var useGlPremultiply =
    withAlphaChannel === true && premultiplyHonored === false;
  var options = {
    premultiplyAlpha:
      withAlphaChannel === true && useGlPremultiply === false
        ? 'premultiply'
        : 'none',
    colorSpaceConversion: 'none',
    imageOrientation: 'none',
  };
  return new Promise<DecodedImage>(function (resolve, reject) {
    var finished = false;
    // The serialized worker needs a self-contained decode deadline.
    var timer = setTimeout(
      function () {
        finished = true;
        var error = new Error('Image bitmap decoding timed out');
        error.name = 'ImageBitmapTimeoutError';
        reject(error);
      },
      timeoutMs === undefined ? 2000 : timeoutMs,
    );
    var pending: Promise<ImageBitmap>;
    try {
      if (supportsFull === true && sw !== null && sh !== null) {
        pending = create.call(
          createThis,
          blob,
          sx === null ? 0 : sx,
          sy === null ? 0 : sy,
          sw,
          sh,
          options,
        );
      } else if (supportsOptions === false && supportsFull === false) {
        // Chrome 50 to 52: no options. The browser default premultiplies, so
        // WebGL must not premultiply again, except where the default returns
        // straight alpha (premultiplyHonored false).
        pending = create.call(createThis, blob);
      } else {
        pending = create.call(createThis, blob, options);
      }
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    pending.then(
      function (data) {
        if (finished === true) {
          try {
            if (typeof data.close === 'function') data.close();
          } catch (_error) {}
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve({ data: data, premultiplyAlpha: useGlPremultiply });
      },
      function (error) {
        if (finished === true) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The worker's script, run as `(createImageWorker)(decodeImageBlob)`: XHR
 * the image, decode it with the shared decoder, post the bitmap back
 * (transferred). Capability flags and the request timeout arrive once, in
 * an init message, as data: a minifier renames locals, so nothing may be
 * patched into this source. ES5 only, like decodeImageBlob.
 *
 * No function inside this one or decodeImageBlob has a name, nor is one
 * assigned to a plain variable (a property is fine): a bundler that keeps
 * function names (esbuild `keepNames`, which an app may turn on) wraps each
 * such function in a call to its `__name` helper, which does not exist in
 * the worker, so every request would fail and every image fall back to the
 * main thread.
 */
function createImageWorker(decode: typeof decodeImageBlob): void {
  var supportsOptions = false;
  var supportsFull = false;
  var premultiplyHonored: boolean | null = false;
  var timeout = 0;
  var scope = self as unknown as {
    onmessage: (event: { data: Record<string, unknown> }) => void;
    postMessage: (message: unknown, transfer?: unknown[]) => void;
  };

  scope.onmessage = function (event) {
    var request = event.data;
    if (request.init === true) {
      supportsOptions = request.supportsOptions as boolean;
      supportsFull = request.supportsFull as boolean;
      premultiplyHonored = request.premultiplyHonored as boolean | null;
      timeout = request.timeout as number;
      return;
    }
    var id = request.id;
    var src = request.src as string;
    // A request that throws (xhr.open on a URL it cannot parse) fails alone:
    // uncaught, the error would take the worker down for every image.
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'blob';
      // One that stalls fails rather than hold a loader slot for good.
      xhr.timeout = timeout;
      xhr.onload = function () {
        // WebOS and Tizen report 0 for a file:// load.
        if (xhr.status !== 200 && xhr.status !== 0) {
          scope.postMessage({
            id: id,
            error:
              'Image loading failed. HTTP status code: ' +
              xhr.status +
              '. URL: ' +
              src,
          });
          return;
        }
        decode(
          createImageBitmap as (...args: unknown[]) => Promise<ImageBitmap>,
          undefined,
          xhr.response as Blob,
          request.premultiplyAlpha as boolean | null,
          request.sx as number | null,
          request.sy as number | null,
          request.sw as number | null,
          request.sh as number | null,
          supportsOptions,
          supportsFull,
          premultiplyHonored,
        ).then(
          function (result) {
            scope.postMessage({ id: id, data: result }, [result.data]);
          },
          function (error: Error) {
            scope.postMessage({
              id: id,
              error: error.message,
              errorName: error.name,
            });
          },
        );
      };
      xhr.onerror = function () {
        scope.postMessage({
          id: id,
          error: 'Network error occurred while trying to fetch the image.',
        });
      };
      xhr.ontimeout = function () {
        scope.postMessage({
          id: id,
          error:
            'Image loading timed out after ' + timeout + ' ms. URL: ' + src,
        });
      };
      xhr.send();
    } catch (e) {
      scope.postMessage({
        id: id,
        error: String(e instanceof Error ? e.message : e),
      });
    }
  };
}

/** The worker's source text. */
export function imageWorkerSource(): string {
  return `(${createImageWorker.toString()})(${decodeImageBlob.toString()})`.replace(
    '"use strict";',
    '',
  );
}

/**
 * Exactly one image worker (spec 9.3; measured: one beats a pool on a
 * 4-core TV, which competes with the main thread), spawned through
 * `platform.createWorker`. One request per message, sent at once: batching
 * them was measured to buy nothing.
 */
export class ImageWorkerManager {
  /**
   * The worker runs; false sends every image to the main thread (it could
   * not be started, or it crashed), or nowhere after destroy().
   */
  available: boolean;
  /**
   * The worker crashed: the requests it had in flight load on the main
   * thread instead (sources.ts). Not after destroy(), which ends them.
   */
  crashed = false;
  /** Called when a crash makes the worker unavailable (the Loader). */
  onUnavailable: (() => void) | null = null;
  private worker: Worker | null;
  private readonly pending = new Map<number, Settle>();
  private nextId = 0;

  constructor(platform: Platform, support: CreateImageBitmapSupport) {
    const worker = platform.createWorker(imageWorkerSource());
    this.worker = worker;
    this.available = worker !== null;
    if (worker === null) {
      return;
    }
    worker.onmessage = (event: MessageEvent) => {
      this.reply(event.data as Record<string, unknown>);
    };
    const crash = (event: unknown): void => {
      this.crash(event);
    };
    worker.onerror = crash;
    worker.onmessageerror = crash;
    // Constant for the worker's lifetime, and delivered before any request:
    // messages to a worker arrive in order.
    worker.postMessage({
      init: true,
      supportsOptions: support.options,
      supportsFull: support.full,
      premultiplyHonored: support.premultiplyHonored,
      timeout: REQUEST_TIMEOUT,
    });
  }

  /** Fetch and decode `src` in the worker, cropped when sw and sh are set. */
  getImage(
    src: string,
    premultiplyAlpha: boolean | null,
    sx: number | null,
    sy: number | null,
    sw: number | null,
    sh: number | null,
  ): Promise<DecodedImage> {
    const worker = this.worker;
    if (worker === null) {
      return Promise.reject(new Error('No image worker available'));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, [resolve, reject]);
      worker.postMessage({ id, src, premultiplyAlpha, sx, sy, sw, sh });
    });
  }

  /** Requests the worker has not answered yet. */
  get inFlight(): number {
    return this.pending.size;
  }

  /**
   * Renderer.destroy: stop the worker for good. The requests in flight are
   * rejected and later ones refused, so none hangs; it is no crash (no
   * onUnavailable, nothing loads on the main thread instead).
   */
  destroy(): void {
    const worker = this.worker;
    this.worker = null;
    this.available = false;
    if (worker !== null) {
      worker.terminate();
    }
    this.rejectAll('Image worker destroyed');
  }

  private reply(message: Record<string, unknown>): void {
    const id = message.id as number;
    const settle = this.pending.get(id);
    if (settle === undefined) {
      return;
    }
    this.pending.delete(id);
    const error = message.error as string | undefined;
    if (error !== undefined) {
      const failure = new Error(error);
      if (typeof message.errorName === 'string')
        failure.name = message.errorName;
      settle[1](failure);
    } else {
      settle[0](message.data as DecodedImage);
    }
  }

  /**
   * A crash cannot be tied to one request: fail them all rather than hang
   * them. The worker may be dead (some browsers report a worker script that
   * may not run, under a CSP, as an error event rather than a throw), so it
   * is stopped and later images decode on the main thread.
   */
  private crash(event: unknown): void {
    const text = (event as { message?: unknown } | null)?.message;
    this.rejectAll(
      typeof text === 'string' && text !== ''
        ? text
        : 'Image worker encountered an unrecoverable error',
    );
    const worker = this.worker;
    if (worker === null) {
      return;
    }
    this.worker = null;
    this.available = false;
    this.crashed = true;
    worker.terminate();
    if (this.onUnavailable !== null) {
      this.onUnavailable();
    }
  }

  /** Fail every request in flight with `message`. */
  private rejectAll(message: string): void {
    const pending = this.pending;
    pending.forEach(settle => {
      settle[1](new Error(message));
    });
    pending.clear();
  }
}
