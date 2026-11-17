import type { Platform } from '../../platform/Platform.js';
import type { GlContext } from '../gl/GlContext.js';
import type { LoadedImage } from './sources.js';
/** Block size of a compressed format. */
interface BlockInfo {
    width: number;
    height: number;
    bytes: number;
}
/** A parsed compressed texture, uploaded with compressedTexImage2D. */
export interface CompressedData {
    glInternalFormat: number;
    /** Every mip level stored in the container. */
    mipmaps: ArrayBuffer[];
    type: 'pvr' | 'ktx' | 'astc';
    w: number;
    h: number;
    blockInfo: BlockInfo;
}
/** A URL ending in .ktx or .pvr. */
export declare function isCompressedTextureContainer(src: string): boolean;
/** GL internal formats and their block sizes. */
export declare const blockInfoMap: {
    [format: number]: BlockInfo;
};
/** Fetch and parse a compressed container (its magic number picks the parser). */
export declare function loadCompressedTexture(platform: Platform, url: string): Promise<LoadedImage>;
/**
 * Whether the context can take `format`: getExtension is what enables a
 * compressed format, so this also enables it.
 */
export declare function enableCompressedFormat(ctx: GlContext, format: number): boolean;
/**
 * Whether `data` goes up as a mipmapped chain: a power-of-two texture that
 * carries its whole chain of levels, each uploaded at its own size, which
 * WebGL1 finds complete (1.10 mipmapped whenever there was more than one
 * level, and an incomplete chain samples black). A KTX level 0 that needs
 * block padding goes up alone: padded, a chain would not halve from it.
 */
export declare function mipmapped(data: CompressedData): boolean;
/**
 * Upload `data` into `texture`, after enableCompressedFormat, whose min
 * filter `mip` chose (mipmapped(data)): every level at its own size for a
 * mipmapped chain (S3TC allows a side of 1 or 2 past level 0, and a
 * power-of-two side of 4 or more is a whole number of blocks), otherwise
 * level 0 alone, a KTX one at its block-padded size as in 1.10 (the
 * Uploader's UV rect stops short of the padding), PVR and ASTC at their
 * own. KTX data short of its blocks is zero-filled (1.10).
 */
export declare function uploadCompressed(ctx: GlContext, texture: WebGLTexture, data: CompressedData, mip: boolean): void;
export {};
