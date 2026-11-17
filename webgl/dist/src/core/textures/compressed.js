/** A URL ending in .ktx or .pvr. */
export function isCompressedTextureContainer(src) {
    return /\.(ktx|pvr)$/.test(src);
}
const BLOCK_4x4x8 = { width: 4, height: 4, bytes: 8 };
const BLOCK_4x4x16 = { width: 4, height: 4, bytes: 16 };
const BLOCK_5x5x16 = { width: 5, height: 5, bytes: 16 };
const BLOCK_6x6x16 = { width: 6, height: 6, bytes: 16 };
const BLOCK_8x4x8 = { width: 8, height: 4, bytes: 8 };
const BLOCK_8x8x16 = { width: 8, height: 8, bytes: 16 };
const BLOCK_10x10x16 = { width: 10, height: 10, bytes: 16 };
const BLOCK_12x12x16 = { width: 12, height: 12, bytes: 16 };
/** GL internal formats and their block sizes. */
export const blockInfoMap = {
    0x83f0: BLOCK_4x4x8, // S3TC DXT1 RGB
    0x83f1: BLOCK_4x4x8, // S3TC DXT1 RGBA
    0x83f2: BLOCK_4x4x16, // S3TC DXT3
    0x83f3: BLOCK_4x4x16, // S3TC DXT5
    0x8d64: BLOCK_4x4x8, // ETC1
    0x9274: BLOCK_4x4x8, // ETC2 RGB8
    0x9275: BLOCK_4x4x8, // ETC2 SRGB8
    0x9278: BLOCK_4x4x16, // ETC2 RGBA8 EAC
    0x9279: BLOCK_4x4x16, // ETC2 SRGB8 ALPHA8 EAC
    0x8c00: BLOCK_4x4x8, // PVRTC RGB 4bpp
    0x8c02: BLOCK_4x4x8, // PVRTC RGBA 4bpp
    0x8c01: BLOCK_8x4x8, // PVRTC RGB 2bpp
    0x8c03: BLOCK_8x4x8, // PVRTC RGBA 2bpp
    0x93b0: BLOCK_4x4x16, // ASTC 4x4
    0x93d0: BLOCK_4x4x16,
    0x93b1: BLOCK_5x5x16, // ASTC 5x5
    0x93d1: BLOCK_5x5x16,
    0x93b2: BLOCK_6x6x16, // ASTC 6x6
    0x93d2: BLOCK_6x6x16,
    0x93b3: BLOCK_8x8x16, // ASTC 8x8
    0x93d3: BLOCK_8x8x16,
    0x93b4: BLOCK_10x10x16, // ASTC 10x10
    0x93d4: BLOCK_10x10x16,
    0x93b5: BLOCK_12x12x16, // ASTC 12x12
    0x93d5: BLOCK_12x12x16,
};
const PVR_MAGIC = 0x03525650; // 'PVR3', little-endian
const PVR_TO_GL = {
    0: 0x8c01,
    1: 0x8c03,
    2: 0x8c00,
    3: 0x8c02, // PVRTC1
    6: 0x8d64, // ETC1
    7: 0x83f0,
    8: 0x83f2,
    9: 0x83f2,
    10: 0x83f3,
    11: 0x83f3, // DXT
};
const ASTC_MAGIC = 0x5ca1ab13;
const ASTC_TO_GL = {
    '4x4': 0x93b0,
    '5x5': 0x93b1,
    '6x6': 0x93b2,
    '8x8': 0x93b3,
    '10x10': 0x93b4,
    '12x12': 0x93b5,
};
const KTX_IDENTIFIER = [
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];
/** Fetch and parse a compressed container (its magic number picks the parser). */
export function loadCompressedTexture(platform, url) {
    return platform.fetch(url, 'arraybuffer').then((buffer) => {
        if (buffer.byteLength < 16) {
            throw new Error(`Failed to load compressed texture from ${url}: file too small (${buffer.byteLength} bytes)`);
        }
        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);
        let data;
        if (magic === PVR_MAGIC) {
            data = parsePVR(view);
        }
        else if (magic === ASTC_MAGIC) {
            data = parseASTC(view);
        }
        else {
            for (let i = 0; i < KTX_IDENTIFIER.length; i++) {
                if (view.getUint8(i) !== KTX_IDENTIFIER[i]) {
                    throw new Error(`Failed to load compressed texture from ${url}: unrecognized format`);
                }
            }
            data = parseKTX(view);
        }
        return { data, w: data.w, h: data.h, premultiply: false };
    });
}
function readUint24(view, offset) {
    return (view.getUint8(offset) +
        (view.getUint8(offset + 1) << 8) +
        (view.getUint8(offset + 2) << 16));
}
function parseASTC(view) {
    const blockX = view.getUint8(4);
    const blockY = view.getUint8(5);
    const w = readUint24(view, 7);
    const h = readUint24(view, 10);
    if (w === 0 || h === 0) {
        throw new Error(`Invalid ASTC texture dimensions: ${w}x${h}`);
    }
    const expected = Math.ceil(w / blockX) * Math.ceil(h / blockY) * 16;
    if (expected !== view.byteLength - 16) {
        throw new Error(`Invalid ASTC texture data size: expected ${expected}, got ${view.byteLength - 16}`);
    }
    const format = ASTC_TO_GL[`${blockX}x${blockY}`];
    if (format === undefined) {
        throw new Error(`Unsupported ASTC block size: ${blockX}x${blockY}`);
    }
    return {
        blockInfo: blockInfoMap[format],
        glInternalFormat: format,
        mipmaps: [view.buffer.slice(16)],
        w,
        h,
        type: 'astc',
    };
}
function parseKTX(view) {
    const endianness = view.getUint32(12, true);
    const little = endianness === 0x04030201;
    if (little === false && endianness !== 0x01020304) {
        throw new Error('Invalid KTX endianness value');
    }
    const glType = view.getUint32(16, little);
    const glFormat = view.getUint32(24, little);
    if (glType !== 0 || glFormat !== 0) {
        throw new Error(`KTX texture is not compressed (glType: ${glType}, glFormat: ${glFormat})`);
    }
    const format = view.getUint32(28, little);
    if (blockInfoMap[format] === undefined) {
        throw new Error(`Unsupported KTX compressed texture format: 0x${format.toString(16)}`);
    }
    const w = view.getUint32(36, little);
    const h = view.getUint32(40, little);
    if (w === 0 || h === 0) {
        throw new Error(`Invalid KTX texture dimensions: ${w}x${h}`);
    }
    const levels = view.getUint32(56, little);
    if (levels === 0) {
        throw new Error('KTX texture has no mipmap levels');
    }
    const buffer = view.buffer;
    let offset = 64 + view.getUint32(60, little);
    if (offset > view.byteLength) {
        throw new Error('Invalid KTX file: key/value data exceeds file size');
    }
    const mipmaps = [];
    for (let i = 0; i < levels; i++) {
        const size = view.getUint32(offset, little);
        offset += 4;
        mipmaps.push(buffer.slice(offset, offset + size));
        offset += size;
        if (offset % 4 !== 0) {
            offset += 4 - (offset % 4);
        }
    }
    return {
        blockInfo: blockInfoMap[format],
        glInternalFormat: format,
        mipmaps,
        w,
        h,
        type: 'ktx',
    };
}
function pvrtcMipSize(w, h, bpp) {
    const minW = bpp === 2 ? 16 : 8;
    return (Math.max(w, minW) * Math.max(h, 8) * bpp) / 8;
}
function parsePVR(view) {
    const pixelFormat = view.getUint32(8, true);
    const format = PVR_TO_GL[pixelFormat];
    if (format === undefined) {
        throw new Error(`Unsupported PVR pixel format: 0x${pixelFormat.toString(16)}`);
    }
    const h = view.getInt32(24, true);
    const w = view.getInt32(28, true);
    if (w === 0 || h === 0) {
        throw new Error(`Invalid PVR texture dimensions: ${w}x${h}`);
    }
    const levels = view.getInt32(44, true);
    if (levels < 1) {
        throw new Error('PVR texture has no mipmap levels');
    }
    const buffer = view.buffer;
    let offset = 52 + view.getUint32(48, true);
    if (offset > buffer.byteLength) {
        throw new Error('Invalid PVR file: metadata exceeds file size');
    }
    const block = blockInfoMap[format];
    const mipmaps = [];
    // PVR v3 stores the levels back to back with no size field, so each
    // size comes from the level's dimensions, a side never below 1 (1.10
    // first read a size field, and mis-sliced a level whose first word read
    // as a small number).
    for (let i = 0; i < levels; i++) {
        const lw = Math.max(1, w >> i);
        const lh = Math.max(1, h >> i);
        const size = pixelFormat <= 3
            ? pvrtcMipSize(lw, lh, pixelFormat <= 1 ? 2 : 4)
            : Math.ceil(lw / block.width) *
                Math.ceil(lh / block.height) *
                block.bytes;
        mipmaps.push(buffer.slice(offset, offset + size));
        offset += size;
    }
    return {
        blockInfo: block,
        glInternalFormat: format,
        mipmaps,
        w,
        h,
        type: 'pvr',
    };
}
// Extensions to enable before a format is valid in compressedTexImage2D,
// first exposed name wins (module constants: no array per upload).
const EXT_ASTC = ['WEBGL_compressed_texture_astc'];
const EXT_S3TC = ['WEBGL_compressed_texture_s3tc'];
const EXT_ETC1 = ['WEBGL_compressed_texture_etc1'];
const EXT_ETC = ['WEBGL_compressed_texture_etc'];
const EXT_PVRTC = [
    'WEBGL_compressed_texture_pvrtc',
    'WEBKIT_WEBGL_compressed_texture_pvrtc',
];
const EXT_NONE = [];
function extensionsFor(format) {
    if (format >= 0x93b0 && format <= 0x93d5)
        return EXT_ASTC;
    if (format >= 0x83f0 && format <= 0x83f3)
        return EXT_S3TC;
    if (format === 0x8d64)
        return EXT_ETC1;
    if (format >= 0x9274 && format <= 0x9279)
        return EXT_ETC;
    if (format >= 0x8c00 && format <= 0x8c03)
        return EXT_PVRTC;
    return EXT_NONE;
}
/**
 * Whether the context can take `format`: getExtension is what enables a
 * compressed format, so this also enables it.
 */
