import { isProductionEnvironment } from './flags.js';
/**
 * Throws when `condition` is falsy in development builds; a no-op in
 * production. Narrows the type of `condition` for TypeScript either way.
 */
export function assertTruthy(condition, message) {
    if (isProductionEnvironment === true)
        return;
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}
// `file` so an absolute `file://` source passes through untouched (a
// non-browser host's polyfilled location is empty and resolving against it
// throws); `blob` since an object URL is absolute.
const PROTOCOL_REGEX = /^(blob|data|file|ftps?|https?):/;
// location.protocol cannot change at runtime: read it once (guarded, so the
// module imports where `self` is absent, as in node tests).
const IS_FILE_PROTOCOL = typeof self !== 'undefined' && self.location.protocol === 'file:';
// Resolves relative URLs where there is a document; created on first use.
let resolver = null;
/**
 * An image URL made absolute for the image worker, which resolves against
 * its own blob: URL, not the document (ported from 1.10). An absolute URL
 * returns unchanged without the URL constructor's cost; under a `file:`
 * document a relative path joins the document's folder.
 *
 * With a document, an `<a>` element resolves the URL: legacy builds polyfill
 * `URL` on old engines (Chrome 38 lacks `searchParams`, so core-js replaces
 * it with a JavaScript parser), which took a quarter of the main thread on
 * a webOS 3 TV while posters loaded.
 */
export function convertUrlToAbsolute(url) {
    const hasProtocol = PROTOCOL_REGEX.test(url);
    if (IS_FILE_PROTOCOL === true && hasProtocol === false) {
        const path = self.location.pathname.split('/');
        path.pop();
        const baseUrl = self.location.protocol + '//' + path.join('/');
        if (url.charAt(0) === '.') {
            url = url.slice(1);
        }
        if (url.charAt(0) === '/') {
            url = url.slice(1);
        }
        return baseUrl + '/' + url;
    }
    if (hasProtocol === true || typeof self === 'undefined') {
        return url;
    }
    if (typeof document !== 'undefined') {
        if (resolver === null) {
            resolver = document.createElement('a');
        }
        resolver.href = url;
        return resolver.href;
    }
    return new URL(url, self.location.href).href;
}
/** A `data:` URI (decoded on the main thread: no fetch, no worker). */
export function isBase64Image(src) {
    // The prefix alone, as startsWith reads it. Not startsWith: Chrome 41,
    // above the Chrome 38 floor.
    return src.lastIndexOf('data:', 0) === 0;
}
/** A base64 `data:` URI as a Blob of its MIME type (ported from 1.10). */
export function dataURIToBlob(dataURI) {
    dataURI = dataURI.replace(/^data:/, '');
    const match = dataURI.match(/image\/[^;]+/);
    const type = match === null ? '' : match[0];
    const byteCharacters = atob(dataURI.replace(/^[^,]+,/, ''));
    const bytes = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = byteCharacters.charCodeAt(i);
    }
    return new Blob([bytes], { type });
}
//# sourceMappingURL=utils.js.map