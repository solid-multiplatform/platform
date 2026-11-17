import type { Platform } from '../../platform/Platform.js';
import {
  convertUrlToAbsolute,
  dataURIToBlob,
  isBase64Image,
} from '../../common/utils.js';
import { TextureError, TextureErrorCode } from './TextureError.js';
import type { ImageTextureProps } from './Texture.js';
import type { CreateImageBitmapSupport } from './probes.js';
import {
  decodeImageBlob,
  type DecodedImage,
  type ImageWorkerManager,
} from './ImageWorker.js';
import { failAfterTimeout, isSvgImage, loadSvg, settled } from './svg.js';
import {
  isCompressedTextureContainer,
  loadCompressedTexture,
} from './compressed.js';
import { ENABLE_COMPRESSED_TEXTURES } from '../../common/flags.js';

/** A finished load: its data, its pixel size, and whether WebGL premultiplies it. */
export interface LoadedImage {
  data: unknown;
  w: number;
  h: number;
  premultiply: boolean;
}

/** The decode strategy the startup probes chose (Loader). */
export interface SourceContext {
  platform: Platform;
  /** createImageBitmap's forms; null where there is none: the `<img>` path (Chrome 38 to 49). */
  support: CreateImageBitmapSupport | null;
  /** The image worker, when it could be started and createImageBitmap exists. */
  worker: ImageWorkerManager | null;
  /** Device pixels per logical pixel (SVG rasterizing). */
  pixelRatio: number;
}

const toLoaded = (decoded: DecodedImage): LoadedImage => ({
  data: decoded.data,
  w: decoded.data.width,
  h: decoded.data.height,
  premultiply: decoded.premultiplyAlpha,
});

/**
 * Load an ImageTexture source (spec 9.3), the strategies of 1.10's
 * ImageTexture in order of preference: the worker (XHR and decode off the
 * main thread), main-thread createImageBitmap, then the `<img>` element.
 * A data URI, a Blob, ImageData and an ImageData function are their own
 * source kinds.
 */
export function loadImage(
  ctx: SourceContext,
  props: ImageTextureProps,
): Promise<LoadedImage> {
  const src = props.src;
  const premultiply = props.premultiplyAlpha ?? true;
  if (src === undefined || src === null || src === '') {
    return Promise.reject(new TextureError(TextureErrorCode.TEXTURE_DATA_NULL));
  }
  if (typeof src === 'function') {
    const data = src();
    return data === null
      ? Promise.reject(new TextureError(TextureErrorCode.TEXTURE_DATA_NULL))
      : Promise.resolve(imageData(data, premultiply));
  }
  if (typeof src !== 'string') {
    if (typeof Blob !== 'undefined' && src instanceof Blob) {
      return decodeBlob(ctx, src, props, premultiply);
    }
    return Promise.resolve(imageData(src as ImageData, premultiply));
  }
  return loadUrl(ctx, src, props, premultiply);
}

/** ImageData is straight alpha: WebGL premultiplies it when asked to. */
const imageData = (data: ImageData, premultiply: boolean): LoadedImage => ({
  data,
  w: data.width,
  h: data.height,
  premultiply,
});

