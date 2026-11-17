import type { FontLoadOptions, FontMetrics, NormalizedFontMetrics } from './TextRenderer.js';
import type { Stage } from '../Stage.js';
import type { CoreTextNode } from '../CoreTextNode.js';
/**
 * Check if a font can be rendered
 */
export declare const canRenderFont: () => boolean;
/**
 * Load a font by providing fontFamily, fontUrl, and optional metrics
 */
export declare const loadFont: (stage: Stage, options: FontLoadOptions) => Promise<void>;
/**
 * Initialize the global font handler
 */
export declare const init: (c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, mc?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;
export declare const type = "canvas";
/**
 * Check if a font is already loaded by font family
 */
export declare const isFontLoaded: (fontFamily: string) => boolean;
/**
 * Wait for a font to load
 *
 * @param fontFamily
 * @param node
 */
export declare const waitingForFont: (fontFamily: string, node: CoreTextNode) => void;
/**
 * Stop waiting for a font to load
 *
 * @param fontFamily
 * @param node
 * @returns
 */
export declare const stopWaitingForFont: (fontFamily: string, node: CoreTextNode) => void;
export declare const getFontMetrics: (fontFamily: string, fontSize: number) => NormalizedFontMetrics;
export declare const measureText: (text: string, fontFamily: string, letterSpacing: number) => number;
/**
 * Get the font metrics for a font face.
 *
 * @remarks
 * This function will attempt to grab the explicitly defined metrics from the
 * font face first. If the font face does not have metrics defined, it will
 * attempt to calculate the metrics using the browser's measureText method.
 *
 * If the browser does not support the font metrics API, it will use some
 * default values.
 *
 * @param context
 * @param fontFace
 * @param fontSize
 * @returns
 */
export declare function calculateFontMetrics(fontFamily: string, fontSize: number): FontMetrics;
