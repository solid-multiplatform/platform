/** Internal helpers shared by adapters; not part of the package API. */
/** ISO language matching without importing browser demux/track machinery. */
export declare const mediaLanguage: (language: string) => string;
export declare function supportsNativeHls(media: {
    canPlayType?(type: string): string;
}): boolean;
/** A finite positive value, otherwise zero. */
export declare function nonNegative(value: number): number;
export declare function delay(ms: number): Promise<void>;
