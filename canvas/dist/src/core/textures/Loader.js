import { NULL } from '../nodes/NodeFlags.js';
import { KIND_COLOR, closeData } from './TextureStore.js';
import { detectPremultiplyAlphaHonored, validateCreateImageBitmap, } from './probes.js';
import { ImageWorkerManager } from './ImageWorker.js';
import { loadImage } from './sources.js';
// 1.10's startup warnings, each printed once per page: they explain slow
// images during a device's bring-up.
const WARN_NO_BITMAP = 1;
const WARN_NO_WORKER = 2;
const WARN_PREMULTIPLY = 4;
let warned = 0;
function warnOnce(warning, message) {
    if ((warned & warning) !== 0) {
        return;
    }
    warned |= warning;
    console.warn(message);
}
/**
 * A ColorTexture's 1x1 pixel, as 1.10 built it: the colour read as
 * 0xAARRGGBB (opaque white as is).
 */
export function colorPixel(color) {
    const pixel = new Uint8Array(4);
    if (color === 0xffffffff) {
        pixel[0] = 255;
        pixel[1] = 255;
        pixel[2] = 255;
        pixel[3] = 255;
        return pixel;
    }
    pixel[0] = (color >> 16) & 0xff;
    pixel[1] = (color >> 8) & 0xff;
    pixel[2] = color & 0xff;
    pixel[3] = (color >>> 24) & 0xff;
    return pixel;
}
/** A NoiseTexture's pixels, as 1.10 generated them: one random grey per pixel, opaque. */
export function noise(w, h) {
    const size = w * h * 4;
    const pixels = new Uint8ClampedArray(size);
    for (let i = 0; i < size; i += 4) {
        const v = Math.floor(Math.random() * 256);
        pixels[i] = v;
        pixels[i + 1] = v;
        pixels[i + 2] = v;
        pixels[i + 3] = 255;
    }
    return new ImageData(pixels, w, h);
}
/**
 * noise(w, h), or what it threw for a size ImageData rejects (0 or
 * fractional: an IndexSizeError), apart so that no try/catch sits in the
 * dispatch loop.
 */
function tryNoise(w, h) {
    try {
        return noise(w, h);
    }
    catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}
/**
 * Starts loads (spec 9.3): takes records from the store's priority queue,
 * at most `imageDecodeConcurrency` in flight, and reports each result back
 * to the store. One record is one load, so a source shared by many nodes
 * is fetched once, and a record a node scrolled away from before its turn
 * is cancelled by the queue rather than fetched.
 *
 * The decode strategy is chosen once, before the first load and never
 * inside the constructor: the createImageBitmap probe (three 1x1 decodes)
 * and, when asked for, the premultiply probe run first, and images queued
 * meanwhile wait. A worker that crashes sends the images after it to the
 * main thread. Colour and noise textures fetch nothing: they are made at
 * the next dispatch, before the probes finish too, and take no slot (1.10).
 */
