import { EventEmitter } from '../../common/EventEmitter.js';
import type { Dimensions } from '../../common/types.js';
import { type TextureStore } from './TextureStore.js';
/** 1.10's texture type values. */
export declare enum TextureType {
    generic = 0,
    color = 1,
    image = 2,
    noise = 3,
    subTexture = 4
}
/** 1.10's texture states, as the handle reports them. */
export type TextureState = 'initial' | 'loading' | 'fetched' | 'loaded' | 'failed' | 'freed';
/**
 * The handle's state by record state (idle, queued, loading, decoded,
 * uploaded, failed, freed); the inspector reads it too.
 */
export declare const TEXTURE_STATE_NAMES: TextureState[];
/**
 * The public texture handle (spec 9.1): a thin view of one record in the
 * TextureStore, with a lazy event emitter for `loaded` (dimensions),
 * `failed` (the error) and `freed`. Events are delivered after the frame's
 * draw. `id` is the record id; the handle also keeps, internally, the slot
 * generation it was bound at, so a record removed since
 * (TextureStore.destroy) reads as freed, even through a handle that was not
 * the record's own.
 */
export declare class Texture extends EventEmitter {
    id: number;
    /** Internal: the slot generation the handle was bound at (TextureStore.gen). */
    _gen: number;
    /** Internal: the last preventCleanup written, applied again on revival. */
    _keep: boolean;
    readonly type: TextureType;
    readonly props: object;
    protected readonly store: TextureStore;
    constructor(store: TextureStore, id: number, type: TextureType, props: object);
    /** 'freed' once its record was removed (it reloads when used again). */
    get state(): TextureState;
    /** The pixel size once uploaded, else null. */
    get dimensions(): Dimensions | null;
    get error(): Error | null;
    /** Never evicted under memory pressure while set. */
    get preventCleanup(): boolean;
    set preventCleanup(v: boolean);
    /**
     * Load the pixels now, without a node wanting them (1.10's load()): to
     * have a texture uploaded before a node shows it. A SubTexture loads its
     * sheet. Once uploaded it is freed by a cleanup like any texture nobody
     * wants, unless preventCleanup is set: set it before load() to keep the
     * texture until a node shows it, and clear it then.
     */
    load(): void;
}
/** `handle`'s record, or NULL once it was removed. */
export declare function liveRecord(store: TextureStore, handle: Texture): number;
/** ImageTexture props (1.10). */
export interface ImageTextureProps {
    /** A URL, a Blob, ImageData, or a function returning ImageData. */
    src?: string | Blob | ImageData | (() => ImageData | null);
    /** Premultiply the alpha into the colours on upload. Default true. */
    premultiplyAlpha?: boolean | null;
    /** Cache key for a source that is not a string. */
    key?: string | null;
    /** Raster size for an SVG; ignored otherwise. */
    w?: number | null;
    h?: number | null;
    /** Override type detection. */
    type?: 'regular' | 'compressed' | 'svg' | null;
    /** A crop taken at decode time (createImageBitmap), when sw and sh are set. */
    sx?: number | null;
    sy?: number | null;
    sw?: number | null;
    sh?: number | null;
    /** Retries after a failed load. Default: the renderer's maxRetryCount. */
    maxRetryCount?: number;
}
/**
 * A texture loaded from an image source (spec 9.3). Its props are its
 * record's: a copy with every default filled in (1.10 resolveDefaults).
 */
export declare class ImageTexture extends Texture {
    readonly props: Required<ImageTextureProps>;
    static z$__type__Props: ImageTextureProps;
}
/** SubTexture props (1.10): a region, in pixels, of a parent texture. */
export interface SubTextureProps {
    texture: Texture;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
}
/**
 * A region of a parent texture (a sprite sheet): it draws its parent's GL
 * texture through its own UVs (spec 9.6), so sprites of one sheet batch.
 * It reports its parent's state and error, and its region's size, and its
 * preventCleanup is the parent's, which holds the pixels. A region of a
 * SubTexture is made a region of that one's sheet, the offsets added up
 * (1.10 accepted only an ImageTexture parent). Made on a parent already
 * loaded, failed or freed, it hears that (RendererCore.createTexture) after
 * the frame's draw or from a zero-delay timer (1.10: a microtask).
 */
export declare class SubTexture extends Texture {
    readonly props: Required<SubTextureProps>;
    static z$__type__Props: SubTextureProps;
    /** The texture whose pixels it shows (1.10's name). */
    get parentTexture(): Texture;
    get state(): TextureState;
    get dimensions(): Dimensions | null;
    get error(): Error | null;
    get preventCleanup(): boolean;
    set preventCleanup(v: boolean);
}
/** ColorTexture props (1.10). */
export interface ColorTextureProps {
    /** Default 0xffffffff. Read as 0xAARRGGBB, as 1.10 did. */
    color?: number;
}
/** A 1x1 pixel of one colour, stretched over the node. */
export declare class ColorTexture extends Texture {
    readonly props: Required<ColorTextureProps>;
    static z$__type__Props: ColorTextureProps;
    get color(): number;
}
/** NoiseTexture props (1.10). */
export interface NoiseTextureProps {
    /** Default 128. */
    w?: number;
    /** Default 128. */
    h?: number;
    /** Set to cache it (a different value gives a different noise). */
    cacheId?: number;
}
/** Random grey pixels, generated when first wanted. */
export declare class NoiseTexture extends Texture {
    readonly props: NoiseTextureProps;
    static z$__type__Props: NoiseTextureProps;
}
/** The built-in texture types createTexture accepts (1.10). */
export interface TextureMap {
    ImageTexture: typeof ImageTexture;
    SubTexture: typeof SubTexture;
    ColorTexture: typeof ColorTexture;
    NoiseTexture: typeof NoiseTexture;
}
export type ExtractProps<Type> = Type extends {
    z$__type__Props: infer Props;
} ? Props : never;
/**
 * 1.10's ImageTexture cache key: the key (or a string src), premultiply,
 * and a crop when sw and sh are set; null for a source with no string
 * identity, which is then not cached.
 */
export declare function imageKey(src: unknown, key: string | null | undefined, premultiplyAlpha: boolean | null | undefined, sx: number | null | undefined, sy: number | null | undefined, sw: number | null | undefined, sh: number | null | undefined): string | null;
/**
 * The record a node shows for `handle`: its own, or, once that was removed
 * (MemoryManager), a record it gets back (reviveTexture).
 */
export declare function textureRecord(store: TextureStore, handle: Texture): number;
/**
 * A handle whose record was removed as an orphan (MemoryManager) reads as
 * freed; used again, it gets a record back (a cached one for the same
 * source, or a new one), as a destroyed 1.10 texture reloaded when used,
 * with the preventCleanup it was given.
 */
export declare function reviveTexture(store: TextureStore, handle: Texture): number;
/**
 * renderer.createTexture (spec 9.1): the record is created now and loads
 * when a node in bounds, or a preloading node, wants its pixels. A cached
 * source returns the handle it already has.
 */
export declare function createTexture<Type extends keyof TextureMap>(store: TextureStore, type: Type, props: ExtractProps<TextureMap[Type]>): InstanceType<TextureMap[Type]>;
