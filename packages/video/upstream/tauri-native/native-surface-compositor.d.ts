import { type NativeSurfaceLayout, type VisibleSurfaceBounds } from './native-surface-layout';
import { type CornerRadii, type Rect } from './native-surface-geometry';
import { type VideoControlsTarget } from './native-controls';
export { VIDEO_CONTROLS_ATTRIBUTE, type VideoControlsTarget } from './native-controls';
export { outsidePanels } from './native-surface-geometry';
/**
 * Marks arbitrary DOM as intentional video UI. The element can live anywhere
 * in the document; it does not need to be a child of or overlap the video.
 */
export declare function registerVideoControls(target: VideoControlsTarget): () => void;
export interface SurfaceCompositorFrame {
    bounds: VisibleSurfaceBounds;
    width: number;
    height: number;
    radii: CornerRadii;
    ancestors: readonly ElementFrame[];
    occluders: readonly ElementFrame[];
}
interface ElementFrame {
    element: HTMLElement;
    rect: Rect;
}
/**
 * Owns the transparent aperture and exact background reconstruction around it.
 * Reads happen in `measure`; DOM writes happen in `commit`, keeping every
 * animation frame free of read/write layout thrashing.
 */
export declare class NativeSurfaceCompositor {
    #private;
    constructor(owner: string, anchor: HTMLVideoElement);
    measure(layout: NativeSurfaceLayout, scale: number): SurfaceCompositorFrame;
    commit(frame: SurfaceCompositorFrame): void;
    /** Re-reads backgrounds and repairs the ancestor chain after DOM changes. */
    refresh(): void;
    /**
     * Watches only mutations that can move the anchor or change a drilled
     * background. Unrelated component updates do not enter the layout path.
     */
    observe(onInvalidated: (backgroundChanged: boolean) => void): () => void;
    release(): void;
}
