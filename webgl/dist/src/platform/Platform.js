/**
 * ms an image request may take, its whole transfer included, before it
 * fails (into the retries): the web platform's fetch, the image worker's
 * XHR and the `<img>` paths. A stalled request would otherwise hold one of
 * the loader's in-flight slots for good (spec 14, item 43).
 */
export const REQUEST_TIMEOUT = 30000;
/**
 * What a host overrides to run the renderer outside a browser (spec 12.3,
 * for example NativeScript on Apple TV); loop policy lives in core. Phase 2
 * defined the loop and canvas members and phase 3 the image members (decode,
 * fetch, the image worker). SDF fonts need nothing more: their atlas
 * description comes through `fetch` and their atlas through the image path.
 */
export class Platform {
    /**
     * Adjust the app's settings before any default applies: a host that
     * cannot honour a setting returns a copy with it replaced. Unchanged by
     * default.
     */
    resolveSettings(settings) {
        return settings;
    }
    /**
     * The page is hidden, so its animation frames are paused on purpose: the
     * loop then arms no wake fallback. Shown by default.
     */
    hidden() {
        return false;
    }
    /**
     * Put the last frame drawn into `canvas` on screen, for an engine that
     * shows a WebGL frame drawn outside its refresh cycle (an animation
     * frame that wakes the loop from idle, on Xumo's WPE WebKit 601) only
     * once something makes it repaint. Called once per idle period, after
     * the frame that went idle, with `presentOnIdle` on. Does nothing by
     * default.
     */
    present(_canvas) { }
}
let defaultPlatform = null;
/**
 * Register the platform a renderer uses when its settings name none (a host
 * that boots an app written for the browser); null restores the web
 * platform. A `platform` setting still wins.
 */
export const setDefaultPlatform = (platform) => {
    defaultPlatform = platform;
};
export const getDefaultPlatform = () => defaultPlatform;
//# sourceMappingURL=Platform.js.map