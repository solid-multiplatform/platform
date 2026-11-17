import {} from '../Stage.js';
export class Platform {
    /**
     * Adjusts the renderer settings before they take effect.
     *
     * @remarks
     * Called once from the RendererMain constructor with the settings the app
     * passed, before any default is applied. A host whose platform cannot
     * honour a setting returns a copy with it replaced: no image workers where
     * worker contexts lack the browser globals, the canvas view the host
     * already laid out. The base implementation returns the settings as they
     * are.
     */
    resolveSettings(settings) {
        return settings;
    }
}
let defaultPlatform = null;
/**
 * Registers the platform a renderer uses when its settings name none.
 *
 * @remarks
 * A host that boots an app written for the browser sets its platform here
 * before the app runs, so the app's own renderer settings need not know
 * about it. `null` restores the web platform. A `platform` setting still
 * takes precedence.
 */
export const setDefaultPlatform = (platform) => {
    defaultPlatform = platform;
};
export const getDefaultPlatform = () => defaultPlatform;
//# sourceMappingURL=Platform.js.map