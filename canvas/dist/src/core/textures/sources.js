import { convertUrlToAbsolute, dataURIToBlob, isBase64Image, } from '../../common/utils.js';
import { TextureError, TextureErrorCode } from './TextureError.js';
import { decodeImageBlob, } from './ImageWorker.js';
import { failAfterTimeout, isSvgImage, loadSvg, settled } from './svg.js';
import { isCompressedTextureContainer, loadCompressedTexture, } from './compressed.js';
import { ENABLE_COMPRESSED_TEXTURES } from '../../common/flags.js';
const toLoaded = (decoded) => ({
    data: decoded.data,
    w: decoded.data.width,
    h: decoded.data.height,
    premultiply: decoded.premultiplyAlpha,
});
/**
 * Load an ImageTexture source (spec 9.3), the strategies of 1.10's
 * ImageTexture in order of preference: the worker (XHR and decode off the
 * main thread), main-thread createImageBitmap, then the `<img>` element.
 * A data URI, a Blob, ImageData and an ImageData function are their own
 * source kinds.
 */
export function loadImage(ctx, props) {
    const src = props.src;
    const premultiply = props.premultiplyAlpha ?? true;
    if (src === undefined || src === null || src === '') {
        return Promise.reject(new TextureError(TextureErrorCode.TEXTURE_DATA_NULL));
    }
    if (typeof src === 'function') {
        const data = src();
        return data === null
            ? Promise.reject(new TextureError(TextureErrorCode.TEXTURE_DATA_NULL))
            : Promise.resolve(imageData(data, premultiply));
    }
    if (typeof src !== 'string') {
        if (typeof Blob !== 'undefined' && src instanceof Blob) {
            return decodeBlob(ctx, src, props, premultiply);
        }
        return Promise.resolve(imageData(src, premultiply));
    }
    return loadUrl(ctx, src, props, premultiply);
}
/** ImageData is straight alpha: WebGL premultiplies it when asked to. */
const imageData = (data, premultiply) => ({
    data,
    w: data.width,
    h: data.height,
    premultiply,
});
function loadUrl(ctx, src, props, premultiply) {
    const base64 = isBase64Image(src);
    const url = base64 === true ? src : convertUrlToAbsolute(src);
    // 'regular' forces the image path; otherwise an explicit type or the
    // extension picks a plugin (1.10's order).
    const type = props.type ?? null;
    if (type !== 'regular' && (type === 'svg' || isSvgImage(src) === true)) {
        return loadSvg(ctx, url, props.w ?? null, props.h ?? null, props.sx ?? null, props.sy ?? null, props.sw ?? null, props.sh ?? null);
    }
    if (ENABLE_COMPRESSED_TEXTURES === true &&
        type !== 'regular' &&
        (type === 'compressed' || isCompressedTextureContainer(src) === true)) {
        return loadCompressedTexture(ctx.platform, url);
    }
    if (ctx.support === null) {
        return loadElement(ctx.platform, url, premultiply);
    }
    const worker = ctx.worker;
    if (base64 === false && worker !== null) {
        return worker
            .getImage(url, premultiply, props.sx ?? null, props.sy ?? null, props.sw ?? null, props.sh ?? null)
            .then(toLoaded, (error) => {
            // The worker crashed with this request in flight: load it on the
            // main thread rather than fail it. A request the worker answered
            // with an error still fails, and so does one its destroy ended.
            if (worker.crashed === true) {
                return fetchAndDecode(ctx, url, props, premultiply);
            }
            throw error;
        });
    }
    if (base64 === true) {
        // A malformed URI throws here: the Loader calls this inside a promise.
        return decodeBlob(ctx, dataURIToBlob(src), props, premultiply);
    }
    return fetchAndDecode(ctx, url, props, premultiply);
}
/** Fetch `url` and decode it on the main thread. */
function fetchAndDecode(ctx, url, props, premultiply) {
    return ctx.platform.fetch(url, 'blob').then((b) => decodeBlob(ctx, b, props, premultiply));
}
function decodeBlob(ctx, blob, props, premultiply) {
    const support = ctx.support;
    if (support === null) {
        return loadElement(ctx.platform, blob, premultiply);
    }
    const platform = ctx.platform;
    return decodeImageBlob(platform.createImageBitmap, platform, blob, premultiply, props.sx ?? null, props.sy ?? null, props.sw ?? null, props.sh ?? null, support.options, support.full, support.premultiplyHonored).then(toLoaded);
}
/**
 * The `<img>` path, the floor where createImageBitmap is missing. An
 * `<img>` is straight alpha: the upload premultiplies it
 * (UNPACK_PREMULTIPLY_ALPHA_WEBGL) unless the texture's premultiplyAlpha
 * is false, and with that off texImage2D decodes the image again. No crop
 * on this path (1.10). An `<img>` has no timeout of its own: one still
 * loading a URL after REQUEST_TIMEOUT fails and is stopped
 * (failAfterTimeout), rather than hold its loader slot for good.
 */
function loadElement(platform, src, premultiply) {
    const img = platform.createImage();
    // A data URI or a Blob loads locally: only a URL is cross-origin, and
    // only a URL can stall.
    const remote = typeof src === 'string' && isBase64Image(src) === false;
    if (remote === true) {
        img.crossOrigin = 'anonymous';
    }
    const name = typeof src === 'string' ? src : 'a Blob';
    const loading = new Promise((resolve, reject) => {
        const timeout = remote === true
            ? failAfterTimeout(platform, img, reject, `Image loading timed out for ${name}`)
            : null;
        img.onload = () => {
            settled(timeout);
            resolve();
        };
        img.onerror = () => {
            settled(timeout);
            reject(new Error(`Image loading failed for ${name}`));
        };
    });
    let objectUrl = null;
    if (typeof src === 'string') {
        img.src = src;
    }
    else {
        objectUrl = URL.createObjectURL(src);
        img.src = objectUrl;
    }
    return loading.then(() => {
        revoke(objectUrl);
        return { data: img, w: img.width, h: img.height, premultiply };
    }, (error) => {
        revoke(objectUrl);
        throw error;
    });
}
function revoke(objectUrl) {
    if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
    }
}
//# sourceMappingURL=sources.js.map