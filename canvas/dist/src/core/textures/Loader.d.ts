import type { Platform } from '../../platform/Platform.js';
import { type TextureStore } from './TextureStore.js';
/**
 * A ColorTexture's 1x1 pixel, as 1.10 built it: the colour read as
 * 0xAARRGGBB (opaque white as is).
 */
export declare function colorPixel(color: number): Uint8Array;
/** A NoiseTexture's pixels, as 1.10 generated them: one random grey per pixel, opaque. */
export declare function noise(w: number, h: number): ImageData;
/** The renderer settings the loader reads (spec 13.2). */
export interface LoaderSettings {
    /** 0 or 1: decode in the image worker or on the main thread. */
    numImageWorkers: number;
    /** Loads in flight at most; 0 is unbounded. */
    imageDecodeConcurrency: number;
    createImageBitmapSupport: 'auto' | 'basic' | 'options' | 'full';
    premultiplyAlphaHonored: boolean | 'auto';
    pixelRatio: number;
}
/**
 * Starts loads (spec 9.3): takes records from the store's priority queue,
 * at most `imageDecodeConcurrency` in flight, and reports each result back
 * to the store. One record is one load, so a source shared by many nodes
 * is fetched once, and a record a node scrolled away from before its turn
 * is cancelled by the queue rather than fetched.
 *
 * The decode strategy is chosen once, before the first load and never
 * inside the constructor: the createImageBitmap probe (three 1x1 decodes)
 * and, when asked for, the premultiply probe run first, and images queued
 * meanwhile wait. A worker that crashes sends the images after it to the
 * main thread. Colour and noise textures fetch nothing: they are made at
 * the next dispatch, before the probes finish too, and take no slot (1.10).
 */
export declare class Loader {
    /** The probes finished: image loads can start. */
    ready: boolean;
    /** Image loads started and not yet finished. */
    inFlight: number;
    private readonly platform;
    private readonly store;
    private readonly settings;
    private ctx;
    private destroyed;
    private readonly onLoaded;
    private readonly onFailed;
    /** The worker crashed (ImageWorkerManager.onUnavailable). */
    private readonly workerLost;
    constructor(platform: Platform, store: TextureStore, settings: LoaderSettings);
    /**
     * Make the queued colour and noise textures, then start queued image
     * loads up to the in-flight limit: after each draw, when a load
     * finishes, when a retry queues a record, and when the probes finish
     * (images wait for them).
     */
    dispatch(): void;
    /**
     * Renderer.destroy: stop the image worker. Nothing starts after it: not
     * a load when one finishes, nor a worker when a probe does.
     */
    destroy(): void;
    /** An image loads asynchronously and takes a slot. */
    private start;
    /**
     * A colour or noise texture, made here and now. A noise size ImageData
     * rejects fails the texture, as 1.10 did.
     */
    private generate;
    private resolvePremultiply;
    private init;
}
