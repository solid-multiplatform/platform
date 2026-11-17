import type { EventEmitter } from '../../common/EventEmitter.js';
import type { MemoryInfo } from '../../common/types.js';
import type { TextureMemorySettings } from '../../settings.js';
import type { FrameEvents } from '../FrameEvents.js';
import type { AtlasPages } from './AtlasPages.js';
import { type TextureStore } from './TextureStore.js';
/**
 * A record younger than this is never freed or removed: a node created in
 * the same task may not have referenced it yet (1.10's startup grace).
 */
export declare const GRACE_PERIOD = 2000;
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
export declare class MemoryManager {
    criticalThreshold: number;
    targetThreshold: number;
    cleanupInterval: number;
    baselineMemoryAllocation: number;
    doNotExceedCriticalThreshold: boolean;
    debugLogging: boolean;
    /** Above the critical threshold since the last cleanup, or a GL out-of-memory. */
    criticalCleanupRequested: boolean;
    /**
     * Runs `callback` `ms` from now (the Renderer: platform.setTimeout). Null
     * (headless): nothing comes back later.
     */
    schedule: ((callback: () => void, ms: number) => void) | null;
    /** Asks for a frame (the Renderer): uploads held for room can go on. */
    requestFrame: () => void;
    /** Shared image pages (the imageAtlas setting): freed by page. */
    atlas: AtlasPages | null;
    private lastCleanup;
    /** The idle cleanup check that comes back is queued (once). */
    private idleQueued;
    /** store.frame at the last idle maintenance: a frame drawn since ends the idle period. */
    private idleFrame;
    /** The check for room for held uploads is queued (once). */
    private roomQueued;
    /** Renderer.destroy: a check already queued does nothing. */
    private destroyed;
    /** debugLogging warned in this period above the critical threshold (1.10: once per period). */
    private warned;
    private readonly store;
    private readonly events;
    private readonly target;
    private readonly idleCheck;
    private readonly roomCheck;
    constructor(store: TextureStore, events: FrameEvents, target: EventEmitter, settings: TextureMemorySettings);
    /** Bytes in use: the baseline (a 1080p context) plus every uploaded texture. */
    get memUsed(): number;
    updateSettings(settings: TextureMemorySettings): void;
    /** After an upload: past the critical threshold, a critical cleanup is due. */
    checkCritical(): void;
    /** doNotExceedCriticalThreshold holds uploads back while critical (a deferral, not a failure). */
    get blocked(): boolean;
    /** Renderer.destroy: no check is queued after this, and a queued one does nothing. */
    destroy(): void;
    /**
     * Uploads wait for room (the Uploader, while blocked). A cleanup frees
     * nothing while the unwanted records are within their grace period, and
     * the loop may sleep meanwhile, so check again once it may be over.
     */
    waitForRoom(): void;
    /**
     * Idle maintenance: an idle cleanup when due, and orphans either way.
     * Above the target before cleanupInterval has passed, it comes back when
     * it has, if no frame drew meanwhile; never for a wait setTimeout cannot
     * take (an infinite cleanupInterval, which 1.10 read as never), which
     * would fire at once and spin.
     */
    maintain(): void;
    /**
     * Free unwanted uploaded records, least recently wanted first, until
     * below the target (every one with `full`; only with `full` while
     * criticalThreshold is 0), then remove orphans.
     */
    cleanup(full?: boolean): void;
    /**
     * cleanup() at `time`, the frame's (Renderer.frame): the critical cleanup
     * after a frame's uploads, and after every drawn frame while critical,
     * reads no clock.
     */
    cleanupAt(time: number): void;
    /**
     * The idle GL probe found GL_OUT_OF_MEMORY (spec 12.1): tell the app, and
     * free what can be freed (1.10 handleOutOfMemory).
     */
    handleOutOfMemory(): void;
    /** renderer.memoryInfo() (1.10 getMemoryInfo). */
    info(): MemoryInfo;
    /**
     * cleanup at `now`. Still critical, it runs after every drawn frame (as
     * in 1.10), so its events are queued only for a listener: no payload is
     * built when nobody listens.
     */
    private clean;
    /**
     * Free unwanted uploaded records, least recently wanted first, down to
     * the target, or every one with `full`: the LRU holds only records a
     * cleanup may free (TextureStore). With criticalThreshold 0, only a full
     * cleanup frees (1.10 then tracked no texture at all). An image on an
     * atlas page frees no memory alone: its page goes, with every image on
     * it, once none of them is wanted (AtlasPages.evictable); until then it
     * is passed over.
     */
    private freeUnwanted;
    /**
     * Remove records nothing references once their grace period is over:
     * idle, freed or failed for good, not kept by preventCleanup, and with
     * no listener on their handle (an app still listening owns it).
     */
    private evictOrphans;
}
