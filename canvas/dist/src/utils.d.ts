import type { ContextSpy } from './core/lib/ContextSpy.js';
export declare function createWebGLContext(canvas: HTMLCanvasElement | OffscreenCanvas, forceWebGL2?: boolean, contextSpy?: ContextSpy | null, powerPreference?: WebGLPowerPreference): WebGLRenderingContext;
export declare const isProductionEnvironment: boolean;
export declare const RENDER_TEXT_BATCHING: boolean;
export declare const ENABLE_COMPRESSED_TEXTURES: boolean;
export declare const ENABLE_INSPECTOR: boolean;
export declare const EMIT_BOUNDS_EVENTS: boolean;
/**
 * Asserts a condition is truthy, otherwise throws an error
 *
 * @remarks
 * Useful at the top of functions to ensure certain conditions, arguments and
 * properties are set/met before continuing. When using this function,
 * TypeScript will narrow away falsy types from the condition.
 *
 * @param condition
 * @param message
 * @returns
 */
export declare function assertTruthy(condition: unknown, message?: string): asserts condition;
/**
 * Merges two colors based on a given progress value.
 *
 * This function takes two colors (c1 and c2) represented as 32-bit integers
 * in RGBA format and blends them based on the provided progress value (p).
 * The result is a new color that is a weighted combination of the input colors,
 * where the weight is determined by the progress value.
 *
 * @param {number} c1 - The first color in RGBA format (32-bit integer).
 * @param {number} c2 - The second color in RGBA format (32-bit integer).
 * @param {number} p - The progress value between 0 and 1.
 * @returns {number} The merged color as a 32-bit integer in RGBA format.
 */
export declare function mergeColorProgress(rgba1: number, rgba2: number, p: number): number;
/**
 * Given an RGBA encoded number, returns back the RGBA number with it's alpha
 * component multiplied by the passed `alpha` parameter.
 *
 * @internalRemarks
 * This method does NOT premultiply the alpha into the color channels. If that
 * is required (for internal use only) use {@link premultiplyColorABGR}
 * instead.
 *
 * @param rgba RGBA encoded number
 * @param alpha Normalized alpha value (Range: 0.0 - 1.0)
 * @returns
 */
export declare function mergeColorAlpha(rgba: number, alpha: number): number;
/**
 * RGB components should not be premultiplied when using Canvas renderer
 * @param mode  Renderer mode
 */
export declare function setPremultiplyMode(mode: 'webgl' | 'canvas'): void;
/**
 * Given an RGBA encoded color, returns it as ABGR (for shader attributes) with
 * its alpha multiplied by `alpha`. For the WebGL renderer the color channels
 * are premultiplied by the final alpha (see {@link setPremultiplyMode}).
 *
 * @internal
 * @param rgba RGBA encoded color
 * @param alpha Normalized alpha (0.0 – 1.0)
 * @returns ABGR encoded premultiplied color
 */
export declare function premultiplyColorABGR(rgba: number, alpha: number): number;
/**
 * Converts degrees to radians
 *
 * @param degrees
 * @returns
 */
export declare function deg2Rad(degrees: number): number;
export declare function getNewId(): number;
