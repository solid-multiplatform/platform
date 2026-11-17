import { CoreRenderer, type BufferInfo, type CoreRendererOptions, type RendererCapabilities } from '../CoreRenderer.js';
import { SdfRenderOp } from './SdfRenderOp.js';
import type { CoreContextTexture } from '../CoreContextTexture.js';
import { type WebGlColor } from './internal/RendererUtils.js';
import { WebGlCtxTexture } from './WebGlCtxTexture.js';
import { Texture, type TextureCoords } from '../../textures/Texture.js';
import { BufferCollection } from './internal/BufferCollection.js';
import { WebGlShaderProgram } from './WebGlShaderProgram.js';
import { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import { CoreNode } from '../../CoreNode.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import { WebGlShaderNode } from './WebGlShaderNode.js';
import type { Matrix3d } from '../../lib/Matrix3d.js';
export type WebGlRendererOptions = CoreRendererOptions;
export type WebGlRenderOp = CoreNode | SdfRenderOp;
export declare class WebGlRenderer extends CoreRenderer {
    glw: WebGlContextWrapper;
    /**
     * Main quad vertex buffer. Layout per vertex (5 x 32-bit words = 20 bytes,
     * so 80 bytes per quad — see {@link BYTES_PER_QUAD}):
     *   [0] x (float32)  - world pixel X
     *   [1] y (float32)  - world pixel Y
     *   [2] u (float32)  - texture U
     *   [3] v (float32)  - texture V
     *   [4] color (uint32) - ABGR packed, read as vec4 normalized
     *
     * `fQuadBuffer` and `uiQuadBuffer` alias the same ArrayBuffer; words 0-3 are
     * written through the float view, word 4 through the uint view.
     */
    quadBuffer: ArrayBuffer;
    fQuadBuffer: Float32Array;
    uiQuadBuffer: Uint32Array;
    renderOps: WebGlRenderOp[];
    /**
     * Deferred queue for SDF text render ops, used when RENDER_TEXT_BATCHING is
     * true. All text encountered during the frame is collected here and appended
     * to renderOps at the end (see flushTextRenderOps). This guarantees that all
     * text in a frame draws in a single contiguous run of draw calls, which is
     * the whole point of text batching.
     *
     * Side effect by design: text always draws on top of any non-text quads that
     * came after it in tree order (unless those quads carry an explicit zIndex,
     * which forces an early flush in addQuad). This is intentional — UI text
     * sitting above adjacent backgrounds/icons is the common case, and the
     * batching win is only worth taking if we don't break the run with mid-frame
     * flushes. If you need a non-text quad to land above earlier text, give it
     * a non-zero zIndex.
     */
    coreTextRenderOps: WebGlRenderOp[];
    /**
     * Grow-only pool of SdfRenderOp instances, indexed by {@link sdfOpPoolIdx}.
     * finalizeSdfBatch takes the next instance and reinitializes every field
     * via SdfRenderOp.init, so a text-heavy screen allocates ops only until its
     * peak batch count and never again. The pool never shrinks (same philosophy
     * as the vertex buffers) and instances are never handed back mid-frame.
     */
    sdfOpPool: SdfRenderOp[];
    /**
     * Next pool slot finalizeSdfBatch hands out. Rewound in {@link reset}
     * alongside the op-list clear; see the invariant comment there.
     */
    sdfOpPoolIdx: number;
    curBufferIdx: number;
    curRenderOp: WebGlRenderOp | null;
    /**
     * The shader program currently bound to the GL context.
     *
     * @remarks
     * Deliberately not cleared in `reset()`: a GL program binding survives the
     * frame boundary, so the redundant-bind skip in `useShader` stays valid
     * across frames.
     */
    private attachedShader;
    /**
     * Shared vertex buffer for all SDF text glyphs.
     * Layout per vertex (6 floats = 24 bytes):
     *   [0] x (float) - world pixel X
     *   [1] y (float) - world pixel Y
     *   [2] u (float) - atlas U
     *   [3] v (float) - atlas V
     *   [4] color (uint32) - ABGR packed, read as vec4 normalized
     *   [5] distRange (float) - SDF distance range
     *
     * 4 vertices per glyph → 24 float units per glyph.
     * Triangles are formed via the shared element index buffer.
     */
    sdfBuffer: ArrayBuffer;
    fSdfBuffer: Float32Array;
    uiSdfBuffer: Uint32Array;
    sdfBufferIdx: number;
    /** Running count of SDF quads written this frame (for element offset). */
    sdfQuadCount: number;
    sdfQuadBufferCollection: BufferCollection;
    curSdfRenderOp: SdfRenderOp | null;
    /**
     * Whether the shared SDF buffer's bytes may differ from what the GPU
     * currently holds. Set by every write path that produces fresh bytes
     * (cache-miss recompute, the settle-time delta fold in
     * {@link SdfTextRenderer}), by anything that can shift offsets or resize
     * the buffer (render-list rebuild, backing-store growth), and consumed by
     * {@link uploadSdfBuffer}.
     *
     * The cache-hit mem-copy path does NOT set it: it writes each node's cache
     * bytes unmodified regardless of position, because a moved node's delta
     * rides its render op as the u_translate uniform instead of being added
     * into the vertices. The bytes are therefore position-independent and match
     * the previous frame whenever the same caches were written in the same
     * order, which the size and fingerprint halves of the skip test confirm.
     * Conservative direction: when in doubt, set it. A redundant upload is
     * correct, a wrong skip is a glitch.
     */
    sdfBufferChanged: boolean;
    /**
     * Float32 length of the last main-pass SDF upload — the size half of the
     * skip test in {@link uploadSdfBuffer}.
     */
    lastUploadedSdfSize: number;
    /**
     * Order-sensitive fingerprint of this frame's SDF writes (each batch's glyph
     * count folded in write order), reset every frame in {@link reset}. Equal
     * total size does not imply equal layout: a different set of text nodes, or
     * the same set in a different order, can land on the same `sdfBufferIdx`
     * while every glyph sits at a different offset. Comparing the fingerprint
     * keeps the skip decision derived from what the renderer actually did this
     * frame rather than from scene-graph hooks firing correctly.
     */
    sdfWriteSig: number;
    /** {@link sdfWriteSig} at the time of the last main-pass SDF upload. */
    lastUploadedSdfSig: number;
    defaultTextureCoords: Readonly<TextureCoords>;
    defaultShaderNode: WebGlShaderNode | null;
    quadBufferCollection: BufferCollection;
    /**
     * Shared static element (index) buffer for quad rendering.
     *
     * @remarks
     * Bound once globally, but also recorded into each shader program's Vertex
     * Array Object since the element-array binding is part of VAO state.
     */
    indexBuffer: WebGLBuffer | null;
    clearColor: WebGlColor;
    /**
     * White pixel texture used by default when no texture is specified.
     */
    quadBufferUsage: number;
    numQuadsRendered: number;
    /**
     * Cached view over {@link quadBuffer} for the per-frame upload.
     *
     * @remarks
     * Rebuilt only when the number of words written changes, which is when the
     * quad count does. `quadBuffer` is allocated once in the constructor and
     * never replaced, so the view stays valid for the renderer's lifetime and a
     * steady scene uploads without allocating.
     */
    private quadUploadView;
    /**
     * Byte size of `quadBuffer`.
     *
     * @remarks
     * `stage.options.quadBufferSize` clamped to {@link MAX_QUAD_BUFFER_SIZE}.
     * Bytes past that ceiling are unreachable — their quads fall outside the
     * Uint16 index range — so allocating them only costs heap on the most
     * constrained devices.
     */
    quadBufferSize: number;
    constructor(options: WebGlRendererOptions);
    /**
     * Listen for WebGL context loss on the canvas.
     *
     * @remarks
     * On low-RAM devices (e.g. Chromium 123+ after backgrounding) the GPU
     * context is dropped, after which `gl.createTexture()` and friends return
     * null and the engine would crash. We pause the render loop via the Stage
     * flag and surface a `contextLost` event so consumers can react.
     *
     * We intentionally do NOT call `event.preventDefault()` (which would ask the
     * browser to restore the context) and do NOT listen for
     * `webglcontextrestored`: the engine cannot rebuild its GPU resources
     * in-place, so the supported recovery is to reload the app. See BROWSERS.md.
     */
    private attachContextLossListeners;
    reset(): void;
    createShaderProgram(shaderType: WebGlShaderType, props: Record<string, unknown>): WebGlShaderProgram;
    createShaderNode(shaderKey: string, shaderType: WebGlShaderType, props?: Record<string, unknown>, program?: WebGlShaderProgram): WebGlShaderNode<Record<string, unknown>>;
    supportsShaderType(shaderType: Readonly<WebGlShaderType>): boolean;
    createCtxTexture(textureSource: Texture): CoreContextTexture;
    /**
     * This function adds a quad (a rectangle composed of two triangles) to the WebGL rendering pipeline.
     *
     * It takes a set of options that define the quad's properties, such as its dimensions, colors, texture, shader, and transformation matrix.
     * The function first updates the shader properties with the current dimensions if necessary, then sets the default texture if none is provided.
     * It then checks if a new render operation is needed, based on the current shader and clipping rectangle.
     * If a new render operation is needed, it creates one and updates the current render operation.
     * The function then adjusts the texture coordinates based on the texture options and adds the texture to the texture manager.
     *
     * Finally, it calculates the vertices for the quad, taking into account any transformations, and adds them to the quad buffer.
     * The function updates the length and number of quads in the current render operation, and updates the current buffer index.
     */
    addQuad(node: CoreNode, texture?: Texture): void;
    /**
     * Replace the existing RenderOp with a new one that uses the specified Shader
     * and starts at the specified buffer index.
     *
     * @param shader
     * @param bufferIdx
     */
    private newRenderOp;
    /**
     * Test if the current Render operation can be reused for the specified parameters.
     * @param params
     * @returns
     */
    reuseRenderOp(node: CoreNode): boolean;
    /**
     * add RenderOp to the render pipeline
     */
    addRenderOp(renderable: WebGlRenderOp): void;
    flushTextRenderOps(): void;
    /**
     * Append pre-transformed SDF glyph vertices to the shared SDF buffer
     * and manage SDF render op batching.
     *
     * @remarks
     * This method pre-transforms glyph positions from design units to world
     * pixel space on the CPU, packs per-vertex color and distanceRange, and
     * writes them into the shared SDF buffer. Compatible consecutive calls
     * (same atlas, same clipping) are merged into a single SdfRenderOp,
     * resulting in one draw call for many text nodes.
     */
    addSdfQuads(glyphs: Float32Array, glyphCount: number, fontScale: number, transform: Matrix3d, color: number, worldAlpha: number, distanceRange: number, atlasTexture: WebGlCtxTexture, clippingRect: import('../../lib/utils.js').ClipRect, width: number, height: number, sdfShader: WebGlShaderNode): void;
    /**
     * Fast path: copy pre-computed cached SDF vertex data into the shared
     * buffer and create/extend an SdfRenderOp carrying the node's translation
     * delta.
     *
     * @remarks
     * When a text node's layout, linear transform, color and alpha are
     * unchanged, the per-glyph matrix multiplication is skipped entirely. The
     * cached Float32Array is written via a single `Float32Array.set()`
     * (memcpy) regardless of position: a node that moved by pure translation
     * since its cache was built (the scroll path) hands the delta to the
     * render op, where it reaches the vertex shader as the per-op u_translate
     * uniform. Byte-identical rewrites are what let {@link uploadSdfBuffer}
     * skip the per-frame `bufferData`, so this path must never modify the
     * copied bytes and never raises `sdfBufferChanged`.
     *
     * The copy MUST stay a typed-array `set` (bit-exact memcpy): packed ABGR
     * colors live in the same Float32Array and some bit patterns are float32
     * NaNs, which element-wise float reads/writes may canonicalize and corrupt.
     */
    addSdfCachedQuads(cachedVertices: Float32Array, numGlyphs: number, dx: number, dy: number, atlasTexture: WebGlCtxTexture, clippingRect: import('../../lib/utils.js').ClipRect, worldAlpha: number, width: number, height: number, sdfShader: WebGlShaderNode): void;
    /**
     * Shared batching logic for SDF render ops.
     * Called by both `addSdfQuads` (full compute) and `addSdfCachedQuads` (fast copy).
     */
    private finalizeSdfBatch;
    /**
     * Drop caches that are keyed to render-list order.
     *
     * @remarks
     * Called by the Stage when the render list is about to be rebuilt. A rebuild
     * can reorder text nodes without touching their SDF vertex caches;
     * byte-identical glyph data would then land at different offsets, so the
     * upload skip in {@link uploadSdfBuffer} must not fire on the rebuild frame.
     *
     * The quad buffer needs nothing here: it is rebuilt from scratch every frame.
     */
    invalidateRenderListCaches(): void;
    /**
     * Resizes the shared SDF ArrayBuffer if the required size (in floats) goes beyond
     * the current buffer capacity.
     *
     * @returns false when the request exceeds {@link MAX_SDF_BUFFER_SIZE}, in
     * which case the buffer is left untouched and the caller must skip its write
     * entirely — a partial write would desync `sdfBufferIdx` from the backing
     * store and throw on the next `set()` or upload.
     */
    private ensureSdfBufferCapacity;
    /**
     * Bind a shader program, detaching the previously bound one.
     *
     * @remarks
     * This is GL context state, so it belongs to the renderer that owns the
     * context rather than to the backend-agnostic `CoreShaderManager` (Canvas2D
     * never had a use for it). Every `WebGlShaderProgram` implements both
     * `attach` and `detach`, so the optional-method probes the old
     * `CoreShaderProgram`-typed version needed are gone from this per-render-op
     * path.
     */
    useShader(program: WebGlShaderProgram): void;
    /**
     * Render the current set of RenderOps to render to the specified surface.
     *
     * The quad buffer is rebuilt on the CPU each frame by `addQuad` and uploaded
     * to the GPU in a single `bufferData` call.
     *
     * TODO: 'screen' is the only supported surface at the moment.
     *
     * @param surface
     */
    render(surface?: 'screen' | CoreContextTexture): void;
    /**
     * Upload the shared SDF buffer for the main pass, skipping the driver-side
     * `bufferData` copy when the bytes provably match what the GPU already
     * holds. All three must agree:
     *
     * 1. `sdfBufferChanged` is false — no write path produced fresh bytes, and
     *    no node snapped back to its cache base after a translated frame.
     * 2. The total size matches the last upload.
     * 3. The write fingerprint matches the last upload — same batches, same
     *    order, so byte-identical data landed at byte-identical offsets.
     *
     * (2) alone is not enough: a different set of text nodes can reach the same
     * total. Uncertainty resolves toward uploading — a redundant `bufferData`
     * costs a driver-side copy, a wrong skip leaves text drawn at a stale
     * position until some later frame happens to force an upload.
     */
    private uploadSdfBuffer;
    getQuadCount(): number;
    getRenderOpCount(): number;
    getBufferInfo(): BufferInfo | null;
    getCapabilities(): RendererCapabilities;
    /**
     * Drain the GL error queue once and report whether a GL_OUT_OF_MEMORY was
     * seen since the last call.
     *
     * @remarks
     * `gl.getError()` forces a CPU↔GPU sync, so this is deliberately invoked at
     * most once per frame by the Stage rather than after each texture upload.
     * `getError()` returns one error at a time, so we drain a bounded number of
     * queued errors to ensure a non-OOM error ahead of the OOM doesn't mask it
     * for this frame. Non-OOM errors are ignored here (the renderer otherwise
     * only inspects them in development builds).
     */
    checkForOutOfMemory(): boolean;
    getDefaultShaderNode(): WebGlShaderNode;
    getTextureCoords(node: CoreNode): TextureCoords | undefined;
    /**
     * Sets the glClearColor to the specified color.   *
     * @param color - The color to set as the clear color, represented as a 32-bit integer.
     */
    updateClearColor(color: number): void;
}
