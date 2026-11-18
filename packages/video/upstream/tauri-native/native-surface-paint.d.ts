import type { VisibleSurfaceBounds } from './native-surface-layout';
import { type CornerRadii, type CornerRadiusStyles, type Rect } from './native-surface-geometry';
import { type BackgroundSnapshot, type ClippedOccluder, type DrilledAncestor, type InlinePropertySnapshot, type NativeCssSurfaceState } from './native-surface-state';
/**
 * Re-reads the real page styling with the aperture rule temporarily
 * disabled. All writes happen before all reads, and all mirror writes
 * happen after, so one refresh causes at most one style/layout calculation.
 */
export declare function refreshBackgrounds(state: NativeCssSurfaceState): void;
export declare function readBackground(element: HTMLElement): BackgroundSnapshot;
export declare function applyBackground(ancestor: DrilledAncestor, snapshot: BackgroundSnapshot): void;
export declare function createBackgroundPanels(ancestor: DrilledAncestor): void;
export declare function commitAncestor(ancestor: DrilledAncestor, rect: Rect, hole: VisibleSurfaceBounds, radii: CornerRadii): void;
export declare function commitOccluder(occluder: ClippedOccluder, rect: Rect, hole: VisibleSurfaceBounds): void;
export declare function hasVisibleBackground(computed: CSSStyleDeclaration): boolean;
export declare function cssPixels(value: string): number;
export declare function readCornerRadiusStyles(element: HTMLElement, computed?: CSSStyleDeclaration): CornerRadiusStyles;
export declare function setStyle(element: HTMLElement, property: string, value: string): void;
export declare function setProperty(element: HTMLElement, property: string, value: string, priority?: string): void;
export declare function inlineProperty(element: HTMLElement, property: string): InlinePropertySnapshot;
export declare function restoreInlineProperty(element: HTMLElement, property: string, snapshot: InlinePropertySnapshot): void;
