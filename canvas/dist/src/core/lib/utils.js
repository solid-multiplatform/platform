// `file` is here so an absolute `file://` source passes through
// `convertUrlToAbsolute` untouched: on a non-browser host (NativeScript) the
// polyfilled `location` is empty, and resolving against it throws.
// `blob:` too: an object URL is absolute, and resolving it against a `file:`
// document would file it under the app folder.
export const PROTOCOL_REGEX = /^(blob|data|file|ftps?|https?):/;
// `location.protocol` cannot change at runtime, so resolve it once instead of
// re-reading it on every `convertUrlToAbsolute` call (once per image load).
// The `typeof` guard keeps this module importable where `self` is absent
// (unit tests run in vitest's node environment): evaluating it bare here
// would throw at import time, not at call time as the previous inline read did.
const IS_FILE_PROTOCOL = typeof self !== 'undefined' && self.location.protocol === 'file:';
export const getNormalizedRgbaComponents = (rgba) => {
    const r = rgba >>> 24;
    const g = (rgba >>> 16) & 0xff;
    const b = (rgba >>> 8) & 0xff;
    const a = rgba & 0xff;
    return [r / 255, g / 255, b / 255, a / 255];
};
/**
 * Derive `rect`'s scissor box from its logical rect.
 */
export const updateScissor = (rect, pixelRatio, canvasH) => {
    const scissorH = Math.round(rect.h * pixelRatio);
    rect.scissorX = Math.round(rect.x * pixelRatio);
    rect.scissorW = Math.round(rect.w * pixelRatio);
    rect.scissorH = scissorH;
    rect.scissorY = Math.round(canvasH - scissorH - rect.y * pixelRatio);
};
export function createBound(x1, y1, x2, y2, out) {
    if (out) {
        out.x1 = x1;
        out.y1 = y1;
        out.x2 = x2;
        out.y2 = y2;
        return out;
    }
    return {
        x1,
        y1,
        x2,
        y2,
    };
}
export function intersectRect(a, b, out) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    if (w > 0 && h > 0) {
        if (out) {
            out.x = x;
            out.y = y;
            out.w = w;
            out.h = h;
            return out;
        }
        return {
            x,
            y,
            w,
            h,
        };
    }
    if (out) {
        out.x = 0;
        out.y = 0;
        out.w = 0;
        out.h = 0;
        return out;
    }
    return {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    };
}
export function copyRect(a, out) {
    if (out) {
        out.x = a.x;
        out.y = a.y;
        out.w = a.w;
        out.h = a.h;
        return out;
    }
    return {
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
    };
}
export function compareRect(a, b) {
    if (a === b) {
        return true;
    }
    if (a === null || b === null) {
        return false;
    }
    const aValid = a.valid;
    const bValid = b.valid;
    if (aValid === false && bValid === false) {
        return true;
    }
    if (aValid !== bValid) {
        return false;
    }
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
export function convertUrlToAbsolute(url) {
    const hasProtocol = PROTOCOL_REGEX.test(url);
    // handle local file imports if the url isn't remote resource or data blob
    if (IS_FILE_PROTOCOL === true && hasProtocol === false) {
        const path = self.location.pathname.split('/');
        path.pop();
        const basePath = path.join('/');
        const baseUrl = self.location.protocol + '//' + basePath;
        // check if url has a leading dot
        if (url.charAt(0) === '.') {
            url = url.slice(1);
        }
        // check if url has a leading slash
        if (url.charAt(0) === '/') {
            url = url.slice(1);
        }
        return baseUrl + '/' + url;
    }
    // Already absolute: `new URL(url, base).href` round-trips it unchanged, so
    // skip the parse/normalize/allocate/re-serialize. Every remote image URL
    // hits this path, and the URL constructor is expensive enough to show up
    // in the per-image texture dispatch cost on a TV SoC.
    // The output feeds only the fetch (loadImage/loadSvg), never a cache key
    // (ImageTexture.makeCacheKey uses the raw `props.src`), so skipping
    // normalization here cannot split cache entries.
    if (hasProtocol === true) {
        return url;
    }
    // Nothing to resolve against outside a browser-shaped global (a node test,
    // say): the url is what it is.
    if (typeof self === 'undefined') {
        return url;
    }
    const absoluteUrl = new URL(url, self.location.href);
    return absoluteUrl.href;
}
export function isBase64Image(src) {
    return src.startsWith('data:') === true;
}
export function valuesAreEqual(values) {
    let prevValue = values[0];
    for (let i = 1; i < values.length; i++) {
        if (prevValue !== values[i]) {
            return false;
        }
    }
    return true;
}
export function calcFactoredRadiusArray(radius, width, height) {
    const result = [
        radius[0],
        radius[1],
        radius[2],
        radius[3],
    ];
    const factor = Math.min(Math.min(Math.min(width / Math.max(width, radius[0] + radius[1]), width / Math.max(width, radius[2] + radius[3])), Math.min(height / Math.max(height, radius[0] + radius[3]), height / Math.max(height, radius[1] + radius[2]))), 1);
    result[0] *= factor;
    result[1] *= factor;
    result[2] *= factor;
    result[3] *= factor;
    return result;
}
export function dataURIToBlob(dataURI) {
    dataURI = dataURI.replace(/^data:/, '');
    const type = dataURI.match(/image\/[^;]+/)?.[0] || '';
    const base64 = dataURI.replace(/^[^,]+,/, '');
    const sliceSize = 1024;
    const byteCharacters = atob(base64);
    const bytesLength = byteCharacters.length;
    const slicesCount = Math.ceil(bytesLength / sliceSize);
    const byteArrays = new Array(slicesCount);
    for (let sliceIndex = 0; sliceIndex < slicesCount; ++sliceIndex) {
        const begin = sliceIndex * sliceSize;
        const end = Math.min(begin + sliceSize, bytesLength);
        const bytes = new Array(end - begin);
        for (let offset = begin, i = 0; offset < end; ++i, ++offset) {
            bytes[i] = byteCharacters[offset]?.charCodeAt(0);
        }
        byteArrays[sliceIndex] = new Uint8Array(bytes);
    }
    return new Blob(byteArrays, { type });
}
/**
 * GET `url` with XMLHttpRequest and resolve with its response. The one
 * main-thread fetcher (the image worker keeps its own copy: it runs from
 * stringified source).
 *
 * Resolves on any 2xx, and on status 0 when there is a response: WebOS and
 * Tizen report 0 for a successful `file://` load. A network error also
 * reports 0 but carries no response, so it rejects.
 */
export function fetchResource(url, responseType = '') {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = responseType;
        xhr.onreadystatechange = function () {
            // The literal, not `XMLHttpRequest.DONE`: the value is fixed by the
            // spec, and a polyfilled XMLHttpRequest (NativeScript's) exposes the
            // constants on instances only, where the static read is `undefined`
            // and this callback would never resolve.
            if (xhr.readyState !== 4) {
                return;
            }
            const status = xhr.status;
            if ((status >= 200 && status < 300) ||
                (status === 0 && xhr.response !== null)) {
                resolve(xhr.response);
                return;
            }
            reject(new Error(status === 0
                ? `Network error loading ${url}`
                : `HTTP ${status} ${xhr.statusText} loading ${url}`));
        };
        xhr.open('GET', url, true);
        xhr.send(null);
    });
}
/**
 * Clamp a {@link UnitInterval}-typed value into [0, 1].
 *
 * @remarks
 * `UnitInterval` documents the contract but TypeScript cannot enforce a
 * numeric range, so the range is applied where the value is read. Both
 * backends clamp so an out-of-contract `resizeMode.clipX`/`clipY` renders the
 * same on WebGL and Canvas2D instead of sampling outside the texture.
 */
export function clampUnit(value) {
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
//# sourceMappingURL=utils.js.map