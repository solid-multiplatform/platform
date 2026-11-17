import type { FontLoadOptions } from '../../common/types.js';
import { type FetchResponseType } from '../../platform/Platform.js';
import type { SdfFontData } from './sdfFont.js';
/**
 * Font prefetching, stage-free (ported from 1.10): an app starts a font's
 * downloads before it constructs the renderer, so they overlap the boot
 * instead of following it, and `loadFont` claims the results. The pool is
 * module state by necessity (nothing else exists yet); the requests go
 * through the registered default platform's fetch, or the web platform's.
 */
/**
 * A prefetched SDF font: its atlas description and its atlas image,
 * fetched at once. Either resolves to null when its request failed, and
 * the load then fetches it itself.
 */
export interface PrefetchedSdfFont {
    data: Promise<SdfFontData | null>;
    atlas: Promise<Blob | null>;
}
/**
 * `loadFont`'s options plus the `type` a framework's font descriptor
 * carries (Solid's `msdf` or `ssdf`); a `canvas` descriptor is ignored:
 * v2 draws SDF text only.
 */
export type FontPrefetchOptions = FontLoadOptions & {
    type?: 'ssdf' | 'msdf' | 'canvas';
};
/**
 * An atlas description response as font data, or null when unusable:
 * engines without `responseType = 'json'` return the text, and one without
 * `chars`, `common`, `info` or `distanceField`, which parsing and layout
 * read unguarded, would fail its load with the TypeError parsing threw,
 * or, past parsing, throw in the scene pass, where no load could hear it.
 */
export declare function normalizeSdfData(response: unknown): SdfFontData | null;
/**
 * Start a request: one that throws before it is out (a URL the host
 * cannot resolve, a fetch that throws at once) rejects, as a failed one
 * does, instead of throwing.
 */
export declare function startRequest(fetch: (url: string, type: FetchResponseType) => Promise<unknown>, url: string, type: FetchResponseType): Promise<unknown>;
/**
 * Start downloading an SDF font's atlas description and atlas image before
 * a renderer exists. The first call for a font (its first name) wins; it
 * never throws and never rejects.
 */
export declare function prefetchFont(options: FontPrefetchOptions): void;
/**
 * Claim the prefetch of the font whose first name is `name`, once: a load
 * that retries goes back to the network.
 */
export declare function takeSdfPrefetch(name: string): PrefetchedSdfFont | undefined;
/** Drop every unclaimed prefetch (requests in flight are not aborted). */
export declare function clearFontPrefetch(): void;
