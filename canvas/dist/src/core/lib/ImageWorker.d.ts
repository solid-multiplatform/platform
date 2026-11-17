import type { CreateImageBitmapSupport } from '../lib/validateImageBitmap.js';
import { type TextureData } from '../textures/Texture.js';
type MessageCallback = [(value: any) => void, (reason: any) => void];
/**
 * Note that, within the createImageWorker function, we must only use ES5 code to keep it ES5-valid after babelifying, as
 *  the converted code of this section is converted to a blob and used as the js of the web worker thread.
 *
 * The createImageWorker function is a web worker that fetches an image from a URL and returns an ImageBitmap object.
 * The eslint @typescript rule is disabled for the entire function because the function is converted to a blob and used as the
 * js of the web worker thread, so the typescript syntax is not valid in this context.
 */
/**
 * Decode an image blob with `createImageBitmap`, the one copy of that logic
 * for both the image worker and the main-thread path (ImageTexture).
 *
 * Resolves `premultiplyAlpha` as "WebGL should premultiply this source on
 * upload": when the device ignores the createImageBitmap premultiply option,
 * a straight ('none') bitmap is requested and WebGL premultiplies instead.
 *
 * Must stay self-contained ES5: the worker receives it as source text (see
 * `createWorkerBlob`), so it may not reference anything outside itself.
 * `create` is invoked with `createThis` as its receiver, so the main thread
 * can pass `platform.createImageBitmap` without binding it.
 */
export declare function decodeImageBlob(create: (...args: any[]) => Promise<ImageBitmap>, createThis: unknown, blob: Blob, premultiplyAlpha: boolean | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null, supportsOptions: boolean, supportsFull: boolean, premultiplyHonored: boolean | null): Promise<{
    data: ImageBitmap;
    premultiplyAlpha: boolean;
}>;
export declare class ImageWorkerManager {
    /**
     * In-flight requests, keyed by the id sent to the worker.
     *
     * A `Map`, not a plain object: ids come from a monotonic counter and every
     * entry is removed as soon as its worker replies. Adding then deleting
     * sequential numeric keys on an object drives it into V8 dictionary mode and
     * keeps it there, taxing every subsequent lookup on a path a scroll hits
     * once per image. `Map` is built for insert/delete churn and needs no
     * `delete` operator.
     */
    messageManager: Map<number, MessageCallback>;
    /**
     * The image worker, or `null` until it spawns (or if spawning failed).
     *
     * There is exactly one, never a pool. The worker does no blocking work -
     * every path in it is `xhr.send()` followed by
     * `createImageBitmap(...).then(...)`, and the decode runs in the browser's
     * decode pool regardless of which thread asked for it. Nothing queues behind
     * it either, so a second worker would add an isolate and a thread without
     * raising either throughput or the number of images in flight. Whether image
     * loading is offloaded at all is decided one level up, by whether
     * `CoreTextureManager` constructs this manager.
     */
    worker: Worker | null;
    nextId: number;
    /** True once a spawn has been attempted, successful or not. */
    private spawnAttempted;
    private readonly createImageBitmapSupport;
    /** Called once if the worker cannot be spawned. */
    private readonly onUnavailable;
    /**
     * @param onUnavailable - Called once if the worker cannot be spawned (e.g.
     * a CSP that forbids blob workers), so the owner can switch image loading
     * to the main thread, decode limit included.
     */
    constructor(createImageBitmapSupport: CreateImageBitmapSupport, onUnavailable?: (() => void) | null);
    /**
     * Spawn the worker once. `new Worker(blob:)` throws outright where CSP
     * forbids blob workers; that throw must not escape into the caller's task
     * (or the warmup timer's), so it is caught here, leaving `worker` null and
     * reporting the failure to the owner.
     */
    private trySpawn;
    private handleMessage;
    private handleWorkerError;
    private createWorkerBlob;
    /**
     * Build the worker source and spawn the worker. Called through
     * {@link trySpawn}: from the constructor's warmup timer, or lazily if a
     * request arrives first. No-op once a spawn has been attempted, so a failed
     * spawn is not retried on every subsequent request.
     */
    private spawnWorker;
    /**
     * Whether requests can go to the worker. Spawns it first if the warmup has
     * not run yet. False once a spawn has failed (e.g. a CSP that forbids blob
     * workers), so callers can decode on the main thread instead of rejecting
     * every image.
     */
    isAvailable(): boolean;
    getImage(src: string, premultiplyAlpha: boolean | null, sx: number | null, sy: number | null, sw: number | null, sh: number | null): Promise<TextureData>;
}
export {};
