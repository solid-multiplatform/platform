import { Platform, type FetchResponseType } from './Platform.js';
/** The browser platform (spec 12.3). */
export declare class WebPlatform extends Platform {
    /** present() wrote 0.999 last: the next writes 1. */
    private presented;
    createCanvas(): HTMLCanvasElement;
    getElementById(id: string): HTMLElement | null;
    sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, logicalWidth: number, logicalHeight: number): void;
    requestAnimationFrame(callback: (time: number) => void): number;
    cancelAnimationFrame(handle: number): void;
    setTimeout(callback: () => void, ms: number): void;
    /** document.hidden (unprefixed since Chrome 33). */
    hidden(): boolean;
    /**
     * Flip the canvas's opacity between 1 and 0.999: the style change makes
     * WebKit repaint, which shows the WebGL frame it holds (verified on Xumo,
     * WPE WebKit 601). Each write changes the computed value, so none is a
     * no-op, the first included (from an unset opacity, which reads as 1);
     * 0.999 shows no difference. An OffscreenCanvas has no style.
     */
    present(canvas: HTMLCanvasElement): void;
    /**
     * performance.now(): monotonic, unlike Date.now(), which an NTP step can
     * move backwards on a set left on for days. On the reference TV it is
     * clamped to 1 ms and costs about 1 us a call, so it is read rarely.
     */
    now(): number;
    /**
     * Feature-detected: Chrome 38 to 49 have no createImageBitmap, and this
     * rejection is what the startup probe reads as "use the `<img>` path".
     */
    createImageBitmap(source: ImageBitmapSource, sxOrOptions?: number | ImageBitmapOptions, sy?: number, sw?: number, sh?: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;
    createImage(): HTMLImageElement;
    /**
     * XMLHttpRequest rather than window.fetch, which arrived in Chrome 42 and
     * cannot read `file://`. The readyState literal 4, not
     * XMLHttpRequest.DONE: a polyfilled XHR (NativeScript) exposes the
     * constants on instances only. A timeout ends the request as a network
     * error does (readyState 4, status 0, no response), before its own
     * event, so the two read alike.
     */
    fetch(url: string, responseType: FetchResponseType): Promise<unknown>;
    /**
     * A worker from a `blob:` URL, revoked once the worker holds the script.
     * `new Worker` throws outright under a CSP without `blob:` workers: null
     * then, and images decode on the main thread.
     */
    createWorker(source: string): Worker | null;
}
