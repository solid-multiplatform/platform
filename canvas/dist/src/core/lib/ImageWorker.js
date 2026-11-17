import {} from '../textures/Texture.js';
/**
 * Note that, within the createImageWorker function, we must only use ES5 code to keep it ES5-valid after babelifying, as
 *  the converted code of this section is converted to a blob and used as the js of the web worker thread.
 *
 * The createImageWorker function is a web worker that fetches an image from a URL and returns an ImageBitmap object.
 * The eslint @typescript rule is disabled for the entire function because the function is converted to a blob and used as the
 * js of the web worker thread, so the typescript syntax is not valid in this context.
 */
/* eslint-disable */
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
export function decodeImageBlob(create, createThis, blob, premultiplyAlpha, sx, sy, sw, sh, supportsOptions, supportsFull, premultiplyHonored) {
    var withAlphaChannel = premultiplyAlpha !== undefined && premultiplyAlpha !== null
        ? premultiplyAlpha
        : blob.type.indexOf('image/png') !== -1;
    var useGlPremultiply = withAlphaChannel === true && premultiplyHonored === false;
    var options = {
        premultiplyAlpha: withAlphaChannel === true && useGlPremultiply === false
            ? 'premultiply'
            : 'none',
        colorSpaceConversion: 'none',
        imageOrientation: 'none',
    };
    var pending;
    if (supportsFull === true && sw !== null && sh !== null) {
        // createImageBitmap with crop and options
        pending = create.call(createThis, blob, sx || 0, sy || 0, sw, sh, options);
    }
    else if (supportsOptions === false && supportsFull === false) {
        // Chrome 50 to 52/54: no options. The browser default premultiplies, so
        // WebGL must not premultiply again — except on devices whose default
        // returns straight alpha (premultiplyHonored: false); there WebGL
        // premultiplies on upload.
        pending = create.call(createThis, blob);
    }
    else {
        pending = create.call(createThis, blob, options);
    }
    return pending.then(function (data) {
        return { data: data, premultiplyAlpha: useGlPremultiply };
    });
}
function createImageWorker(decode) {
    function getImage(src, premultiplyAlpha, x, y, width, height, options) {
        return new Promise(function (resolve, reject) {
            var supportsOptionsCreateImageBitmap = options.supportsOptionsCreateImageBitmap;
            var supportsFullCreateImageBitmap = options.supportsFullCreateImageBitmap;
            var premultiplyAlphaHonored = options.premultiplyAlphaHonored;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', src, true);
            xhr.responseType = 'blob';
            xhr.onload = function () {
                // On most devices like WebOS and Tizen, the file protocol returns 0 while http(s) protocol returns 200
                if (xhr.status !== 200 && xhr.status !== 0) {
                    return reject(new Error(`Image loading failed. HTTP status code: ${xhr.status || 'N/A'}. URL: ${src}`));
                }
                decode(createImageBitmap, undefined, xhr.response, premultiplyAlpha, x, y, width, height, supportsOptionsCreateImageBitmap, supportsFullCreateImageBitmap, premultiplyAlphaHonored).then(resolve, reject);
            };
            xhr.onerror = function () {
                reject(new Error('Network error occurred while trying to fetch the image.'));
            };
            xhr.send();
        });
    }
    // Capability flags are sent as message DATA (not baked into the worker's
    // source text) because they must survive minification: a production
    // bundler renames these local variable names, which silently breaks any
    // scheme that pattern-matches `createImageWorker.toString()` output for
    // injection (see git history for the string-replace approach this
    // replaced, and the bug it caused - capability detection was always a
    // no-op in a minified build, regardless of device or config).
    //
    // They are pool-lifetime constants, so the manager sends them once in an
    // `init` message at spawn rather than repeating them in every image
    // request. Worker message delivery is ordered per port, so the init always
    // lands before the first image request on that worker.
    var supportsOptionsCreateImageBitmap = false;
    var supportsFullCreateImageBitmap = false;
    var premultiplyAlphaHonored = false;
    /**
     * Start one image and reply as soon as it is ready.
     *
     * Each reply carries a transferred ImageBitmap, so the payload is already
     * zero-copy. Grouping replies would only hold finished bitmaps back waiting
     * on the slowest sibling, delaying first paint for every image in the group.
     */
    function handleRequest(request) {
        var id = request.id;
        var src = request.src;
        getImage(src, request.premultiplyAlpha, request.sx, request.sy, request.sw, request.sh, {
            supportsOptionsCreateImageBitmap: supportsOptionsCreateImageBitmap,
            supportsFullCreateImageBitmap: supportsFullCreateImageBitmap,
            premultiplyAlphaHonored: premultiplyAlphaHonored,
        })
            .then(function (data) {
            // @ts-ignore ts has wrong postMessage signature
            self.postMessage({ id: id, src: src, data: data }, [data.data]);
        })
            .catch(function (error) {
            self.postMessage({ id: id, src: src, error: error.message });
        });
    }
    self.onmessage = (event) => {
        if (event.data.init === true) {
            supportsOptionsCreateImageBitmap =
                event.data.supportsOptionsCreateImageBitmap;
            supportsFullCreateImageBitmap = event.data.supportsFullCreateImageBitmap;
            premultiplyAlphaHonored = event.data.premultiplyAlphaHonored;
            return;
        }
        // Every non-init message is one image request.
        handleRequest(event.data);
    };
}
/* eslint-enable */
export class ImageWorkerManager {
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
    messageManager = new Map();
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
    worker = null;
    nextId = 0;
    /** True once a spawn has been attempted, successful or not. */
    spawnAttempted = false;
    createImageBitmapSupport;
    /** Called once if the worker cannot be spawned. */
    onUnavailable;
    /**
     * @param onUnavailable - Called once if the worker cannot be spawned (e.g.
     * a CSP that forbids blob workers), so the owner can switch image loading
     * to the main thread, decode limit included.
     */
    constructor(createImageBitmapSupport, onUnavailable = null) {
        this.createImageBitmapSupport = createImageBitmapSupport;
        this.onUnavailable = onUnavailable;
        // Warm up on the next macrotask instead of waiting for the first image
        // request. Spawning costs main-thread time (blob serialization + the
        // Worker construction); deferring it by a task keeps it off the
        // synchronous renderer-construction path, while still having the worker
        // ready before textures start arriving. `getImage` keeps its lazy spawn
        // for a request that beats this timer.
        setTimeout(() => {
            this.trySpawn();
        }, 0);
    }
    /**
     * Spawn the worker once. `new Worker(blob:)` throws outright where CSP
     * forbids blob workers; that throw must not escape into the caller's task
     * (or the warmup timer's), so it is caught here, leaving `worker` null and
     * reporting the failure to the owner.
     */
    trySpawn() {
        if (this.spawnAttempted === true) {
            return;
        }
        try {
            this.spawnWorker();
        }
        catch (e) {
            /* reported below */
        }
        if (this.worker === null && this.onUnavailable !== null) {
            this.onUnavailable();
        }
    }
    handleMessage(event) {
        const { id, data, error } = event.data;
        const msg = this.messageManager.get(id);
        if (msg !== undefined) {
            const [resolve, reject] = msg;
            this.messageManager.delete(id);
            if (error) {
                reject(new Error(error));
            }
            else {
                resolve(data);
            }
        }
    }
    handleWorkerError(event) {
        const message = event instanceof ErrorEvent && event.message
            ? event.message
            : 'Image worker encountered an unrecoverable error';
        // Reject all pending requests; we cannot map a worker-level crash to a
        // specific message id, so fail everything outstanding to avoid hangs.
        // Deleting the current entry mid-iteration is well defined for a Map, so
        // this keeps the original per-entry "remove, then reject" ordering.
        for (const [id, msg] of this.messageManager) {
            const [, reject] = msg;
            this.messageManager.delete(id);
            reject(new Error(message));
        }
    }
    createWorkerBlob() {
        // Capability flags (options/full/premultiplyHonored) are NOT injected
        // into this source text. An earlier version pattern-matched
        // `createImageWorker.toString()` against literal variable-name strings
        // (e.g. 'var supportsOptionsCreateImageBitmap = false;') and rewrote
        // them - this silently breaks under any minifier that renames locals
        // (guaranteed in a real production bundle), permanently freezing every
        // device on the hardcoded defaults regardless of actual support. The
        // flags are sent per-request as postMessage data instead (see
        // `getImage` below and `self.onmessage` above) - plain data survives
        // minification untouched.
        // The shared decoder travels as an argument, not by name: a minifier
        // renames identifiers, but a parameter stays consistent with its uses.
        let workerCode = `(${createImageWorker.toString()})(${decodeImageBlob.toString()})`;
        workerCode = workerCode.replace('"use strict";', '');
        return new Blob([workerCode], {
            type: 'application/javascript',
        });
    }
    /**
     * Build the worker source and spawn the worker. Called through
     * {@link trySpawn}: from the constructor's warmup timer, or lazily if a
     * request arrives first. No-op once a spawn has been attempted, so a failed
     * spawn is not retried on every subsequent request.
     */
    spawnWorker() {
        if (this.spawnAttempted === true) {
            return;
        }
        this.spawnAttempted = true;
        const blob = this.createWorkerBlob();
        const urlFactory = self.URL ? URL : webkitURL;
        const blobURL = urlFactory.createObjectURL(blob);
        const worker = new Worker(blobURL);
        // The worker retains the script after construction; the URL is no longer
        // needed once the Worker has been created from it.
        urlFactory.revokeObjectURL(blobURL);
        worker.onmessage = (event) => this.handleMessage(event);
        worker.onerror = (event) => this.handleWorkerError(event);
        worker.onmessageerror = (event) => this.handleWorkerError(event);
        // Capability flags are constant for the worker's lifetime. Send them once
        // here instead of on every image request: worker messages are delivered in
        // order, so this lands before any image request.
        worker.postMessage({
            init: true,
            supportsOptionsCreateImageBitmap: this.createImageBitmapSupport.options,
            supportsFullCreateImageBitmap: this.createImageBitmapSupport.full,
            premultiplyAlphaHonored: this.createImageBitmapSupport.premultiplyHonored,
        });
        this.worker = worker;
    }
    /**
     * Whether requests can go to the worker. Spawns it first if the warmup has
     * not run yet. False once a spawn has failed (e.g. a CSP that forbids blob
     * workers), so callers can decode on the main thread instead of rejecting
     * every image.
     */
    isAvailable() {
        if (this.worker === null) {
            this.trySpawn();
        }
        return this.worker !== null;
    }
    getImage(src, premultiplyAlpha, sx, sy, sw, sh) {
        return new Promise((resolve, reject) => {
            if (this.worker === null) {
                // This request beat the constructor's scheduled warmup: spawn now
                // rather than making the image wait a task.
                this.trySpawn();
            }
            const worker = this.worker;
            if (worker === null) {
                reject(new Error('No image worker available'));
                return;
            }
            const id = this.nextId++;
            this.messageManager.set(id, [resolve, reject]);
            // Capability flags are deliberately absent: they are sent once per
            // worker at spawn (see `spawnWorker`). Keeping this payload minimal
            // matters because it is structured-cloned once per image.
            worker.postMessage({
                id,
                src,
                premultiplyAlpha,
                sx,
                sy,
                sw,
                sh,
            });
        });
    }
}
//# sourceMappingURL=ImageWorker.js.map