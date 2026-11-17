import { Texture, TextureType } from './Texture.js';
import { isCompressedTextureContainer, loadCompressedTexture, } from '../lib/textureCompression.js';
import { convertUrlToAbsolute, dataURIToBlob, isBase64Image, } from '../lib/utils.js';
import { isSvgImage, loadSvg } from '../lib/textureSvg.js';
import { decodeImageBlob } from '../lib/ImageWorker.js';
import { fetchResource } from '../lib/utils.js';
import { ENABLE_COMPRESSED_TEXTURES } from '../../utils.js';
/**
 * Texture consisting of an image loaded from a URL
 *
 * @remarks
 * The ImageTexture's {@link ImageTextureProps.src} prop defines the image URL
 * to be downloaded.
 *
 * By default, the texture's alpha values will be premultiplied into its color
 * values which is generally the desired setting before they are sent to the
 * texture's associated {@link Shader}. However, in special cases you may want
 * the Shader to receive straight (non-premultiplied) values. In that case you
 * can disable the default behavior by setting the
 * {@link ImageTextureProps.premultiplyAlpha} prop to `false`.
 */
export class ImageTexture extends Texture {
    platform;
    props;
    type = TextureType.image;
    constructor(txManager, props) {
        super(txManager);
        this.platform = txManager.platform;
        this.props = props;
        this.maxRetryCount = props.maxRetryCount;
    }
    async loadImageFallback(src, hasAlpha) {
        const img = new Image();
        if (typeof src === 'string' && isBase64Image(src) === false) {
            img.crossOrigin = 'anonymous';
        }
        return new Promise((resolve, reject) => {
            let objectUrl = null;
            const cleanup = () => {
                if (objectUrl !== null) {
                    URL.revokeObjectURL(objectUrl);
                    objectUrl = null;
                }
            };
            img.onload = () => {
                cleanup();
                resolve({ data: img, premultiplyAlpha: hasAlpha });
            };
            img.onerror = (err) => {
                cleanup();
                const errorMessage = err instanceof Error
                    ? err.message
                    : err instanceof Event
                        ? `Image loading failed for ${img.src}`
                        : 'Unknown image loading error';
                reject(new Error(`Image loading failed: ${errorMessage}`));
            };
            if (src instanceof Blob) {
                objectUrl = URL.createObjectURL(src);
                img.src = objectUrl;
            }
            else {
                img.src = src;
            }
        });
    }
    async createImageBitmap(blob, premultiplyAlpha, sx, sy, sw, sh) {
        const support = this.txManager.imageBitmapSupported;
        const platform = this.platform;
        return decodeImageBlob(platform.createImageBitmap, platform, blob, premultiplyAlpha, sx, sy, sw, sh, support.options, support.full, support.premultiplyHonored);
    }
    async loadImage(src) {
        const { premultiplyAlpha, sx, sy, sw, sh } = this.props;
        const isBase64 = isBase64Image(src);
        if (this.txManager.hasCreateImageBitmap === true) {
            if (isBase64 === false &&
                this.txManager.hasWorker === true &&
                this.txManager.imageWorkerManager !== null &&
                this.txManager.imageWorkerManager.isAvailable() === true) {
                return this.txManager.imageWorkerManager.getImage(src, premultiplyAlpha, sx, sy, sw, sh);
            }
            const blob = isBase64
                ? dataURIToBlob(src)
                : (await fetchResource(src, 'blob'));
            return this.createImageBitmap(blob, premultiplyAlpha, sx, sy, sw, sh);
        }
        return this.loadImageFallback(src, premultiplyAlpha ?? true);
    }
    async getTextureSource() {
        // Compressed textures are not supported by the Canvas2D renderer.
        // Fail fast here before incurring a network fetch or binary decode.
        if (ENABLE_COMPRESSED_TEXTURES &&
            this.txManager.renderer?.mode === 'canvas') {
            const { src, type } = this.props;
            if (type === 'compressed' ||
                (typeof src === 'string' && isCompressedTextureContainer(src) === true)) {
                const err = new Error(`ImageTexture: Compressed textures are not supported in Canvas2D render mode (src: ${String(src)})`);
                this.setState('failed', err);
                return { data: null };
            }
        }
        let resp;
        try {
            resp = await this.determineImageTypeAndLoadImage();
        }
        catch (e) {
            this.setState('failed', e);
            return {
                data: null,
            };
        }
        if (resp.data === null) {
            this.setState('failed', Error('ImageTexture: No image data'));
            return {
                data: null,
            };
        }
        // The loader computes whether WebGL should premultiply this source on
        // upload (it depends on the source type and on whether createImageBitmap
        // honored the premultiply option). Preserve it; fall back to the prop only
        // when the loader didn't decide.
        return {
            data: resp.data,
            premultiplyAlpha: resp.premultiplyAlpha ?? this.props.premultiplyAlpha ?? true,
        };
    }
    determineImageTypeAndLoadImage() {
        const { src, premultiplyAlpha, type } = this.props;
        if (src === null) {
            return {
                data: null,
            };
        }
        if (typeof src !== 'string') {
            if (src instanceof Blob) {
                if (this.txManager.hasCreateImageBitmap === true) {
                    const { sx, sy, sw, sh } = this.props;
                    return this.createImageBitmap(src, premultiplyAlpha, sx, sy, sw, sh);
                }
                else {
                    return this.loadImageFallback(src, premultiplyAlpha ?? true);
                }
            }
            if (src instanceof ImageData) {
                return {
                    data: src,
                    premultiplyAlpha,
                };
            }
            return {
                data: src(),
                premultiplyAlpha,
            };
        }
        const absoluteSrc = convertUrlToAbsolute(src);
        if (type === 'regular') {
            return this.loadImage(absoluteSrc);
        }
        if (type === 'svg' || isSvgImage(src) === true) {
            return loadSvg(absoluteSrc, this.props.w, this.props.h, this.props.sx, this.props.sy, this.props.sw, this.props.sh, this.txManager.pixelRatio);
        }
        if (ENABLE_COMPRESSED_TEXTURES &&
            (type === 'compressed' || isCompressedTextureContainer(src) === true)) {
            return loadCompressedTexture(absoluteSrc);
        }
        // default
        return this.loadImage(absoluteSrc);
    }
    /**
     * Generates a cache key for the ImageTexture based on the provided props.
     * @param props - The props used to generate the cache key.
     * @returns The cache key as a string, or `false` if the key cannot be generated.
     */
    static makeCacheKey(props) {
        // Only cache key-able textures; prioritise key
        const key = props.key || props.src;
        if (typeof key !== 'string') {
            return false;
        }
        // Inline default values so the key is stable whether or not the caller
        // has run them through resolveDefaults first. Must mirror the defaults
        // in resolveDefaults below. Only props that change the decoded pixels
        // belong here: `maxRetryCount` is a load policy, and keying on it
        // uploaded the same image twice for callers with different retry counts.
        const premultiplyAlpha = props.premultiplyAlpha ?? true;
        let cacheKey = `ImageTexture,${key},${premultiplyAlpha}`;
        if (props.sh != null && props.sw != null) {
            cacheKey += `,${props.sx ?? ''},${props.sy ?? ''},${props.sw || ''},${props.sh || ''}`;
        }
        return cacheKey;
    }
    static resolveDefaults(props) {
        return {
            src: props.src ?? '',
            premultiplyAlpha: props.premultiplyAlpha ?? true, // null,
            key: props.key ?? null,
            type: props.type ?? null,
            w: props.w ?? null,
            h: props.h ?? null,
            sx: props.sx ?? null,
            sy: props.sy ?? null,
            sw: props.sw ?? null,
            sh: props.sh ?? null,
            maxRetryCount: props.maxRetryCount ?? 5,
        };
    }
    static z$__type__Props;
}
//# sourceMappingURL=ImageTexture.js.map