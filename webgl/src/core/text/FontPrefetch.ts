import type { FontLoadOptions } from '../../common/types.js';
import { convertUrlToAbsolute } from '../../common/utils.js';
import {
  getDefaultPlatform,
  type FetchResponseType,
} from '../../platform/Platform.js';
import { WebPlatform } from '../../platform/WebPlatform.js';
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

const pool = new Map<string, PrefetchedSdfFont>();

/** A rejection as null: a prefetch is an optimization, never an error. */
const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.then(
    (value) => value,
    () => null,
  );

/** Not null, and an object (an array is one). */
const isObject = (value: unknown): boolean =>
  value !== null && typeof value === 'object';

/**
 * An atlas description response as font data, or null when unusable:
 * engines without `responseType = 'json'` return the text, and one without
 * `chars`, `common`, `info` or `distanceField`, which parsing and layout
 * read unguarded, would fail its load with the TypeError parsing threw,
 * or, past parsing, throw in the scene pass, where no load could hear it.
 */
export function normalizeSdfData(response: unknown): SdfFontData | null {
  let data = response;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  if (isObject(data) === false) {
    return null;
  }
  const font = data as SdfFontData;
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
export function startRequest(
  fetch: (url: string, type: FetchResponseType) => Promise<unknown>,
  url: string,
  type: FetchResponseType,
): Promise<unknown> {
  try {
    return fetch(convertUrlToAbsolute(url), type);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Start downloading an SDF font's atlas description and atlas image before
 * a renderer exists. The first call for a font (its first name) wins; it
 * never throws and never rejects.
 */
export function prefetchFont(options: FontPrefetchOptions): void {
  const family = options.fontFamily;
  const primary = Array.isArray(family) === true ? family[0] : family;
  if (
    primary === undefined ||
    options.type === 'canvas' ||
    options.atlasDataUrl === undefined ||
    pool.has(primary) === true
  ) {
    return;
  }
  const Host = getDefaultPlatform();
  const platform = Host !== null ? new Host() : new WebPlatform();
  const fetch = (url: string, type: FetchResponseType): Promise<unknown> =>
    platform.fetch(url, type);
  const atlasUrl = options.atlasUrl;
  pool.set(primary, {
    data: orNull(startRequest(fetch, options.atlasDataUrl, 'json')).then(
      normalizeSdfData,
    ),
    atlas:
      atlasUrl !== undefined
        ? orNull(startRequest(fetch, atlasUrl, 'blob')).then((blob) =>
            blob !== null && typeof blob === 'object' ? (blob as Blob) : null,
          )
        : Promise.resolve(null),
  });
}

/**
 * Claim the prefetch of the font whose first name is `name`, once: a load
 * that retries goes back to the network.
 */
export function takeSdfPrefetch(name: string): PrefetchedSdfFont | undefined {
  const prefetched = pool.get(name);
  if (prefetched !== undefined) {
    pool.delete(name);
  }
  return prefetched;
}

/** Drop every unclaimed prefetch (requests in flight are not aborted). */
export function clearFontPrefetch(): void {
  pool.clear();
}
