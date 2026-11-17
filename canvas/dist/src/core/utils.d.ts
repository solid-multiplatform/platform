/**
 * Core Utility Functions
 *
 * @module
 */
export type TimingFunction = (t: number) => number;
export declare const getTimingFunction: (str: string) => TimingFunction;
/**
 * Convert bytes to string of megabytes with 2 decimal points
 *
 * @param bytes
 * @returns
 */
export declare function bytesToMb(bytes: number): string;
