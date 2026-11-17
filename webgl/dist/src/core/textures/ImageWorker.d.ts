import { type Platform } from '../../platform/Platform.js';
import type { CreateImageBitmapSupport } from './probes.js';
/** What a decode produced: the bitmap, and whether WebGL must premultiply it. */
export interface DecodedImage {
    data: ImageBitmap;
    premultiplyAlpha: boolean;
}
/**
 * Decode an image blob with createImageBitmap: the one copy of that logic,
 * for the image worker and for main-thread decoding alike (ported from
 * 1.10). `premultiplyAlpha` in the result means "WebGL premultiplies this
 * on upload": where the device ignores the premultiply option
 * (`premultiplyHonored` false) a straight bitmap is asked for instead.
 *
 * ES5 only (CLAUDE.md: worker source is stringified ES5): the worker gets
 * this function as source text, so it may not reference anything outside
 * itself, and no build may inject helpers into it (see createImageWorker
 * for the function rule that follows). `create` is called with
 * `createThis` as its receiver, so the main thread can pass
 * `platform.createImageBitmap` without binding it.
 */
export declare function decodeImageBlob(create: (...args: unknown[]) => Promise<ImageBitmap>, createThis: unknown, blob: Blob, premultiplyAlpha: boolean | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null, supportsOptions: boolean, supportsFull: boolean, premultiplyHonored: boolean | null): Promise<DecodedImage>;
/** The worker's source text. */
export declare function imageWorkerSource(): string;
/**
 * Exactly one image worker (spec 9.3; measured: one beats a pool on a
 * 4-core TV, which competes with the main thread), spawned through
 * `platform.createWorker`. One request per message, sent at once: batching
 * them was measured to buy nothing.
 */
export declare class ImageWorkerManager {
    /**
     * The worker runs; false sends every image to the main thread (it could
     * not be started, or it crashed), or nowhere after destroy().
     */
    available: boolean;
    /**
     * The worker crashed: the requests it had in flight load on the main
     * thread instead (sources.ts). Not after destroy(), which ends them.
     */
    crashed: boolean;
    /** Called when a crash makes the worker unavailable (the Loader). */
    onUnavailable: (() => void) | null;
    private worker;
    private readonly pending;
    private nextId;
    constructor(platform: Platform, support: CreateImageBitmapSupport);
    /** Fetch and decode `src` in the worker, cropped when sw and sh are set. */
    getImage(src: string, premultiplyAlpha: boolean | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null): Promise<DecodedImage>;
    /** Requests the worker has not answered yet. */
    get inFlight(): number;
    /**
     * Renderer.destroy: stop the worker for good. The requests in flight are
     * rejected and later ones refused, so none hangs; it is no crash (no
     * onUnavailable, nothing loads on the main thread instead).
     */
    destroy(): void;
    private reply;
    /**
     * A crash cannot be tied to one request: fail them all rather than hang
     * them. The worker may be dead (some browsers report a worker script that
     * may not run, under a CSP, as an error event rather than a throw), so it
     * is stopped and later images decode on the main thread.
     */
    private crash;
    /** Fail every request in flight with `message`. */
    private rejectAll;
}
