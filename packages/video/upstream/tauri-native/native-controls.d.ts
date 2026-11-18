/** DOM overlays protected from the native video's aperture. */
export declare const VIDEO_CONTROLS_ATTRIBUTE = "data-viptv-video-controls";
export type VideoControlsTarget = HTMLElement;
export declare function registerVideoControls(element: VideoControlsTarget): () => void;
