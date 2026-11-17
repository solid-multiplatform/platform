import type { RendererCapabilities } from '../../common/types.js';
import type { ClipStore } from '../scene/ClipStore.js';
import { ContextSpy } from './contextSpy.js';
import { type GlContext } from './GlContext.js';
import type { OpList } from './OpList.js';
import { type CompressedData } from '../textures/compressed.js';
import { Program } from './Program.js';
import { type VertexStream } from './VertexStream.js';
export interface GlBackendSettings {
    forceWebGL2: boolean;
    disableVertexArrayObject: boolean;
    powerPreference: WebGLPowerPreference;
    enableContextSpy: boolean;
    /** 0xRRGGBBAA, uploaded straight as 1.10 did. */
    clearColor: number;
    /** Device pixels per logical pixel, compiled into every program. */
    pixelRatio: number;
    /**
     * Quads per chunk, the VertexStream's capacity (at most MAX_QUADS): sizes
     * the static index and node-coordinate buffers.
     */
    quadBufferSize: number;
}
/**
 * The WebGL backend (spec 7): static buffers, textures (0 is a 1x1 white
 * texture), programs (0 is Default), one vertex layout for every program,
 * and the draw loop. The OpList has already merged quads that share a
 * program, params block, texture and clip; a draw issues one drawElements
 * per op plus the state changes GlContext cannot skip.
 */
export declare class GlBackend {
    readonly ctx: GlContext;
    /** WebGL call counts when `enableContextSpy` is set (telemetry, phase 6). */
    readonly spy: ContextSpy | null;
    /** Programs by id; phase 4 sets a program's `perOp`. */
    readonly programs: Program[];
    /** This canvas's viewport as GLSL, for every program to compile in. */
    readonly viewport: string;
    /**
     * MAX_TEXTURE_SIZE, read once here (a CPU to GPU round trip, never in the
     * frame loop): the Uploader fails a larger texture, which WebGL would
     * refuse without an exception (TextureSink).
     */
    readonly maxTextureSize: number;
    /** Called when the context is lost; nothing is restored (1.10). */
    onContextLost: (() => void) | null;
    private readonly canvas;
    /** Device pixels per logical pixel: u_pixelRatio for a custom shader. */
    private readonly pixelRatio;
    private readonly textures;
    /** Texture 0: an op whose texture has no GL texture yet binds it. */
    private readonly white;
    private readonly vbo;
    private readonly nodeCoords;
    private readonly indices;
    private cleared;
    private views;
    private viewSource;
    private readonly lost;
    /** `canvas` is already sized: the viewport compiles in its size. */
    constructor(canvas: HTMLCanvasElement, settings: GlBackendSettings);
    /** A new frame: its first draw clears. */
    beginFrame(): void;
    /**
     * Draw one chunk (spec 7.3): clear if this is the frame's first draw,
     * upload the used quads once, then one drawElements per op. Called for
     * every chunk flushed mid-walk (RendererCore.onFlush) and for the last
     * chunk after update().
     */
    draw(stream: VertexStream, ops: OpList, clips: ClipStore): void;
    /**
     * Compile and link a program; returns its id (0 is Default). Throws when
     * linking fails, or when the device lacks one of `extensions` (a custom
     * shader's 1.10 `webgl1Extensions`, each enabled before compiling, since
     * enabling one is what lets a shader use it). A program that declares
     * `u_resolution` or `u_pixelRatio` gets them now: neither changes after
     * construction. `name` is the Program's, for developer tools.
     */
    registerProgram(vertex: string, fragment: string, extensions?: string[] | null, name?: string): number;
    /**
     * Upload pixels as texture `id`, the op texture id, creating its GL
     * texture on first use. 0 is the white texture: phase 3's texture record
     * ids start at 1, since an upload to 0 would overwrite it. `premultiply`
     * is true for straight-alpha sources.
     */
    uploadTexture(id: number, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
    /**
     * Upload a compressed texture as texture `id`; false when the device has
     * no extension for its format (the texture then fails for good).
     */
    uploadCompressed(id: number, data: CompressedData): boolean;
    deleteTexture(id: number): void;
    /** The idle GL out-of-memory probe (GlContext.outOfMemory): idle maintenance only. */
    outOfMemory(): boolean;
    setClearColor(rgba: number): void;
    /** Reads GL parameters (a CPU to GPU round trip): call it once. */
    getCapabilities(): RendererCapabilities;
    /**
     * Stop listening for context loss and release every GL object by losing
     * the context: the canvas cannot host another renderer afterwards.
     */
    destroy(): void;
    /**
     * The used part of the stream rounded up to a multiple of UPLOAD_QUADS:
     * WebGL1 uploads whole views and `subarray` allocates, so one view per
     * size is created on first use and reused.
     */
    private uploadView;
    /** Point every attribute at its buffer, in the bound VAO. */
    private point;
}
