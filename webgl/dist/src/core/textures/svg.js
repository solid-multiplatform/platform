import { isBase64Image } from '../../common/utils.js';
import { REQUEST_TIMEOUT } from '../../platform/Platform.js';
/** A URL ending in .svg, with or without a query string (1.10). */
export function isSvgImage(url) {
    return /\.(svg)(\?.*)?$/.test(url);
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
export function failAfterTimeout(platform, img, reject, message) {
    const timeout = { img, reject };
    platform.setTimeout(() => {
        timedOut(timeout, message);
    }, REQUEST_TIMEOUT);
    return timeout;
}
/** The load `timeout` watches settled (null: no timeout was armed). */
export function settled(timeout) {
    if (timeout !== null) {
        timeout.img = null;
        timeout.reject = null;
    }
}
function timedOut(timeout, message) {
    const img = timeout.img;
    const reject = timeout.reject;
    if (img === null || reject === null) {
        return;
    }
    settled(timeout);
    // An emptied src ends the request; the error event that follows finds
    // no handler.
    img.onload = null;
    img.onerror = null;
    img.src = '';
    reject(new Error(message));
}
/** The first of the sizes above 0, else `last` (1.10 chained them with ||). */
function firstSize(a, b, c, last) {
    if (a !== null && a > 0) {
        return a;
    }
    if (b !== null && b > 0) {
        return b;
    }
    return c > 0 ? c : last;
}
/**
 * A canvas whose pixels were copied out: its backing store goes now, not
 * at some later GC (TV memory).
 */
function freeCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
}
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
export function loadSvg(ctx, url, width, height, sx, sy, sw, sh) {
    const platform = ctx.platform;
    const img = platform.createImage();
    // A data URI loads locally: only a URL is cross-origin, and only a URL
    // can stall.
    const remote = isBase64Image(url) === false;
    if (remote === true) {
        img.crossOrigin = 'anonymous';
    }
    return new Promise((resolve, reject) => {
        const timeout = remote === true
            ? failAfterTimeout(platform, img, reject, `SVG loading timed out: ${url}`)
            : null;
        img.onload = () => {
            settled(timeout);
            resolve();
        };
        img.onerror = () => {
            settled(timeout);
            reject(new Error(`SVG loading failed: ${url}`));
        };
        img.src = url;
    }).then(() => {
        const targetW = firstSize(width, sw, img.naturalWidth, img.width);
        const targetH = firstSize(height, sh, img.naturalHeight, img.height);
        const ratio = ctx.pixelRatio > 1 ? ctx.pixelRatio : 1;
        const w = Math.max(1, Math.ceil(targetW * ratio));
        const h = Math.max(1, Math.ceil(targetH * ratio));
        const canvas = platform.createCanvas();
        canvas.width = w;
        canvas.height = h;
        const c2d = canvas.getContext('2d');
        if (sw !== null && sh !== null) {
            c2d.drawImage(img, sx ?? 0, sy ?? 0, sw, sh, 0, 0, w, h);
        }
        else {
            c2d.drawImage(img, 0, 0, w, h);
        }
        const imageData = () => {
            const data = c2d.getImageData(0, 0, w, h);
            freeCanvas(canvas);
            return { data, w, h, premultiply: true };
        };
        if (ctx.support === null) {
            return imageData();
        }
        return platform.createImageBitmap(canvas).then((bitmap) => {
            freeCanvas(canvas);
            return { data: bitmap, w, h, premultiply: false };
        }, imageData);
    });
}
//# sourceMappingURL=svg.js.map