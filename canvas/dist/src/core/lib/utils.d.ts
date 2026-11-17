import type { Vec4 } from '../renderers/webgl/internal/ShaderUtils.js';
export declare const PROTOCOL_REGEX: RegExp;
export type RGBA = [r: number, g: number, b: number, a: number];
export declare const getNormalizedRgbaComponents: (rgba: number) => RGBA;
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface RectWithValid extends Rect {
    valid: boolean;
}
/**
 * A node's clipping rect plus its WebGL scissor box: device pixels,
 * bottom-left origin. Pixel ratio and canvas size are fixed at construction,
 * so the box is derived once when the rect is written (see
 * `CoreNode.calculateClippingRect`) instead of on every clipped draw.
 */
export interface ClipRect extends RectWithValid {
    scissorX: number;
    scissorY: number;
    scissorW: number;
    scissorH: number;
}
/**
 * Derive `rect`'s scissor box from its logical rect.
 */
export declare const updateScissor: (rect: ClipRect, pixelRatio: number, canvasH: number) => void;
export interface Bound {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export interface BoundWithValid extends Bound {
    valid: boolean;
}
export declare function createBound<T extends Bound = Bound>(x1: number, y1: number, x2: number, y2: number, out?: T): T;
export declare function intersectRect(a: Rect, b: Rect): Rect;
export declare function intersectRect<T extends Rect = Rect>(a: Rect, b: Rect, out: T): T;
export declare function copyRect(a: Rect): Rect;
export declare function copyRect<T extends Rect = Rect>(a: Rect, out: T): T;
export declare function compareRect(a: Rect | null, b: Rect | null): boolean;
export declare function convertUrlToAbsolute(url: string): string;
export declare function isBase64Image(src: string): boolean;
export declare function valuesAreEqual(values: number[]): boolean;
export declare function calcFactoredRadiusArray(radius: Vec4, width: number, height: number): [number, number, number, number];
export declare function dataURIToBlob(dataURI: string): Blob;
/**
 * GET `url` with XMLHttpRequest and resolve with its response. The one
 * main-thread fetcher (the image worker keeps its own copy: it runs from
 * stringified source).
 *
 * Resolves on any 2xx, and on status 0 when there is a response: WebOS and
 * Tizen report 0 for a successful `file://` load. A network error also
 * reports 0 but carries no response, so it rejects.
 */
export declare function fetchResource(url: string, responseType?: XMLHttpRequestResponseType): Promise<unknown>;
/**
 * Clamp a {@link UnitInterval}-typed value into [0, 1].
 *
 * @remarks
 * `UnitInterval` documents the contract but TypeScript cannot enforce a
 * numeric range, so the range is applied where the value is read. Both
 * backends clamp so an out-of-contract `resizeMode.clipX`/`clipY` renders the
 * same on WebGL and Canvas2D instead of sampling outside the texture.
 */
export declare function clampUnit(value: number): number;