function loadUrl(
  ctx: SourceContext,
  src: string,
  props: ImageTextureProps,
  premultiply: boolean,
): Promise<LoadedImage> {
  const base64 = isBase64Image(src);
  const url = base64 === true ? src : convertUrlToAbsolute(src);
  // 'regular' forces the image path; otherwise an explicit type or the
  // extension picks a plugin (1.10's order).
  const type = props.type ?? null;
  if (type !== 'regular' && (type === 'svg' || isSvgImage(src) === true)) {
    return loadSvg(
      ctx,
      url,
      props.w ?? null,
      props.h ?? null,
      props.sx ?? null,
      props.sy ?? null,
      props.sw ?? null,
      props.sh ?? null,
    );
  }
  if (
    ENABLE_COMPRESSED_TEXTURES === true &&
    type !== 'regular' &&
    (type === 'compressed' || isCompressedTextureContainer(src) === true)
  ) {
    return loadCompressedTexture(ctx.platform, url);
  }
  if (ctx.support === null) {
    return loadElement(ctx.platform, url, premultiply);
  }
  const worker = ctx.worker;
  if (base64 === false && worker !== null) {
    return worker
      .getImage(
        url,
        premultiply,
        props.sx ?? null,
        props.sy ?? null,
        props.sw ?? null,
        props.sh ?? null,
      )
      .then(toLoaded, (error: unknown) => {
        // A decode timeout uses the image element; a crash uses the main
        // thread. Other worker errors and destruction still fail the load.
        if (
          error instanceof Error &&
          error.name === 'ImageBitmapTimeoutError'
        ) {
          return loadElement(ctx.platform, url, premultiply);
        }
        if (worker.crashed === true) {
          return fetchAndDecode(ctx, url, props, premultiply);
        }
        throw error;
      });
  }
  if (base64 === true) {
    // A malformed URI throws here: the Loader calls this inside a promise.
    return decodeBlob(ctx, dataURIToBlob(src), props, premultiply);
  }
  return fetchAndDecode(ctx, url, props, premultiply);
}

/** Fetch `url` and decode it on the main thread. */
function fetchAndDecode(
  ctx: SourceContext,
  url: string,
  props: ImageTextureProps,
  premultiply: boolean,
): Promise<LoadedImage> {
  return (ctx.platform.fetch(url, 'blob') as Promise<Blob>).then(b =>
    decodeBlob(ctx, b, props, premultiply),
  );
}

function decodeBlob(
  ctx: SourceContext,
  blob: Blob,
  props: ImageTextureProps,
  premultiply: boolean,
): Promise<LoadedImage> {
  const support = ctx.support;
  if (support === null) {
    return loadElement(ctx.platform, blob, premultiply);
  }
  const platform = ctx.platform;
  return decodeImageBlob(
    platform.createImageBitmap as (...args: unknown[]) => Promise<ImageBitmap>,
    platform,
    blob,
    premultiply,
    props.sx ?? null,
    props.sy ?? null,
    props.sw ?? null,
    props.sh ?? null,
    support.options,
    support.full,
    support.premultiplyHonored,
  ).then(toLoaded, () => loadElement(platform, blob, premultiply));
}

/**
 * The `<img>` path, the floor where createImageBitmap is missing. An
 * `<img>` is straight alpha: the upload premultiplies it
 * (UNPACK_PREMULTIPLY_ALPHA_WEBGL) unless the texture's premultiplyAlpha
 * is false, and with that off texImage2D decodes the image again. No crop
 * on this path (1.10). An `<img>` has no timeout of its own: one still
 * loading after REQUEST_TIMEOUT fails and is stopped
 * (failAfterTimeout), rather than hold its loader slot for good.
 */
function loadElement(
  platform: Platform,
  src: string | Blob,
  premultiply: boolean,
): Promise<LoadedImage> {
  const img = platform.createImage();
  // Only remote URLs need cross-origin image requests.
  const remote = typeof src === 'string' && isBase64Image(src) === false;
  if (remote === true) {
    img.crossOrigin = 'anonymous';
  }
  const name = typeof src === 'string' ? src : 'a Blob';
  const loading = new Promise<void>((resolve, reject) => {
    const timeout = failAfterTimeout(
      platform,
      img,
      reject,
      `Image loading timed out for ${name}`,
    );
    img.onload = () => {
      settled(timeout);
      resolve();
    };
    img.onerror = () => {
      settled(timeout);
      reject(new Error(`Image loading failed for ${name}`));
    };
  });
  let objectUrl: string | null = null;
  if (typeof src === 'string') {
    img.src = src;
  } else {
    objectUrl = URL.createObjectURL(src);
    img.src = objectUrl;
  }
  return loading.then(
    (): LoadedImage => {
      revoke(objectUrl);
      return { data: img, w: img.width, h: img.height, premultiply };
    },
    (error: unknown) => {
      revoke(objectUrl);
      throw error;
    },
  );
}

function revoke(objectUrl: string | null): void {
  if (objectUrl !== null) {
    URL.revokeObjectURL(objectUrl);
  }
}
