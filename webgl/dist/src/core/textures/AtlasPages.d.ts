import { type TextureStore } from './TextureStore.js';
/** A page's side in texels: 4 MB of RGBA. */
export declare const PAGE_SIZE = 1024;
/**
 * Transparent texels around each image: LINEAR filtering at an image's
 * edge blends with them, never with a neighbour's pixels.
 */
export declare const PAGE_PADDING = 1;
/** Where pages go: GlBackend implements it. */
export interface PageSink {
    /** A page as texture `id`: `w` x `h` transparent texels. */
    createPage(id: number, w: number, h: number): void;
    uploadSubImage(id: number, x: number, y: number, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
}
/**
 * A shelf allocator over one page: rows filled left to
 * right, each as tall as the image that opened it, allocations rounded up
 * to 4 texels. A row takes an image at most as tall as it and more than
 * half its height, so images of one size share rows. Nothing is freed:
 * a page is emptied as a whole (AtlasPages).
 */
export declare class Shelf {
    readonly w: number;
    readonly h: number;
    /** Where the last successful alloc put its rectangle. */
    x: number;
    y: number;
    private rowY;
    private rowH;
    /** Each row's next free x. */
    private rowX;
    private rows;
    private nextY;
    constructor(w: number, h: number);
    /** Room for `w` x `h`: true with the position in x, y; false when full. */
    alloc(w: number, h: number): boolean;
    private grow;
}
/**
 * Shared RGBA pages for browser-decoded images (the `imageAtlas` setting;
 * docs/superpowers/plans/2026-10-18-renderer-v2-atlas-pages.md). An image
 * at most half a page on each side, padding included, is uploaded into a
 * page instead of a texture of its own, and its record's `drawId` becomes
 * the page's record, so quads of different images on one page batch into
 * one op. A page is a store record (KIND_PAGE) with the GL texture; it is
 * wanted while one of its images is, and it goes when its last image
 * does: freed by a memory cleanup (MemoryManager frees a page's images
 * together, once none is wanted) or failed. Holes are never reused.
 *
 * Pages belong to a group: the `atlasGroup` of the nearest ancestor (or
 * the node itself) of a node showing the image, read when it is placed,
 * and '' when none sets one. An image goes only onto pages of its group,
 * so a row that sets one keeps its images together: they batch together
 * and, unwanted together once the row scrolls away, free their pages
 * whole.
 */
export declare class AtlasPages {
    readonly pageSize: number;
    /** The largest side, padding included, that goes onto a page. */
    readonly maxSide: number;
    /** Page records, oldest first: an image goes onto the first with room. */
    readonly pages: number[];
    private readonly shelves;
    /** Each page's images. */
    private readonly members;
    /** Each page's group. */
    private readonly groups;
    private readonly store;
    private readonly sink;
    constructor(store: TextureStore, sink: PageSink, pageSize?: number);
    /**
     * Whether decoded image `rec`, `w` x `h`, goes onto a page: an image at
     * most half a page on each side with its padding, and not kept by
     * preventCleanup (a font atlas, which the SDF program samples by its own
     * UVs, or an app's pinned texture: a page holding one could never be
     * freed).
     */
    accepts(rec: number, w: number, h: number): boolean;
    /**
     * Room for `rec` (`w` x `h`) on the first page of its group that has it,
     * or on a new page: its drawId, slotX and slotY now place it there.
     * Returns the page.
     */
    place(rec: number, w: number, h: number): number;
    /**
     * The group `rec` goes into: the `atlasGroup` of the nearest node, from
     * the first node asking for it (or for a SubTexture of it) up to the
     * root, that sets one; '' when none does or nothing asks. The first
     * node decides for an image shown in two groups.
     */
    groupOf(rec: number): string;
    /** The group of `page`; '' for a page this atlas does not hold. */
    groupOfPage(page: number): string;
    /** Upload `rec`'s pixels into the slot `place` gave it. */
    upload(rec: number, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
    /**
     * `rec` leaves its page (freed, or its upload failed): its drawId is its
     * own again, and the page goes once it holds no image.
     */
    release(rec: number): void;
    /**
     * A memory cleanup may free `page` at `now`: none of its images is
     * wanted, kept by preventCleanup or within its grace period.
     */
    evictable(page: number, now: number): boolean;
    /**
     * Free every image on `page` (spec 9.5, by page): each reloads when
     * wanted again, and the last one takes the page with it.
     */
    freePage(page: number): void;
    /** Images on `page`, for tests and developer tools. */
    imagesOn(page: number): number;
    private take;
}
