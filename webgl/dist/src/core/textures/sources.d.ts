import type { Platform } from '../../platform/Platform.js';
import type { ImageTextureProps } from './Texture.js';
import type { CreateImageBitmapSupport } from './probes.js';
import { type ImageWorkerManager } from './ImageWorker.js';
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
/**
 * Load an ImageTexture source (spec 9.3), the strategies of 1.10's
 * ImageTexture in order of preference: the worker (XHR and decode off the
 * main thread), main-thread createImageBitmap, then the `<img>` element.
 * A data URI, a Blob, ImageData and an ImageData function are their own
 * source kinds.
 */
export declare function loadImage(ctx: SourceContext, props: ImageTextureProps): Promise<LoadedImage>;
