import { type VisibleSurfaceBounds } from './native-surface-layout';
export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface CornerRadius {
    x: number;
    y: number;
}
export type CornerRadii = readonly [CornerRadius, CornerRadius, CornerRadius, CornerRadius];
export type CornerRadiusStyles = readonly [string, string, string, string];
export declare const ZERO_RADII: CornerRadii;
export declare const ZERO_RADIUS_STYLES: CornerRadiusStyles;
export declare function outsidePanels(ancestor: Rect, hole: VisibleSurfaceBounds): readonly Rect[];
export declare function intersectBounds(first: VisibleSurfaceBounds, second: VisibleSurfaceBounds): VisibleSurfaceBounds;
export declare function subtractRadius(radius: CornerRadius, horizontal: number, vertical: number): CornerRadius;
export declare function parseCornerRadii(styles: CornerRadiusStyles, bounds: VisibleSurfaceBounds): CornerRadii;
export declare function radiiForIntersection(bounds: VisibleSurfaceBounds, shape: VisibleSurfaceBounds, radii: CornerRadii): CornerRadii;
export declare function mergeIntersectionRadii(previousBounds: VisibleSurfaceBounds, previousRadii: CornerRadii, bounds: VisibleSurfaceBounds, shape: VisibleSurfaceBounds, shapeRadii: CornerRadii): CornerRadii;
export declare function cornerPanels(bounds: VisibleSurfaceBounds, radii: CornerRadii): readonly Rect[];
export declare const CORNER_CLIP_PATHS: readonly string[];
