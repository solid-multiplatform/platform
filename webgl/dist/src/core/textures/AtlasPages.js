import { NULL } from '../nodes/NodeFlags.js';
import { I_PARENT, I_STRIDE } from '../nodes/NodeLayout.js';
import { GRACE_PERIOD } from './MemoryManager.js';
import { F_PREVENT_CLEANUP, KIND_IMAGE, } from './TextureStore.js';
/** A page's side in texels: 4 MB of RGBA. */
export const PAGE_SIZE = 1024;
/**
 * Transparent texels around each image: LINEAR filtering at an image's
 * edge blends with them, never with a neighbour's pixels.
 */
export const PAGE_PADDING = 1;
/** Up to the next multiple of 4: a compressed page's 4x4 blocks fit the same shelves. */
const pad4 = (n) => (n + 3) & ~3;
/**
 * A shelf allocator over one page: rows filled left to
 * right, each as tall as the image that opened it, allocations rounded up
 * to 4 texels. A row takes an image at most as tall as it and more than
 * half its height, so images of one size share rows. Nothing is freed:
 * a page is emptied as a whole (AtlasPages).
 */
export class Shelf {
    constructor(w, h) {
        /** Where the last successful alloc put its rectangle. */
        this.x = 0;
        this.y = 0;
        this.rowY = new Int32Array(16);
        this.rowH = new Int32Array(16);
        /** Each row's next free x. */
        this.rowX = new Int32Array(16);
        this.rows = 0;
        this.nextY = 0;
        this.w = w;
        this.h = h;
    }
    /** Room for `w` x `h`: true with the position in x, y; false when full. */
    alloc(w, h) {
        w = pad4(w);
        h = pad4(h);
        if (w > this.w || h > this.h) {
            return false;
        }
        const rowY = this.rowY;
        const rowH = this.rowH;
        const rowX = this.rowX;
        for (let i = 0; i < this.rows; i++) {
            const rh = rowH[i];
            if (h <= rh && h * 2 > rh && rowX[i] + w <= this.w) {
                this.x = rowX[i];
                this.y = rowY[i];
                rowX[i] = this.x + w;
                return true;
            }
        }
        if (this.nextY + h > this.h) {
            return false;
        }
        const n = this.rows;
        if (n === rowY.length) {
            this.grow();
        }
        this.rowY[n] = this.nextY;
        this.rowH[n] = h;
        this.rowX[n] = w;
        this.rows = n + 1;
        this.x = 0;
        this.y = this.nextY;
        this.nextY += h;
        return true;
    }
    grow() {
        const n = this.rowY.length * 2;
        const y = new Int32Array(n);
        const h = new Int32Array(n);
        const x = new Int32Array(n);
        y.set(this.rowY);
        h.set(this.rowH);
        x.set(this.rowX);
        this.rowY = y;
        this.rowH = h;
        this.rowX = x;
    }
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
export class AtlasPages {
    constructor(store, sink, pageSize = PAGE_SIZE) {
        /** Page records, oldest first: an image goes onto the first with room. */
        this.pages = [];
        this.shelves = [];
        /** Each page's images. */
        this.members = [];
        /** Each page's group. */
        this.groups = [];
        this.store = store;
        this.sink = sink;
        this.pageSize = pageSize;
        this.maxSide = pageSize / 2;
        store.onReleased = (rec) => {
            this.release(rec);
        };
    }
    /**
     * Whether decoded image `rec`, `w` x `h`, goes onto a page: an image at
     * most half a page on each side with its padding, and not kept by
     * preventCleanup (a font atlas, which the SDF program samples by its own
     * UVs, or an app's pinned texture: a page holding one could never be
     * freed).
     */
    accepts(rec, w, h) {
        const store = this.store;
        const max = this.maxSide - 2 * PAGE_PADDING;
        return (store.kind[rec] === KIND_IMAGE &&
            (store.flags[rec] & F_PREVENT_CLEANUP) === 0 &&
            w <= max &&
            h <= max);
    }
    /**
     * Room for `rec` (`w` x `h`) on the first page of its group that has it,
     * or on a new page: its drawId, slotX and slotY now place it there.
     * Returns the page.
     */
    place(rec, w, h) {
        const pw = w + 2 * PAGE_PADDING;
        const ph = h + 2 * PAGE_PADDING;
        const group = this.groupOf(rec);
        const shelves = this.shelves;
        const groups = this.groups;
        for (let i = 0; i < shelves.length; i++) {
            if (groups[i] === group && shelves[i].alloc(pw, ph) === true) {
                return this.take(i, rec);
            }
        }
        const size = this.pageSize;
        const page = this.store.createPage(size, size, size * size * 4);
        this.sink.createPage(page, size, size);
        const shelf = new Shelf(size, size);
        shelf.alloc(pw, ph);
        this.pages.push(page);
        shelves.push(shelf);
        this.members.push([]);
        groups.push(group);
        return this.take(shelves.length - 1, rec);
    }
    /**
     * The group `rec` goes into: the `atlasGroup` of the nearest node, from
     * the first node asking for it (or for a SubTexture of it) up to the
     * root, that sets one; '' when none does or nothing asks. The first
     * node decides for an image shown in two groups.
     */
    groupOf(rec) {
        const store = this.store;
        let id = store.ownerHead[rec];
        const subs = store.subs[rec];
        if (id === NULL && subs !== null) {
            for (let k = 0; k < subs.length && id === NULL; k++) {
                id = store.ownerHead[subs[k]];
            }
        }
        const nodes = store.nodes;
        while (id !== NULL) {
            const extras = nodes.extras[id];
            if (extras !== null && extras.atlasGroup !== undefined) {
                return extras.atlasGroup;
            }
            id = nodes.i32[id * I_STRIDE + I_PARENT];
        }
        return '';
    }
    /** The group of `page`; '' for a page this atlas does not hold. */
    groupOfPage(page) {
        const i = this.pages.indexOf(page);
        return i < 0 ? '' : this.groups[i];
    }
    /** Upload `rec`'s pixels into the slot `place` gave it. */
    upload(rec, source, w, h, premultiply) {
        const store = this.store;
        this.sink.uploadSubImage(store.drawId[rec], store.slotX[rec], store.slotY[rec], source, w, h, premultiply);
    }
    /**
     * `rec` leaves its page (freed, or its upload failed): its drawId is its
     * own again, and the page goes once it holds no image.
     */
    release(rec) {
        const store = this.store;
        const page = store.drawId[rec];
        const i = this.pages.indexOf(page);
        if (i < 0) {
            return;
        }
        const list = this.members[i];
        list.splice(list.indexOf(rec), 1);
        store.drawId[rec] = rec;
        if (list.length > 0) {
            return;
        }
        this.pages.splice(i, 1);
        this.shelves.splice(i, 1);
        this.members.splice(i, 1);
        this.groups.splice(i, 1);
        store.deletePage(page);
    }
    /**
     * A memory cleanup may free `page` at `now`: none of its images is
     * wanted, kept by preventCleanup or within its grace period.
     */
    evictable(page, now) {
        const store = this.store;
        if (store.wantCount[page] > 0) {
            return false;
        }
        const i = this.pages.indexOf(page);
        if (i < 0) {
            return false;
        }
        const list = this.members[i];
        for (let k = 0; k < list.length; k++) {
            const rec = list[k];
            if ((store.flags[rec] & F_PREVENT_CLEANUP) !== 0 ||
                now - store.createdAt[rec] < GRACE_PERIOD) {
                return false;
            }
        }
        return true;
    }
    /**
     * Free every image on `page` (spec 9.5, by page): each reloads when
     * wanted again, and the last one takes the page with it.
     */
    freePage(page) {
        const i = this.pages.indexOf(page);
        if (i < 0) {
            return;
        }
        const list = this.members[i];
        // Last first: each free takes its record off the end of the list.
        for (let k = list.length - 1; k >= 0; k--) {
            this.store.free(list[k]);
        }
    }
    /** Images on `page`, for tests and developer tools. */
    imagesOn(page) {
        const i = this.pages.indexOf(page);
        return i < 0 ? 0 : this.members[i].length;
    }
    take(i, rec) {
        const store = this.store;
        const shelf = this.shelves[i];
        const page = this.pages[i];
        store.drawId[rec] = page;
        store.slotX[rec] = shelf.x + PAGE_PADDING;
        store.slotY[rec] = shelf.y + PAGE_PADDING;
        this.members[i].push(rec);
        return page;
    }
}
//# sourceMappingURL=AtlasPages.js.map