/*
 * Font prefetching — stage-free.
 *
 * Font bytes normally only start moving once a Stage exists, because
 * `Stage.loadFont()` is the only entry point. That serializes the network
 * behind the whole synchronous boot (GL context, buffers, shaders, root node)
 * and, for SDF, behind the texture manager's async init as well.
 *
 * Nothing about *fetching* a font needs a Stage: the SDF atlas is a JSON
 * document plus an image, and a web font is a `FontFace`. This module starts
 * that work as early as an app can call it — typically before the renderer is
 * constructed — and parks the results. The font handlers pick them up from
 * here when `loadFont()` eventually runs, so the round-trip overlaps CPU boot
 * instead of following it.
 *
 * Everything here uses XHR rather than `fetch` to match the rest of the
 * renderer (Chrome 38 / webOS 3 have no `fetch`).
 */
import { convertUrlToAbsolute, fetchResource } from '../lib/utils.js';
const sdfPrefetch = new Map();
const canvasPrefetch = new Map();
/**
 * Swallow a rejection into `null` so a prefetch that fails can never surface
 * as an unhandled rejection. A prefetch is an optimization: when it fails the
 * handler just does the work itself.
 */
const orNull = (promise) => promise.then((value) => value, () => null);
/**
 * Normalize an atlas description response into usable font data, or `null` if
 * it is unusable.
 *
 * A request that fails outright is already `null` here (`orNull`), and a 2xx
 * with an empty or unparseable body arrives as `null` too. Engines without
 * `responseType = 'json'` support hand back the raw string instead of a parsed
 * object — the SDF handler tolerates both, so this does too.
 */
const normalizeSdfData = (response) => {
    let data = response;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        }
        catch (e) {
            return null;
        }
    }
    if (data === null || typeof data !== 'object') {
        return null;
    }
    // Reject anything the handler would reject anyway, so a malformed prefetch
    // falls back to a fresh fetch instead of failing the load outright.
    return data.chars !== undefined
        ? data
        : null;
};
/**
 * Start downloading a font before a renderer exists.
 *
 * Safe to call more than once for the same font — the first call wins and
 * later ones are ignored. Never throws and never rejects; failures degrade to
 * the handler's normal load path.
 *
 * The descriptor decides what is fetched: an `atlasDataUrl` means an SDF font
 * (atlas JSON + atlas image, in parallel), otherwise a `fontUrl` means a web
 * font (`FontFace.load()`).
 *
 * @param options - The same options later passed to `Stage.loadFont()`
 */
export const prefetchFont = (options) => {
    const { fontFamily, fontUrl, atlasUrl, atlasDataUrl } = options;
    const names = Array.isArray(fontFamily) ? fontFamily : [fontFamily];
    const primary = names[0];
    if (primary === undefined) {
        return;
    }
    // SDF: atlas description and atlas image are independent requests. The
    // handler fetches them sequentially (it needs the JSON before it knows the
    // atlas is usable); here there is no such constraint, so overlap them.
    if (atlasDataUrl !== undefined && options.type !== 'canvas') {
        if (sdfPrefetch.has(primary) === true) {
            return;
        }
        sdfPrefetch.set(primary, {
            data: orNull(fetchResource(convertUrlToAbsolute(atlasDataUrl), 'json')).then(normalizeSdfData),
            atlas: atlasUrl !== undefined
                ? orNull(fetchResource(convertUrlToAbsolute(atlasUrl), 'blob')).then((blob) => (blob instanceof Blob ? blob : null))
                : Promise.resolve(null),
        });
        return;
    }
    // Web font: `FontFace.load()` starts the download immediately. The face is
    // not registered with the document here — that needs the platform, so the
    // handler does it at attach time.
    if (fontUrl !== undefined) {
        if (canvasPrefetch.has(primary) === true) {
            return;
        }
        if (typeof FontFace === 'undefined') {
            return;
        }
        canvasPrefetch.set(primary, orNull(Promise.all(names.map((name) => new FontFace(name, `url(${fontUrl})`).load()))));
    }
};
/**
 * Claim a prefetched SDF font, removing it from the pool.
 *
 * One-shot by design: a load that fails and retries must go back to the
 * network rather than replaying a stale (possibly failed) prefetch.
 *
 * @param fontFamily - Primary font family name
 */
export const takeSdfPrefetch = (fontFamily) => {
    const prefetched = sdfPrefetch.get(fontFamily);
    if (prefetched !== undefined) {
        sdfPrefetch.delete(fontFamily);
    }
    return prefetched;
};
/**
 * Claim prefetched web font faces, removing them from the pool. One-shot for
 * the same reason as {@link takeSdfPrefetch}.
 *
 * @param fontFamily - Primary font family name
 */
export const takeCanvasPrefetch = (fontFamily) => {
    const prefetched = canvasPrefetch.get(fontFamily);
    if (prefetched !== undefined) {
        canvasPrefetch.delete(fontFamily);
    }
    return prefetched;
};
/**
 * Drop every pending prefetch. Test/teardown helper — in-flight requests are
 * not aborted, their results are simply no longer claimable.
 */
export const clearFontPrefetch = () => {
    sdfPrefetch.clear();
    canvasPrefetch.clear();
};
//# sourceMappingURL=FontPrefetch.js.map