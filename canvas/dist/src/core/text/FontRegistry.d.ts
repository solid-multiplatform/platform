import type { FontLoadOptions, FontMetrics } from '../../common/types.js';
import type { FetchResponseType } from '../../platform/Platform.js';
import { type ImageTexture } from '../textures/Texture.js';
import { type TextureStore } from '../textures/TextureStore.js';
import { type SdfFont } from './sdfFont.js';
/**
 * Retries of a failed atlas description request (1.10's count): it is
 * tried up to four times in all, at the textures' backoff. The atlas image
 * retries as any texture does (`maxRetryCount`).
 */
export declare const MAX_FONT_LOAD_RETRIES = 3;
/**
 * One loaded or loading font, under every name it was registered with
 * (`names`: its first name, then those of the others no other load held).
 * Its description (`font`) arrives first: text lays out from it. Its atlas
 * (`rec`, a texture record held wanted, referenced and never cleaned up)
 * arrives next: glyphs draw from it once `ready`.
 */
export declare class FontRecord {
    /** Unique per registry: what layouts are cached under. */
    readonly id: number;
    readonly names: string[];
    readonly atlasUrl: string;
    readonly atlasDataUrl: string;
    readonly metrics: FontMetrics | undefined;
    /** The parsed atlas description; null until it arrives. */
    font: SdfFont | null;
    /** The atlas texture's handle, and its record (the op texture id): NULL until made. */
    atlas: ImageTexture | null;
    rec: number;
    /** The atlas is uploaded: glyphs of this font draw. */
    ready: boolean;
    /** Why the load failed for good; null otherwise. */
    error: Error | null;
    /** Failed atlas description requests. */
    failures: number;
    readonly promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    /** The atlas listeners, kept to be removed. */
    onLoaded: (() => void) | null;
    onFailed: ((target: unknown, error: Error) => void) | null;
    constructor(id: number, names: string[], options: FontLoadOptions);
}
/**
 * The renderer's SDF fonts (spec 10.1): `loadFont`, aliases, one load
 * shared by every request for a name in flight, retries, and the atlas as
 * an ordinary texture with `preventCleanup`. What text nodes wait on is
 * TextNodes': it hears every change of a font through `onChange`.
 */
export declare class FontRegistry {
    /** The platform's fetch (the Renderer); null headless, where a load fails. */
    fetch: ((url: string, type: FetchResponseType) => Promise<unknown>) | null;
    /** A timer for a retry (the Renderer: the platform's); null: no retry. */
    schedule: ((callback: () => void, ms: number) => void) | null;
    /**
     * A font's description arrived, its atlas did, or its load failed for
     * good (`error` set): TextNodes wakes, or tells, the nodes waiting on it.
     */
    onChange: ((font: FontRecord) => void) | null;
    /** Fonts loading: the description or the atlas on its way, or a retry to come. */
    pending: number;
    private readonly textures;
    private readonly byName;
    private nextId;
    private destroyed;
    constructor(textures: TextureStore);
    /** The font registered under `name`, loaded or loading; undefined otherwise. */
    get(name: string): FontRecord | undefined;
    /**
     * Load a font under its names (1.10 loadFont): the first name of
     * `fontFamily` keys the load, the others and `aliases` share it. A name
     * loaded already resolves at once, one in flight returns that load's
     * promise; a font whose load failed for good loads again. A later name
     * that another load holds stays with that load (first wins, as for the
     * first name): the font is registered under the others.
     */
    load(options: FontLoadOptions): Promise<void>;
    /**
     * The renderer is destroyed: nothing a load in flight does changes
     * anything afterwards, and its promise never settles.
     */
    destroy(): void;
    /**
     * A load of a destroyed registry. Nothing else makes one stale: no
     * callback of a load remains once it failed, and none other replaces it
     * under its names (1.10 settled both of two loads sharing a name).
     */
    private stale;
    private fetchData;
    /** One request for the atlas description. */
    private request;
    private dataFailed;
    /**
     * The description arrived, parsed: text lays out from it now, and the
     * atlas loads (the prefetched image when there is one, else its URL).
     */
    private dataArrived;
    /**
     * The atlas texture: straight alpha (its channels are distances), cached
     * by its URL whether it came prefetched or not, so two fonts on one atlas
     * share it; referenced, wanted and never cleaned up while the font
     * lives. A prefetched image is tried once: a failure goes back to the
     * network (atlasFailed).
     */
    private makeAtlas;
    private atlasArrived;
    /**
     * The atlas failed for good: its texture record goes once nothing else
     * holds it, so a later load makes a new one instead of finding this one
     * in the cache. What failed decides, not what the font asked for (the
     * cache hands every font on an atlas the one record): when it was a
     * prefetched image (tried once), the font loads the atlas from its URL
     * at once, as 1.10 dropped a failed atlas for every font, each then
     * retrying from the network; when it was the URL, the font fails. A
     * failed image still held (by another font on it that has not heard the
     * failure yet, or an image of the same file) leaves the cache first, so
     * the URL load makes a new record, which the other fonts on the image
     * share when they hear the failure.
     */
    private atlasFailed;
    /**
     * The load failed for good: its names are free for a new load, its
     * promise rejects, and the nodes waiting on it hear `failed` and keep
     * waiting (a later load of the name wakes them).
     */
    private fail;
    private unlisten;
    private changed;
}
