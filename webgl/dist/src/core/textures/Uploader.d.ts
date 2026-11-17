import { type TextureStore } from './TextureStore.js';
import type { MemoryManager } from './MemoryManager.js';
import type { AtlasPages } from './AtlasPages.js';
import type { CompressedData } from './compressed.js';
/** Where pixels go: GlBackend implements it. */
export interface TextureSink {
    /**
     * The largest texture side the device takes (MAX_TEXTURE_SIZE, read once
     * at startup); 0 when unknown.
     */
    readonly maxTextureSize: number;
    uploadTexture(id: number, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
    /** False when the device cannot take the compressed format. */
    uploadCompressed(id: number, data: CompressedData): boolean;
    deleteTexture(id: number): void;
}
/**
 * GPU bytes of an upload, 1.10's estimate: RGBA plus 10% driver padding
 * for an image, 4 bytes a pixel for raw bytes (a ColorTexture).
 */
export declare function uploadBytes(data: unknown, w: number, h: number): number;
/** While animating, an upload of more pixels than this waits (spec 9.4)... */
export declare const ANIMATING_PIXELS = 500000;
/** ...for at most this many animated frames, so a looping animation cannot starve it. */
export declare const ANIMATING_WAIT = 30;
/**
 * Uploads decoded textures after a frame's draw (spec 9.4), so the GPU
 * works through the frame's draw calls while texImage2D copies pixels, and
 * a texture uploaded in frame N draws in frame N+1. While animating: at most
 * one upload per frame, and a larger one than 0.5 M pixels waits at the back
 * of the queue (time is 1 ms granular on device; pixels are the reliable
 * budget). Otherwise: uploads until the time limit, reading the clock once
 * per upload. The Renderer runs it on a frame with nothing to draw too (an
 * animation's delay), so that a large texture's wait counts there without a
 * draw of its own.
 */
export declare class Uploader {
    private readonly store;
    private readonly sink;
    private readonly now;
    private readonly requestFrame;
    private readonly memory;
    /** Shared pages for small images (the imageAtlas setting); null when off. */
    private readonly atlas;
    /** The sink's maxTextureSize, Infinity when unknown. */
    private readonly maxSize;
    /**
     * Animated frames that sent a large texture back since the last large
     * upload, or since the queue was last empty.
     */
    private waited;
    /**
     * `requestFrame` asks for the frame that carries on with what a run left
     * (the Renderer: a frame for the uploader alone, as for a decode; an
     * upload marks its own nodes, which ask for the draw).
     */
    constructor(store: TextureStore, sink: TextureSink, now: () => number, requestFrame: () => void, memory?: MemoryManager | null, atlas?: AtlasPages | null);
    /**
     * doNotExceedCriticalThreshold: while critical, uploads wait (spec 9.3: a
     * deferral, not a failure) for a cleanup to make room, which asks for a
     * frame (MemoryManager): the frame's own critical cleanup, or a later
     * one should the unwanted records still be within their grace period.
     * What nobody wants any more is released meanwhile rather than held at
     * the ceiling (1.10 failed it), and the check for room comes back only
     * for a texture someone still wants.
     */
    private held;
    /**
     * Upload within the frame's budget; returns how many uploads ran (a
     * texture failed for good counts as one).
     */
    run(animating: boolean, timeLimit: number): number;
    /**
     * Renderer.destroy: close the decoded data no upload will take now (an
     * ImageBitmap holds native memory until it is closed).
     */
    destroy(): void;
    /**
     * One upload at most: the first decoded texture within ANIMATING_PIXELS.
     * A larger one goes to the back of the queue, so that it holds up nothing
     * behind it; a frame that sends one back counts a wait, and after
     * ANIMATING_WAIT of them the next one goes, whatever its size.
     */
    private runAnimating;
    /**
     * Upload `rec`, or fail it for good: larger than the device takes (WebGL
     * would refuse it without an exception, and it would sample black), or
     * refused by the upload (it throws).
     */
    private upload;
    /**
     * `rec` onto an atlas page: a slot on the first page with room, or on a
     * new one (one texImage2D with no pixels, in the same budget). The page
     * counts the bytes, so the image counts none. A refused upload gives the
     * slot back (a hole: the page reuses none) and fails for good.
     */
    private uploadToPage;
    /**
     * An upload refused `rec`: it fails for good, and the GL texture the
     * upload may have created goes with it (a failed record is never freed,
     * and the next record in its slot must start from a fresh one).
     */
    private failUpload;
    /**
     * A compressed container. A KTX level 0 goes up block-padded
     * (compressed.ts), so its UV rect stops short of the padding (1.10
     * txCoords); PVR and ASTC go up at their own size. 1.10 counted the first
     * level's bytes. A device with no extension for the format, or an upload
     * that throws, fails it for good.
     */
    private uploadCompressed;
}
