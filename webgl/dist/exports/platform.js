// exports/platform.ts
/**
 * The platform seam: what a host overrides to run the renderer outside a
 * browser, the registry for a default, and the request timeout a host's
 * fetch keeps to.
 *
 * @module Platform
 */
export { Platform, REQUEST_TIMEOUT, setDefaultPlatform, getDefaultPlatform, } from '../src/platform/Platform.js';
export { WebPlatform } from '../src/platform/WebPlatform.js';
//# sourceMappingURL=platform.js.map