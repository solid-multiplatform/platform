import type { TextureOptions } from '../../common/types.js';
/** A SubTexture's region, in pixels of its parent texture. */
export interface SubRegion {
    x: number;
    y: number;
    w: number;
    h: number;
}
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
export declare function resolveUvRect(out: Float64Array, x1: number, y1: number, x2: number, y2: number, sub: SubRegion | null, parentW: number, parentH: number, options: TextureOptions | null, w: number, h: number, dimW: number, dimH: number): void;
