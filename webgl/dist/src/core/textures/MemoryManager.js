import { NULL } from '../nodes/NodeFlags.js';
import { F_PREVENT_CLEANUP, TX_FREED, TX_IDLE, } from './TextureStore.js';
/**
 * A record younger than this is never freed or removed: a node created in
 * the same task may not have referenced it yet (1.10's startup grace).
 */
export const GRACE_PERIOD = 2000;
/**
 * setTimeout's longest delay, 2^31 - 1 ms: it fires a longer one, an
 * infinite one or NaN at once.
 */
const MAX_TIMEOUT = 0x7fffffff;
/**
 * Texture memory (spec 9.5): 1.10's settings and events over the store's
 * LRU and orphan lists, with no scan of the cache.
 *
 * Above the critical threshold after an upload, a critical cleanup runs
 * after that frame's uploads, drawn or not; above the target, an idle
 * cleanup runs from idle maintenance once `cleanupInterval` has passed
 * since the last one (an idle period that starts sooner comes back when it
 * has). Either frees uploaded records nobody wants, least recently wanted
 * first, down to the target threshold (spec 9.5; 1.10 stopped a critical
 * cleanup at the critical threshold), reversibly: the record stays and
 * reloads when wanted again. Records nothing references are removed after
 * the grace period.
 * A criticalThreshold of 0 turns the thresholds off, as in 1.10: no
 * critical cleanup after an upload and no idle cleanup (an out-of-memory
 * still asks for one critical cleanup, which frees nothing), and
 * `cleanup()` frees only with `full`.
 */
