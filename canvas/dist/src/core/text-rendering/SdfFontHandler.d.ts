import type { FontMetrics, NormalizedFontMetrics, TrProps, FontLoadOptions } from './TextRenderer.js';
import type { ImageTexture } from '../textures/ImageTexture.js';
import type { Stage } from '../Stage.js';
import type { CoreTextNode } from '../CoreTextNode.js';
/**
 * SDF Font Data structure matching msdf-bmfont-xml output
 */
export interface SdfFontData {
    pages: string[];
    chars: Array<{
        id: number;
        char: string;
        x: number;
        y: number;
        width: number;
        height: number;
        xoffset: number;
        yoffset: number;
        xadvance: number;
        page: number;
        chnl: number;
    }>;
    kernings: Array<{
        first: number;
        second: number;
        amount: number;
    }>;
    info: {
        face: string;
        size: number;
        bold: number;
        italic: number;
        charset: string[];
        unicode: number;
        stretchH: number;
        smooth: number;
        aa: number;
        padding: [number, number, number, number];
        spacing: [number, number];
        outline: number;
    };
    common: {
        lineHeight: number;
        base: number;
        scaleW: number;
        scaleH: number;
        pages: number;
        packed: number;
        alphaChnl: number;
        redChnl: number;
        greenChnl: number;
        blueChnl: number;
    };
    distanceField: {
        fieldType: 'sdf' | 'msdf';
        distanceRange: number;
    };
    lightningMetrics?: FontMetrics;
}
/**
 * @typedef {Object} SdfGlyph
 * @property {number} id - Glyph ID
 * @property {string} char - Character
 * @property {number} x - Atlas x position
 * @property {number} y - Atlas y position
 * @property {number} width - Glyph width
 * @property {number} height - Glyph height
 * @property {number} xoffset - X offset
 * @property {number} yoffset - Y offset
 * @property {number} xadvance - Character advance width
 * @property {number} page - Page number
 * @property {number} chnl - Channel
 */
/**
 * @typedef {Object} KerningTable
 * Fast lookup table for kerning values
 */
type KerningTable = Record<number, Record<number, number | undefined> | undefined>;
/**
 * @typedef {Object} SdfFontCache
 * Cached font data for performance
 */
export interface SdfFont {
    data: SdfFontData;
    glyphMap: Map<number, SdfFontData['chars'][0]>;
    kernings: KerningTable;
    atlasTexture: ImageTexture;
    metrics: FontMetrics;
    maxCharHeight: number;
}
export declare const MAX_FONT_LOAD_RETRIES = 3;
/**
 * Check if the SDF font handler can render a font
 * @param {TrProps} trProps - Text rendering properties
 * @returns {boolean} True if the font can be rendered
 */
export declare const canRenderFont: (trProps: TrProps) => boolean;
/**
 * Load SDF font from JSON + PNG atlas
 * @param {Object} options - Font loading options
 * @param {string} options.fontFamily - Font family name
 * @param {string} options.fontUrl - JSON font data URL (atlasDataUrl)
 * @param {string} options.atlasUrl - PNG atlas texture URL
 * @param {FontMetrics} options.metrics - Optional font metrics
 */
export declare const loadFont: (stage: Stage, options: FontLoadOptions) => Promise<void>;
/**
 * Stop waiting for a font to load
 * @param {string} fontFamily - Font family name
 * @param {CoreTextNode} node - Node that was waiting for the font
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
/**
 * Initialize the SDF font handler
 */
export declare const init: (c?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;
export declare const type = "sdf";
/**
 * Check if a font is already loaded by font family
 */
export declare const isFontLoaded: (fontFamily: string) => boolean;
/**
 * Get normalized font metrics for a font family
 */
export declare const getFontMetrics: (fontFamily: string, fontSize: number) => NormalizedFontMetrics;
/**
 * Get atlas texture for a font family
 * @param {string} fontFamily - Font family name
 * @returns {ImageTexture|null} Atlas texture or null
 */
export declare const getAtlas: (fontFamily: string) => ImageTexture | null;
/**
 * Get font data for a font family
 * @param {string} fontFamily - Font family name
 * @returns {SdfFontData|null} Font data or null
 */
export declare const getFontData: (fontFamily: string) => SdfFont | undefined;
export declare const measureText: (text: string, fontFamily: string, letterSpacing: number) => number;
export {};
