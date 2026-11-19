// The renderer's platform adapter over the native runtime: the window's GL
// surface, frames and timers, and local files and images.
import {
  Platform,
  type FetchResponseType,
} from '@solid-multiplatform/renderer/platform';
import type { RendererMainSettings } from '@solid-multiplatform/renderer';
import { mediaType, readFile, readText } from './assets.js';
import { DesktopBlob, blobBytes } from './globals.js';

type Settings = Partial<RendererMainSettings>;

/** The window, as its size was last reported. */
export interface WindowMetrics {
  /** Layout units. */
  width: number;
  height: number;
  /** Drawing-buffer pixels per layout unit. */
  scale: number;
}

export function windowMetrics(): WindowMetrics {
  const window = __solid.window;
  if (window === undefined) {
    throw new Error('The desktop host needs a window: run without --headless');
  }
  const size = window.size();
  return {
    width: size.width,
    height: size.height,
    scale: size.pixelWidth / size.width,
  };
}

let width = 0;
let height = 0;

/**
 * What the renderer takes for its canvas: the window's drawing buffer. There
 * is one, it is sized through `sizeCanvas` only, and its context is never
 * lost, so the loss listener the renderer registers is never called.
 */
const surface = {
  get width(): number {
    return width;
  },
  get height(): number {
    return height;
  },
  getContext(kind: string): unknown {
    if (kind === '2d') return null;
    const gl = __solid.gl;
    if (gl === undefined) {
      throw new Error(
        'The desktop host needs a window: run without --headless',
      );
    }
    return gl;
  },
  addEventListener(type: string): void {
    if (type !== 'webglcontextlost') {
      throw new Error(`The desktop surface has no "${type}" event`);
    }
  },
  removeEventListener(): void {},
};

/** Where the renderer "appends" its canvas: the surface is the window's already. */
const container = { appendChild(): void {}, removeChild(): void {} };

function reportLoopError(error: unknown): void {
  console.error('Uncaught in a frame:', error);
}

function decode(
  source: unknown,
  x: number | undefined,
  y: number | undefined,
  w: number | undefined,
  h: number | undefined,
  options: ImageBitmapOptions | undefined,
): Promise<SolidDecodedImage> {
  return new Promise((resolve, reject) => {
    const bytes = blobBytes(source);
    if (bytes === undefined) {
      throw new TypeError(
        'createImageBitmap: only a Blob source is implemented by the desktop host',
      );
    }
    if (
      options !== undefined &&
      (options.imageOrientation === 'flipY' ||
        options.resizeWidth !== undefined ||
        options.resizeHeight !== undefined)
    ) {
      throw new TypeError(
        'createImageBitmap: imageOrientation and resizing are not implemented by the desktop host',
      );
    }
    // As in a browser, an image is premultiplied unless asked otherwise.
    const premultiply = options?.premultiplyAlpha !== 'none';
    __solid.decodeImage(bytes, x, y, w, h, premultiply, (error, image) => {
      if (error !== null) reject(error);
      else resolve(image!);
    });
  });
}

const STRAIGHT: ImageBitmapOptions = { premultiplyAlpha: 'none' };

/**
 * The `<img>` the renderer falls back to when a decode fails: an object
 * that loads its `src` and then is an image source itself, with straight
 * alpha as an `<img>` has.
 */
class DesktopImage {
  width = 0;
  height = 0;
  data: Uint8Array | null = null;
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = '';

  get src(): string {
    return this.source;
  }

  set src(url: string) {
    this.source = url;
    if (url === '') return;
    new Promise<ArrayBuffer>((resolve) => resolve(readFile(url)))
      .then((file) =>
        decode(
          new DesktopBlob([file]),
          undefined,
          undefined,
          undefined,
          undefined,
          STRAIGHT,
        ),
      )
      .then(
        (image) => {
          if (this.source !== url) return;
          this.width = image.width;
          this.height = image.height;
          this.data = image.data;
          this.onload?.();
        },
        () => {
          if (this.source === url) this.onerror?.();
        },
      );
  }
}

export class DesktopPlatform extends Platform {
  /**
   * The window decides the size and the pixel ratio, images decode on the
   * runtime's own threads (so the renderer's worker and its start-up probes
   * are off), and animation frames always come, so no timer stands in for
   * one. An error in a frame is reported unless the app handles it.
   */
  override resolveSettings(settings: Settings): Settings {
    const window = windowMetrics();
    return {
      ...settings,
      appWidth: window.width,
      appHeight: window.height,
      deviceLogicalPixelRatio: 1,
      devicePhysicalPixelRatio: window.scale,
      resizable: true,
      numImageWorkers: 0,
      createImageBitmapSupport: 'full',
      premultiplyAlphaHonored: true,
      wakeFallbackDelay: 0,
      presentOnIdle: false,
      handleLoopError: settings.handleLoopError ?? reportLoopError,
    };
  }

  override createCanvas(): HTMLCanvasElement {
    return surface as unknown as HTMLCanvasElement;
  }

  override getElementById(): HTMLElement {
    return container as unknown as HTMLElement;
  }

  override sizeCanvas(_canvas: HTMLCanvasElement, w: number, h: number): void {
    width = Math.round(w);
    height = Math.round(h);
  }

  override requestAnimationFrame(callback: (time: number) => void): number {
    return requestAnimationFrame(callback);
  }

  override cancelAnimationFrame(handle: number): void {
    cancelAnimationFrame(handle);
  }

  override setTimeout(callback: () => void, ms: number): void {
    setTimeout(callback, ms);
  }

  override now(): number {
    return performance.now();
  }

  override createImageBitmap(
    source: ImageBitmapSource,
    sxOrOptions?: number | ImageBitmapOptions,
    sy?: number,
    sw?: number,
    sh?: number,
    options?: ImageBitmapOptions,
  ): Promise<ImageBitmap> {
    const decoded =
      typeof sxOrOptions === 'number'
        ? decode(source, sxOrOptions, sy, sw, sh, options)
        : decode(
            source,
            undefined,
            undefined,
            undefined,
            undefined,
            sxOrOptions,
          );
    return decoded as unknown as Promise<ImageBitmap>;
  }

  override createImage(): HTMLImageElement {
    return new DesktopImage() as unknown as HTMLImageElement;
  }

  override fetch(url: string, type: FetchResponseType): Promise<unknown> {
    if (type === 'json') return readText(url).then(JSON.parse);
    if (type === 'arraybuffer') return readFile(url);
    return readFile(url).then(
      (file) => new DesktopBlob([file], { type: mediaType(url) }),
    );
  }

  /** Images decode on the runtime's threads: there is no script worker. */
  override createWorker(_source: string): Worker | null {
    return null;
  }
}
