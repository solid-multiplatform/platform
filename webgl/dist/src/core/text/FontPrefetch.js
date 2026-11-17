import { convertUrlToAbsolute } from '../../common/utils.js';
import { getDefaultPlatform, } from '../../platform/Platform.js';
import { WebPlatform } from '../../platform/WebPlatform.js';
const pool = new Map();
/** A rejection as null: a prefetch is an optimization, never an error. */
const orNull = (promise) => promise.then((value) => value, () => null);
/** Not null, and an object (an array is one). */
const isObject = (value) => value !== null && typeof value === 'object';
/**
 * An atlas description response as font data, or null when unusable:
 * engines without `responseType = 'json'` return the text, and one without
 * `chars`, `common`, `info` or `distanceField`, which parsing and layout
 * read unguarded, would fail its load with the TypeError parsing threw,
 * or, past parsing, throw in the scene pass, where no load could hear it.
 */
export function normalizeSdfData(response) {
    let data = response;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        }
        catch (e) {
            return null;
        }
    }
    if (isObject(data) === false) {
        return null;
    }
    const font = data;
    return isObject(font.chars) === true &&
        isObject(font.common) === true &&
        isObject(font.info) === true &&
        isObject(font.distanceField) === true
        ? font
        : null;
}
/**
 * Start a request: one that throws before it is out (a URL the host
 * cannot resolve, a fetch that throws at once) rejects, as a failed one
 * does, instead of throwing.
 */
export function startRequest(fetch, url, type) {
    try {
        return fetch(convertUrlToAbsolute(url), type);
    }
    catch (error) {
        return Promise.reject(error);
    }
}
/**
 * Start downloading an SDF font's atlas description and atlas image before
 * a renderer exists. The first call for a font (its first name) wins; it
 * never throws and never rejects.
 */
export function prefetchFont(options) {
    const family = options.fontFamily;
    const primary = Array.isArray(family) === true ? family[0] : family;
    if (primary === undefined ||
        options.type === 'canvas' ||
        options.atlasDataUrl === undefined ||
        pool.has(primary) === true) {
        return;
    }
    const Host = getDefaultPlatform();
    const platform = Host !== null ? new Host() : new WebPlatform();
    const fetch = (url, type) => platform.fetch(url, type);
    const atlasUrl = options.atlasUrl;
    pool.set(primary, {
        data: orNull(startRequest(fetch, options.atlasDataUrl, 'json')).then(normalizeSdfData),
        atlas: atlasUrl !== undefined
            ? orNull(startRequest(fetch, atlasUrl, 'blob')).then((blob) => blob !== null && typeof blob === 'object' ? blob : null)
            : Promise.resolve(null),
    });
}
/**
 * Claim the prefetch of the font whose first name is `name`, once: a load
 * that retries goes back to the network.
 */
export function takeSdfPrefetch(name) {
    const prefetched = pool.get(name);
    if (prefetched !== undefined) {
        pool.delete(name);
    }
    return prefetched;
}
/** Drop every unclaimed prefetch (requests in flight are not aborted). */
export function clearFontPrefetch() {
    pool.clear();
}
//# sourceMappingURL=FontPrefetch.js.map