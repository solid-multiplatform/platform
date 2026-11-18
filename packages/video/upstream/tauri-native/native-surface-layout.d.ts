export interface NativeSurfaceLayout {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface NativeSurfacePosition extends NativeSurfaceLayout {
    scrollX: number;
    scrollY: number;
}
export interface RectLike {
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface ViewportLike {
    width: number;
    height: number;
}
export interface VisibleSurfaceBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export declare function snapNativeSurfaceLayout(rect: RectLike, android: boolean, scale: number): NativeSurfaceLayout;
export declare function visibleSurfaceBounds(layout: NativeSurfaceLayout, scale: number, viewport: ViewportLike): VisibleSurfaceBounds;
/** Canonical numeric clamp shared by the surface layout and geometry helpers. */
export declare function clamp(value: number, minimum: number, maximum: number): number;
export declare function sameNativeSurfacePosition(left: NativeSurfacePosition, right: NativeSurfacePosition | undefined, android: boolean): boolean;
