import { type Platform } from '../../platform/Platform.js';
import type { LoadedImage, SourceContext } from './sources.js';
/** A URL ending in .svg, with or without a query string (1.10). */
export declare function isSvgImage(url: string): boolean;
/**
 * A remote `<img>` load's timeout, as its timer reads it: the image and the
 * load's `reject` until the load settles, then nulls (`settled`).
 */
export interface ImageTimeout {
    img: HTMLImageElement | null;
    reject: ((error: Error) => void) | null;
}
/**
 * Fail `img`'s load with `message` once REQUEST_TIMEOUT has passed, and
 * stop it: an `<img>` has no timeout of its own, and one that stalls would
 * hold its loader slot, and its connection, for good. Here and in
 * sources.ts's `<img>` path; the load's onload and onerror call `settled`.
 * The timer fires either way (Platform has no clearTimeout) and reads the
 * state first, so for a load already settled it builds no Error and holds
 * nothing of it. A function of its own because a closure keeps its whole
 * enclosing scope: the timer keeps only the state and the message.
 */
export declare function failAfterTimeout(platform: Platform, img: HTMLImageElement, reject: (error: Error) => void, message: string): ImageTimeout;
/** The load `timeout` watches settled (null: no timeout was armed). */
export declare function settled(timeout: ImageTimeout | null): void;
/**
 * Rasterize an SVG for a texture (ported from 1.10's loadSvg): decode it in
 * an `<img>`, draw it into a 2D canvas at its target size times the pixel
 * ratio (never below 1, so a 720p stage on a 1080p grid stays sharp), and
 * upload that. The target size is the texture's w/h (a node's size when it
 * comes from `src`), else the crop's, else the SVG's own. sw/sh crop the
 * SVG itself. An ImageBitmap of the canvas where createImageBitmap exists
 * (already premultiplied), its ImageData otherwise (straight: WebGL
 * premultiplies). The canvas is shrunk once its pixels are copied out.
 */
export declare function loadSvg(ctx: SourceContext, url: string, width: number | null, height: number | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null): Promise<LoadedImage>;
