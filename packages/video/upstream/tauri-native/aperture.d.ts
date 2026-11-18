export interface NativeLayout {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** Preserve upstream background reconstruction and protected video overlays. */
export declare class NativeAperture {
    private readonly anchor;
    private compositor?;
    constructor(anchor: HTMLVideoElement);
    open(layout: NativeLayout | undefined): void;
    observe(invalidated: (backgroundChanged: boolean) => void): () => void;
    refresh(): void;
    close(): void;
    publish(layout: NativeLayout): void;
}