export function enableCompressedFormat(ctx, format) {
    const names = extensionsFor(format);
    if (names.length === 0) {
        return true;
    }
    for (let i = 0; i < names.length; i++) {
        if (ctx.extension(names[i]) !== null) {
            return true;
        }
    }
    return false;
}
/**
 * The levels of a whole mip chain of a w x h texture, down to 1 x 1; 0 when
 * a side is not a power of two (WebGL1 cannot mipmap it).
 */
function chainLength(w, h) {
    if ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0) {
        return 0;
    }
    let levels = 1;
    for (let size = Math.max(w, h); size > 1; size >>= 1) {
        levels++;
    }
    return levels;
}
/**
 * Whether `data` goes up as a mipmapped chain: a power-of-two texture that
 * carries its whole chain of levels, each uploaded at its own size, which
 * WebGL1 finds complete (1.10 mipmapped whenever there was more than one
 * level, and an incomplete chain samples black). A KTX level 0 that needs
 * block padding goes up alone: padded, a chain would not halve from it.
 */
export function mipmapped(data) {
    const block = data.blockInfo;
    return (data.mipmaps.length > 1 &&
        data.mipmaps.length === chainLength(data.w, data.h) &&
        (data.type !== 'ktx' ||
            (data.w % block.width === 0 && data.h % block.height === 0)));
}
/**
 * Upload `data` into `texture`, after enableCompressedFormat, whose min
 * filter `mip` chose (mipmapped(data)): every level at its own size for a
 * mipmapped chain (S3TC allows a side of 1 or 2 past level 0, and a
 * power-of-two side of 4 or more is a whole number of blocks), otherwise
 * level 0 alone, a KTX one at its block-padded size as in 1.10 (the
 * Uploader's UV rect stops short of the padding), PVR and ASTC at their
 * own. KTX data short of its blocks is zero-filled (1.10).
 */
export function uploadCompressed(ctx, texture, data, mip) {
    const mipmaps = data.mipmaps;
    const block = data.blockInfo;
    const levels = mip === true ? mipmaps.length : 1;
    let w = data.w;
    let h = data.h;
    for (let i = 0; i < levels; i++) {
        let bytes = new Uint8Array(mipmaps[i]);
        let uploadW = w;
        let uploadH = h;
        if (data.type === 'ktx') {
            const blocksW = Math.ceil(w / block.width);
            const blocksH = Math.ceil(h / block.height);
            // Level 0 only: a chain's is a whole number of blocks already.
            if (i === 0) {
                uploadW = blocksW * block.width;
                uploadH = blocksH * block.height;
            }
            const expected = blocksW * blocksH * block.bytes;
            if (bytes.byteLength < expected) {
                const padded = new Uint8Array(expected);
                padded.set(bytes);
                bytes = padded;
            }
        }
        ctx.compressedTexImage(texture, i, data.glInternalFormat, uploadW, uploadH, bytes);
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
    }
}
//# sourceMappingURL=compressed.js.map