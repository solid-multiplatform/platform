import type { Platform } from '../platforms/Platform.js';
export interface CreateImageBitmapSupport {
    basic: boolean;
    options: boolean;
    full: boolean;
    premultiplyHonored: boolean | null;
}
export declare function validateCreateImageBitmap(platform: Platform): Promise<CreateImageBitmapSupport>;
/**
 * Determine whether `createImageBitmap(..., { premultiplyAlpha: 'premultiply' })`
 * is actually honored by this browser.
 *
 * Strategy: decode a known straight-alpha pixel (255, 0, 0, 128) delivered as
 * a real PNG blob through createImageBitmap with 'premultiply', upload it to a
 * WebGL texture with GL-side premultiply DISABLED (so we observe the bitmap's
 * own state), then read the raw texel back via a framebuffer.
 *
 *  - honored   -> red comes back premultiplied (~128)
 *  - ignored   -> red comes back straight (~255)  [older Safari/WebKit,
 *                 Movistar-class embedded STBs]
 *
 * A real PNG blob (not ImageData) is used deliberately: it matches the code
 * path real textures take, and some embedded devices don't even support
 * ImageData->createImageBitmap (the old ImageData probe returned null there,
 * silently disabling detection on exactly the devices that needed it).
 *
 * @returns true if honored, false if ignored, null if it couldn't be measured
 * (no WebGL, createImageBitmap unsupported, framebuffer incomplete, etc.) —
 * caller should treat null as "unknown".
 */
export declare function detectPremultiplyAlphaHonored(platform: Platform): Promise<boolean | null>;
