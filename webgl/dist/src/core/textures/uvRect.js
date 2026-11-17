/** Clamp to [0, 1] (1.10 clampUnit): resizeMode.clipX / clipY are read through it. */
const clampUnit = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
/**
 * The UV rect a node samples from its texture, ported from 1.10's
 * resolveUvRect: the base rect (the unit square, or a compressed texture's
 * share of its block-padded size), then a SubTexture's region, then a
 * `resizeMode: 'cover'` crop, then flipX / flipY. Writes x1 y1 x2 y2 into
 * `out`. `dimW` x `dimH` is the texture's size as the node sees it (the
 * region's size for a SubTexture), `parentW` x `parentH` the pixel size the
 * region is measured in, `w` x `h` the node's size.
 *
 * Kept as 1.10 computes it for pixel parity, including that a cover crop
 * on a SubTexture or a compressed texture replaces the region instead of
 * cropping inside it.
 *
 * Caller's precondition: `dimW` and `dimH` are above 0 when `options` asks
 * for a cover crop, and `parentW` and `parentH` when there is a region (a
 * 0 gives a degenerate rect). 1.10 skipped the crop while the texture had
 * no dimensions; TextureNodes calls this for uploaded textures only.
 */
export function resolveUvRect(out, x1, y1, x2, y2, sub, parentW, parentH, options, w, h, dimW, dimH) {
    if (sub !== null) {
        x1 = sub.x / parentW;
        y1 = sub.y / parentH;
        x2 = x1 + sub.w / parentW;
        y2 = y1 + sub.h / parentH;
    }
    if (options !== null) {
        const mode = options.resizeMode;
        if (mode !== undefined && mode !== null && mode.type === 'cover') {
            const scaleX = w / dimW;
            const scaleY = h / dimH;
            const scale = Math.max(scaleX, scaleY);
            const precision = 1 / scale;
            if (scaleX < scale) {
                const desiredSize = precision * w;
                x1 = (1 - desiredSize / dimW) * clampUnit(mode.clipX ?? 0.5);
                x2 = x1 + desiredSize / dimW;
            }
            if (scaleY < scale) {
                const desiredSize = precision * h;
                y1 = (1 - desiredSize / dimH) * clampUnit(mode.clipY ?? 0.5);
                y2 = y1 + desiredSize / dimH;
            }
        }
        if (options.flipX === true) {
            const t = x1;
            x1 = x2;
            x2 = t;
        }
        if (options.flipY === true) {
            const t = y1;
            y1 = y2;
            y2 = t;
        }
    }
    out[0] = x1;
    out[1] = y1;
    out[2] = x2;
    out[3] = y2;
}
//# sourceMappingURL=uvRect.js.map