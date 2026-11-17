import type { FontLoadOptions } from './TextRenderer.js';
import type { SdfFontData } from './SdfFontHandler.js';
/**
 * A prefetched SDF font: the parsed atlas description and the atlas image,
 * fetched concurrently. Either promise resolves to `null` if its request
 * failed — the handler then falls back to its normal load path rather than
 * inheriting the failure.
 */
export interface PrefetchedSdfFont {
    data: Promise<SdfFontData | null>;
    atlas: Promise<Blob | null>;
}
/**
 * Options accepted by {@link prefetchFont}. Identical to the options passed to
 * `Stage.loadFont()`, plus the optional SDF `type` discriminator that
 * framework layers already carry on their font descriptors.
 */
export type FontPrefetchOptions = FontLoadOptions & {
    type?: 'ssdf' | 'msdf' | 'canvas';
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
export declare const prefetchFont: (options: FontPrefetchOptions) => void;
/**
 * Claim a prefetched SDF font, removing it from the pool.
 *
 * One-shot by design: a load that fails and retries must go back to the
 * network rather than replaying a stale (possibly failed) prefetch.
 *
 * @param fontFamily - Primary font family name
 */
export declare const takeSdfPrefetch: (fontFamily: string) => PrefetchedSdfFont | undefined;
/**
 * Claim prefetched web font faces, removing them from the pool. One-shot for
 * the same reason as {@link takeSdfPrefetch}.
 *
 * @param fontFamily - Primary font family name
 */
export declare const takeCanvasPrefetch: (fontFamily: string) => Promise<FontFace[] | null> | undefined;
/**
 * Drop every pending prefetch. Test/teardown helper — in-flight requests are
 * not aborted, their results are simply no longer claimable.
 */
export declare const clearFontPrefetch: () => void;
