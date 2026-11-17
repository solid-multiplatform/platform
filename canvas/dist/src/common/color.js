/**
 * Color helpers. Colors on the public API are RGBA packed into a 32-bit
 * unsigned integer (0xRRGGBBAA). The GPU consumes premultiplied ABGR.
 */
/**
 * RGBA -> premultiplied ABGR with the alpha byte multiplied by `alpha`.
 * WebGL is the only backend, so the color channels are always premultiplied.
 */
export function premultiplyColorABGR(rgba, alpha) {
    const a = ((rgba & 0xff) / 255) * alpha;
    return (((((a * 255) | 0) << 24) |
        (((((rgba >>> 8) & 0xff) * a) | 0) << 16) |
        (((((rgba >>> 16) & 0xff) * a) | 0) << 8) |
        (((rgba >>> 24) * a) | 0)) >>>
        0);
}
/**
 * Clamp a channel value to the byte range. Callers may pass an eased `p`
 * outside [0, 1] (back easings overshoot by design), which extrapolates a
 * channel past 0 or 255; clamping after rounding keeps that from bleeding
 * into the neighbouring byte when the channels are packed.
 */
function clampByte(value) {
    if (value < 0)
        return 0;
    if (value > 255)
        return 255;
    return value;
}
/**
 * Blend two RGBA colors channel by channel; `p` in [0, 1] weights `rgba2`.
 * `p` outside [0, 1] extrapolates and then clamps each channel (CSS
 * semantics), rather than overflowing into the neighbouring channel.
 */
export function mergeColorProgress(rgba1, rgba2, p) {
    const r1 = rgba1 >>> 24;
    const g1 = (rgba1 >>> 16) & 0xff;
    const b1 = (rgba1 >>> 8) & 0xff;
    const a1 = rgba1 & 0xff;
    const r2 = rgba2 >>> 24;
    const g2 = (rgba2 >>> 16) & 0xff;
    const b2 = (rgba2 >>> 8) & 0xff;
    const a2 = rgba2 & 0xff;
    const q = 1 - p;
    const r = clampByte(Math.round(r2 * p + r1 * q));
    const g = clampByte(Math.round(g2 * p + g1 * q));
    const b = clampByte(Math.round(b2 * p + b1 * q));
    const a = clampByte(Math.round(a2 * p + a1 * q));
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
/**
 * RGBA with its alpha byte multiplied by `alpha` (no premultiplication).
 */
export function mergeColorAlpha(rgba, alpha) {
    const r = rgba >>> 24;
    const g = (rgba >>> 16) & 0xff;
    const b = (rgba >>> 8) & 0xff;
    const a = Math.trunc((rgba & 0xff) * alpha);
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
export function getRgbaComponents(rgba) {
    return [rgba >>> 24, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff];
}
export function getNormalizedRgbaComponents(rgba) {
    return [
        (rgba >>> 24) / 255,
        ((rgba >>> 16) & 0xff) / 255,
        ((rgba >>> 8) & 0xff) / 255,
        (rgba & 0xff) / 255,
    ];
}
export function deg2Rad(degrees) {
    return (degrees * Math.PI) / 180;
}
//# sourceMappingURL=color.js.map