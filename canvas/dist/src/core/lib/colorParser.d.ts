export interface IParsedColor {
    isWhite: boolean;
    a: number;
    r: number;
    g: number;
    b: number;
}
/**
 * Extract color components.
 *
 * Returns a shared scratch object to avoid a per-call allocation in the
 * canvas frame loop — consume it synchronously, never retain it.
 */
export declare function parseColor(abgr: number): IParsedColor;
export declare function parseToAbgrString(abgr: number): string;
export declare function parseToRgbaString(rgba: number): string;
/**
 * Extract color components
 */
export declare function parseColorRgba(rgba: number): IParsedColor;
/**
 * Format a parsed color into a rgba CSS color
 */
export declare function formatRgba({ a, r, g, b }: IParsedColor): string;