export class MemoryManager {
    constructor(store, events, target, settings) {
        this.criticalThreshold = 0;
        this.targetThreshold = 0;
        this.cleanupInterval = 0;
        this.baselineMemoryAllocation = 0;
        this.doNotExceedCriticalThreshold = false;
        this.debugLogging = false;
        /** Above the critical threshold since the last cleanup, or a GL out-of-memory. */
        this.criticalCleanupRequested = false;
        /**
         * Runs `callback` `ms` from now (the Renderer: platform.setTimeout). Null
         * (headless): nothing comes back later.
         */
        this.schedule = null;
        /** Asks for a frame (the Renderer): uploads held for room can go on. */
        this.requestFrame = () => { };
        /** Shared image pages (the imageAtlas setting): freed by page. */
        this.atlas = null;
        this.lastCleanup = -Infinity;
        /** The idle cleanup check that comes back is queued (once). */
        this.idleQueued = false;
        /** store.frame at the last idle maintenance: a frame drawn since ends the idle period. */
        this.idleFrame = 0;
        /** The check for room for held uploads is queued (once). */
        this.roomQueued = false;
        /** Renderer.destroy: a check already queued does nothing. */
        this.destroyed = false;
        /** debugLogging warned in this period above the critical threshold (1.10: once per period). */
        this.warned = false;
        this.idleCheck = () => {
            this.idleQueued = false;
            // A frame drew since: the idle maintenance after it checks again.
            if (this.destroyed === false && this.store.frame === this.idleFrame) {
                this.maintain();
            }
        };
        this.roomCheck = () => {
            this.roomQueued = false;
            if (this.destroyed === true || this.blocked === false) {
                return;
            }
            this.cleanup(false);
            // Still held: checked again while a texture someone wants waits.
            if (this.blocked === true && this.store.releaseUnwantedDecoded() > 0) {
                this.waitForRoom();
            }
        };
        this.store = store;
        this.events = events;
        this.target = target;
        this.updateSettings(settings);
    }
    /** Bytes in use: the baseline (a 1080p context) plus every uploaded texture. */
    get memUsed() {
        return this.baselineMemoryAllocation + this.store.loadedBytes;
    }
    updateSettings(settings) {
        const held = this.blocked;
        this.criticalThreshold = Math.round(settings.criticalThreshold);
        this.baselineMemoryAllocation = Math.round(settings.baselineMemoryAllocation);
        const level = Math.max(0, Math.min(1, settings.targetThresholdLevel));
        this.targetThreshold = Math.max(Math.round(settings.criticalThreshold * level), this.baselineMemoryAllocation);
        this.cleanupInterval = settings.cleanupInterval;
        this.doNotExceedCriticalThreshold = settings.doNotExceedCriticalThreshold;
        this.debugLogging = settings.debugLogging;
        // Turned off while uploads waited for room: they go on now.
        if (held === true &&
            settings.doNotExceedCriticalThreshold === false &&
            this.store.decodedCount > 0) {
            this.requestFrame();
        }
    }
    /** After an upload: past the critical threshold, a critical cleanup is due. */
    checkCritical() {
        if (this.criticalThreshold > 0 && this.memUsed > this.criticalThreshold) {
            this.criticalCleanupRequested = true;
        }
    }
    /** doNotExceedCriticalThreshold holds uploads back while critical (a deferral, not a failure). */
    get blocked() {
        return (this.doNotExceedCriticalThreshold === true &&
            this.criticalCleanupRequested === true);
    }
    /** Renderer.destroy: no check is queued after this, and a queued one does nothing. */
    destroy() {
        this.destroyed = true;
        this.schedule = null;
    }
    /**
     * Uploads wait for room (the Uploader, while blocked). A cleanup frees
     * nothing while the unwanted records are within their grace period, and
     * the loop may sleep meanwhile, so check again once it may be over.
     */
    waitForRoom() {
        if (this.roomQueued === true || this.schedule === null) {
            return;
        }
        this.roomQueued = true;
        this.schedule(this.roomCheck, GRACE_PERIOD);
    }
    /**
     * Idle maintenance: an idle cleanup when due, and orphans either way.
     * Above the target before cleanupInterval has passed, it comes back when
     * it has, if no frame drew meanwhile; never for a wait setTimeout cannot
     * take (an infinite cleanupInterval, which 1.10 read as never), which
     * would fire at once and spin.
     */
    maintain() {
        const now = this.store.now();
        const above = this.criticalThreshold > 0 && this.memUsed > this.targetThreshold;
        const wait = this.cleanupInterval - (now - this.lastCleanup);
        if (this.criticalCleanupRequested === true ||
            (above === true && wait <= 0)) {
            this.clean(false, now);
            return;
        }
        this.evictOrphans(now);
        const timeable = wait <= MAX_TIMEOUT;
        if (above === false || timeable === false) {
            return;
        }
        this.idleFrame = this.store.frame;
        if (this.idleQueued === false && this.schedule !== null) {
            this.idleQueued = true;
            this.schedule(this.idleCheck, wait);
        }
    }
    /**
     * Free unwanted uploaded records, least recently wanted first, until
     * below the target (every one with `full`; only with `full` while
     * criticalThreshold is 0), then remove orphans.
     */
    cleanup(full = false) {
        this.clean(full, this.store.now());
    }
    /**
     * cleanup() at `time`, the frame's (Renderer.frame): the critical cleanup
     * after a frame's uploads, and after every drawn frame while critical,
     * reads no clock.
     */
    cleanupAt(time) {
        this.clean(false, time);
    }
    /**
     * The idle GL probe found GL_OUT_OF_MEMORY (spec 12.1): tell the app, and
     * free what can be freed (1.10 handleOutOfMemory).
     */
    handleOutOfMemory() {
        this.events.queue(this.target, 'outOfMemory', {
            memUsed: this.memUsed,
            criticalThreshold: this.criticalThreshold,
        });
        this.criticalCleanupRequested = true;
    }
    /** renderer.memoryInfo() (1.10 getMemoryInfo). */
    info() {
        const store = this.store;
        return {
            criticalThreshold: this.criticalThreshold,
            targetThreshold: this.targetThreshold,
            renderableMemUsed: this.baselineMemoryAllocation + store.wantedBytes,
            memUsed: this.memUsed,
            renderableTexturesLoaded: store.wantedCount,
            loadedTextures: store.loadedCount,
            baselineMemoryAllocation: this.baselineMemoryAllocation,
        };
    }
    /**
     * cleanup at `now`. Still critical, it runs after every drawn frame (as
     * in 1.10), so its events are queued only for a listener: no payload is
     * built when nobody listens.
     */
    clean(full, now) {
        const target = this.target;
        const critical = this.criticalCleanupRequested;
        this.lastCleanup = now;
        if (critical === true && target.hasListener('criticalCleanup') === true) {
            this.events.queue(target, 'criticalCleanup', {
                memUsed: this.memUsed,
                criticalThreshold: this.criticalThreshold,
            });
        }
        this.freeUnwanted(full, now);
        this.evictOrphans(now);
        if (this.criticalThreshold > 0 && this.memUsed >= this.criticalThreshold) {
            if (target.hasListener('criticalCleanupFailed') === true) {
                this.events.queue(target, 'criticalCleanupFailed', {
                    memUsed: this.memUsed,
                    criticalThreshold: this.criticalThreshold,
                });
            }
            if (this.debugLogging === true && this.warned === false) {
                this.warned = true;
                console.warn(`[TextureMemory] above the critical threshold after cleanup: ${this.memUsed}`);
            }
            return;
        }
        this.warned = false;
        // Room again: uploads held back for it go on.
        const held = this.blocked === true && this.store.decodedCount > 0;
        this.criticalCleanupRequested = false;
        if (held === true) {
            this.requestFrame();
        }
    }
    /**
     * Free unwanted uploaded records, least recently wanted first, down to
     * the target, or every one with `full`: the LRU holds only records a
     * cleanup may free (TextureStore). With criticalThreshold 0, only a full
     * cleanup frees (1.10 then tracked no texture at all). An image on an
     * atlas page frees no memory alone: its page goes, with every image on
     * it, once none of them is wanted (AtlasPages.evictable); until then it
     * is passed over.
     */
    freeUnwanted(full, now) {
        if (full === false && this.criticalThreshold <= 0) {
            return;
        }
        const store = this.store;
        let rec = store.lruHead;
        while (rec !== NULL &&
            (full === true || this.memUsed >= this.targetThreshold)) {
            let next = store.lruNext[rec];
            if (now - store.createdAt[rec] >= GRACE_PERIOD) {
                const page = store.drawId[rec];
                const atlas = this.atlas;
                if (page === rec) {
                    store.free(rec);
                }
                else if (atlas !== null && atlas.evictable(page, now) === true) {
                    // The page's images leave the LRU with it: step past them.
                    while (next !== NULL && store.drawId[next] === page) {
                        next = store.lruNext[next];
                    }
                    atlas.freePage(page);
                }
            }
            rec = next;
        }
    }
    /**
     * Remove records nothing references once their grace period is over:
     * idle, freed or failed for good, not kept by preventCleanup, and with
     * no listener on their handle (an app still listening owns it).
     */
    evictOrphans(now) {
        const store = this.store;
        let rec = store.orphanHead;
        while (rec !== NULL) {
            const next = store.orphanNext[rec];
            const state = store.state[rec];
            const handle = store.handles[rec];
            if ((state === TX_IDLE ||
                state === TX_FREED ||
                store.failedForGood(rec) === true) &&
                store.wantCount[rec] === 0 &&
                (store.flags[rec] & F_PREVENT_CLEANUP) === 0 &&
                now - store.createdAt[rec] >= GRACE_PERIOD &&
                (handle === null || handle.hasListeners() === false)) {
                store.destroy(rec);
            }
            rec = next;
        }
    }
}
//# sourceMappingURL=MemoryManager.js.map