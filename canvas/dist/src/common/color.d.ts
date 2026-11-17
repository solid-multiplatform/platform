/**
 * Color helpers. Colors on the public API are RGBA packed into a 32-bit
 * unsigned integer (0xRRGGBBAA). The GPU consumes premultiplied ABGR.
 */
/**
 * RGBA -> premultiplied ABGR with the alpha byte multiplied by `alpha`.
 * WebGL is the only backend, so the color channels are always premultiplied.
 */
export declare function premultiplyColorABGR(rgba: number, alpha: number): number;
/**
 * Blend two RGBA colors channel by channel; `p` in [0, 1] weights `rgba2`.
 * `p` outside [0, 1] extrapolates and then clamps each channel (CSS
 * semantics), rather than overflowing into the neighbouring channel.
 */
export declare function mergeColorProgress(rgba1: number, rgba2: number, p: number): number;
/**
 * RGBA with its alpha byte multiplied by `alpha` (no premultiplication).
 */
export declare function mergeColorAlpha(rgba: number, alpha: number): number;
export declare function getRgbaComponents(rgba: number): [number, number, number, number];
export declare function getNormalizedRgbaComponents(rgba: number): [number, number, number, number];
export declare function deg2Rad(degrees: number): number;
