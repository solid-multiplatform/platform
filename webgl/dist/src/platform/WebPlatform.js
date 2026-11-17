import { Platform, REQUEST_TIMEOUT, } from './Platform.js';
/** The browser platform (spec 12.3). */
export class WebPlatform extends Platform {
    constructor() {
        super(...arguments);
        /** present() wrote 0.999 last: the next writes 1. */
        this.presented = false;
    }
    createCanvas() {
        return document.createElement('canvas');
    }
    getElementById(id) {
        return document.getElementById(id);
    }
    sizeCanvas(canvas, width, height, logicalWidth, logicalHeight) {
        canvas.width = width;
        canvas.height = height;
        // An OffscreenCanvas has no style; a DOM canvas presents at the
        // logical size.
        const style = canvas.style;
        if (style !== undefined && style !== null) {
            style.width = `${logicalWidth}px`;
            style.height = `${logicalHeight}px`;
        }
    }
    requestAnimationFrame(callback) {
        return requestAnimationFrame(callback);
    }
    cancelAnimationFrame(handle) {
        cancelAnimationFrame(handle);
    }
    setTimeout(callback, ms) {
        setTimeout(callback, ms);
    }
    /** document.hidden (unprefixed since Chrome 33). */
    hidden() {
        return typeof document !== 'undefined' && document.hidden === true;
    }
    /**
     * Flip the canvas's opacity between 1 and 0.999: the style change makes
     * WebKit repaint, which shows the WebGL frame it holds (verified on Xumo,
     * WPE WebKit 601). Each write changes the computed value, so none is a
     * no-op, the first included (from an unset opacity, which reads as 1);
     * 0.999 shows no difference. An OffscreenCanvas has no style.
     */
    present(canvas) {
        const style = canvas.style;
        if (style === undefined || style === null) {
            return;
        }
        const presented = this.presented === false;
        this.presented = presented;
        style.opacity = presented === true ? '0.999' : '1';
    }
    /**
     * performance.now(): monotonic, unlike Date.now(), which an NTP step can
     * move backwards on a set left on for days. On the reference TV it is
     * clamped to 1 ms and costs about 1 us a call, so it is read rarely.
     */
    now() {
        return performance.now();
    }
    /**
     * Feature-detected: Chrome 38 to 49 have no createImageBitmap, and this
     * rejection is what the startup probe reads as "use the `<img>` path".
     */
    createImageBitmap(source, sxOrOptions, sy, sw, sh, options) {
        if (typeof createImageBitmap !== 'function') {
            return Promise.reject(new Error('createImageBitmap is not supported'));
        }
        // The one-argument form, not (source, undefined): Chrome 50 and 51
        // pick the overload by argument count and reject the two-argument call.
        if (sxOrOptions === undefined) {
            return createImageBitmap(source);
        }
        if (typeof sxOrOptions === 'number') {
            return createImageBitmap(source, sxOrOptions, sy, sw, sh, options);
        }
        return createImageBitmap(source, sxOrOptions);
    }
    createImage() {
        return new Image();
    }
    /**
     * XMLHttpRequest rather than window.fetch, which arrived in Chrome 42 and
     * cannot read `file://`. The readyState literal 4, not
     * XMLHttpRequest.DONE: a polyfilled XHR (NativeScript) exposes the
     * constants on instances only. A timeout ends the request as a network
     * error does (readyState 4, status 0, no response), before its own
     * event, so the two read alike.
     */
    fetch(url, responseType) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.responseType = responseType;
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) {
                    return;
                }
                const status = xhr.status;
                if ((status >= 200 && status < 300) ||
                    (status === 0 && xhr.response !== null)) {
                    resolve(xhr.response);
                    return;
                }
                reject(new Error(status === 0
                    ? `Network error or timeout loading ${url}`
                    : `HTTP ${status} ${xhr.statusText} loading ${url}`));
            };
            xhr.open('GET', url, true);
            xhr.timeout = REQUEST_TIMEOUT;
            xhr.send(null);
        });
    }
    /**
     * A worker from a `blob:` URL, revoked once the worker holds the script.
     * `new Worker` throws outright under a CSP without `blob:` workers: null
     * then, and images decode on the main thread.
     */
    createWorker(source) {
        if (typeof Worker === 'undefined') {
            return null;
        }
        const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
        let worker = null;
        try {
            worker = new Worker(url);
        }
        catch (e) {
            worker = null;
        }
        URL.revokeObjectURL(url);
        return worker;
    }
}
//# sourceMappingURL=WebPlatform.js.map