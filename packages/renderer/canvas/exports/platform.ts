/**
 * Platform abstraction
 *
 * @remarks
 * The classes a host embeds the renderer through. Subclass `WebPlatform` to
 * replace the clock, the frame loop, canvas sizing or image decoding on a
 * runtime that is not a browser, and pass the subclass as the `platform`
 * renderer setting, or register it with `setDefaultPlatform` for an app
 * whose settings do not name one. `resolveSettings` lets the platform
 * constrain those settings before they take effect.
 *
 * ```ts
 * import { WebPlatform, setDefaultPlatform } from '@solidtv/renderer/platform';
 * ```
 *
 * @module Platform
 */

export {
  Platform,
  getDefaultPlatform,
  setDefaultPlatform,
  type PlatformConstructor,
} from '../src/core/platforms/Platform.js';
export { WebPlatform } from '../src/core/platforms/web/WebPlatform.js';
