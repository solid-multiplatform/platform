import { type TextureData } from '../textures/Texture.js';
/**
 * Tests if the given location is a SVG
 * @param url
 * @remarks
 * This function is used to determine if the given image url is a SVG
 * image
 * @returns
 */
export declare function isSvgImage(url: string): boolean;
/**
 * Loads a SVG image and rasterizes it for use as a texture.
 *
 * @remarks
 * Rasterizes at `pixelRatio` to keep the texture sharp on HiDPI / 4K displays.
 * `width`/`height` are interpreted as the logical (CSS-pixel) target size; the
 * backing canvas is allocated at `width * pixelRatio` × `height * pixelRatio`.
 *
 * When `sw`/`sh` are provided they describe a source-region crop on the SVG
 * (not a crop of the destination canvas) and are sampled via the 9-arg form of
 * drawImage.
 *
 * Returns an `ImageBitmap` when available (zero CPU readback, transferable),
 * falling back to `ImageData` on older browsers without `createImageBitmap`.
 */
export declare const loadSvg: (url: string, width: number | null, height: number | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null, pixelRatio: number) => Promise<TextureData>;