export class Loader {
    constructor(platform, store, settings) {
        /** The probes finished: image loads can start. */
        this.ready = false;
        /** Image loads started and not yet finished. */
        this.inFlight = 0;
        this.ctx = null;
        this.destroyed = false;
        this.onLoaded = (rec, loaded) => {
            this.inFlight--;
            // Landed after the destroy: no upload will take it.
            if (this.destroyed === true) {
                closeData(loaded.data);
                return;
            }
            this.store.decoded(rec, loaded.data, loaded.w, loaded.h, loaded.premultiply);
            this.dispatch();
        };
        this.onFailed = (rec, error) => {
            this.inFlight--;
            this.store.failed(rec, error instanceof Error ? error : new Error(String(error)));
            this.dispatch();
        };
        /** The worker crashed (ImageWorkerManager.onUnavailable). */
        this.workerLost = () => {
            const ctx = this.ctx;
            if (ctx !== null) {
                ctx.worker = null;
            }
            this.dispatch();
        };
        this.platform = platform;
        this.store = store;
        this.settings = settings;
        const mode = settings.createImageBitmapSupport;
        if (mode === 'auto') {
            validateCreateImageBitmap(platform).then((support) => this.resolvePremultiply(support), () => this.init(null));
        }
        else {
            // A microtask, as the probes defer 'auto': the worker never starts
            // inside the constructor (1.10 started it from a timer).
            const support = {
                basic: mode === 'basic',
                options: mode === 'options',
                full: mode === 'full',
                premultiplyHonored: null,
            };
            Promise.resolve().then(() => this.resolvePremultiply(support));
        }
    }
    /**
     * Make the queued colour and noise textures, then start queued image
     * loads up to the in-flight limit: after each draw, when a load
     * finishes, when a retry queues a record, and when the probes finish
     * (images wait for them).
     */
    dispatch() {
        if (this.destroyed === true) {
            return;
        }
        const store = this.store;
        let rec = store.nextGenerated();
        while (rec !== NULL) {
            this.generate(rec);
            rec = store.nextGenerated();
        }
        const ctx = this.ctx;
        if (ctx === null) {
            return;
        }
        const limit = this.settings.imageDecodeConcurrency;
        while (limit <= 0 || this.inFlight < limit) {
            rec = store.nextQueued();
            if (rec === NULL) {
                return;
            }
            this.start(ctx, rec);
        }
    }
    /**
     * Renderer.destroy: stop the image worker. Nothing starts after it: not
     * a load when one finishes, nor a worker when a probe does.
     */
    destroy() {
        this.destroyed = true;
        const ctx = this.ctx;
        if (ctx !== null && ctx.worker !== null) {
            ctx.worker.destroy();
        }
        this.ctx = null;
    }
    /** An image loads asynchronously and takes a slot. */
    start(ctx, rec) {
        this.inFlight++;
        const props = this.store.props[rec];
        // Inside a promise: a source that throws at once (a malformed data
        // URI, a function source) fails its record like any other.
        new Promise((resolve) => {
            resolve(loadImage(ctx, props));
        }).then((loaded) => this.onLoaded(rec, loaded), (error) => this.onFailed(rec, error));
    }
    /**
     * A colour or noise texture, made here and now. A noise size ImageData
     * rejects fails the texture, as 1.10 did.
     */
    generate(rec) {
        const store = this.store;
        if (store.kind[rec] === KIND_COLOR) {
            store.decoded(rec, colorPixel(store.props[rec].color), 1, 1, true);
            return;
        }
        const p = store.props[rec];
        const pixels = tryNoise(p.w, p.h);
        if (pixels instanceof Error) {
            store.failed(rec, pixels);
            return;
        }
        store.decoded(rec, pixels, p.w, p.h, false);
    }
    resolvePremultiply(support) {
        // A destroy during the createImageBitmap probe: no probe context of its
        // own (TV browsers cap live WebGL contexts), no worker.
        if (this.destroyed === true) {
            return;
        }
        const honored = this.settings.premultiplyAlphaHonored;
        if (honored !== 'auto') {
            support.premultiplyHonored = honored;
            this.init(support);
            return;
        }
        // Only the option forms pass the premultiply option at all.
        if (support.options === false && support.full === false) {
            this.init(support);
            return;
        }
        detectPremultiplyAlphaHonored(this.platform).then((result) => {
            support.premultiplyHonored = result;
            this.init(support);
        }, () => this.init(support));
    }
    init(support) {
        if (this.destroyed === true) {
            return;
        }
        const usable = support !== null &&
            (support.basic === true ||
                support.options === true ||
                support.full === true);
        let worker = null;
        if (usable === true && this.settings.numImageWorkers > 0) {
            worker = new ImageWorkerManager(this.platform, support);
            if (worker.available === false) {
                worker = null;
            }
            else {
                worker.onUnavailable = this.workerLost;
            }
        }
        if (support !== null && support.premultiplyHonored === false) {
            warnOnce(WARN_PREMULTIPLY, '[SolidTV] createImageBitmap premultiplyAlpha:"premultiply" is not honored on this device: WebGL premultiplies images on upload instead.');
        }
        if (usable === false) {
            warnOnce(WARN_NO_BITMAP, '[SolidTV] createImageBitmap is not supported on this browser. ImageTexture will be slower.');
        }
        if (worker === null) {
            warnOnce(WARN_NO_WORKER, '[SolidTV] Image worker count is 0 or workers are not supported on this browser. Image loading will be slower.');
        }
        this.ctx = {
            platform: this.platform,
            support: usable === true ? support : null,
            worker,
            pixelRatio: this.settings.pixelRatio,
        };
        this.ready = true;
        this.dispatch();
    }
}
//# sourceMappingURL=Loader.js.map