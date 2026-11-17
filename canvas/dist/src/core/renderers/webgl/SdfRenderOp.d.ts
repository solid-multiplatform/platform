import { CoreRenderOp } from '../CoreRenderOp.js';
import type { WebGlCtxTexture } from './WebGlCtxTexture.js';
import type { WebGlRenderer } from './WebGlRenderer.js';
import type { BufferCollection } from './internal/BufferCollection.js';
import type { WebGlShaderNode } from './WebGlShaderNode.js';
import type { ClipRect } from '../../lib/utils.js';
import type { Stage } from '../../Stage.js';
/**
 * A batched SDF text render operation.
 *
 * Rather than owning its own WebGL buffer, this op references a range
 * inside the renderer's shared SDF vertex buffer. Multiple text nodes
 * that share the same atlas texture and clipping state are merged into
 * a single SdfRenderOp, producing one draw call for many strings.
 *
 * Instances are pooled by the renderer (see `WebGlRenderer.finalizeSdfBatch`)
 * and reused across frames, so every per-batch field is assigned in
 * {@link init}, which runs on each reuse. A field added here must also be
 * assigned there: a stale value surviving reuse is a rendering bug.
 */
export declare class SdfRenderOp extends CoreRenderOp {
    readonly renderer: WebGlRenderer;
    numQuads: number;
    time: number;
    readonly stage: Stage;
    /**
     * Index of the first quad in the shared SDF buffer.
     * Used to compute the byte offset into the element index buffer.
     */
    startQuad: number;
    /**
     * Translation applied to every vertex of this op in the vertex shader via
     * the per-op `u_translate` uniform (see `WebGlShaderProgram.bindRenderOp`).
     * Carries the delta of cache-hit text drawn away from its cache base (the
     * scroll path); 0/0 for static and freshly computed text. Ops merge only
     * when their deltas match, see `WebGlRenderer.finalizeSdfBatch`.
     */
    translateX: number;
    translateY: number;
    shader: WebGlShaderNode;
    quadBufferCollection: BufferCollection;
    renderOpTexture: WebGlCtxTexture;
    worldAlpha: number;
    /**
     * Stored by reference, never copied: draw() reads the caller-owned rect
     * live at draw time. init() must keep assigning the reference so pooling
     * does not change these aliasing semantics.
     */
    clippingRect: ClipRect;
    w: number;
    h: number;
    constructor(renderer: WebGlRenderer);
    /**
     * Reinitialize this op for a new batch. Assigns EVERY mutable field on the
     * class so a pooled instance is indistinguishable from a freshly
     * constructed one; `renderer` and `stage` are per-instance constants of
     * the owning renderer and stay readonly.
     */
    init(shader: WebGlShaderNode, quadBufferCollection: BufferCollection, renderOpTexture: WebGlCtxTexture, worldAlpha: number, clippingRect: ClipRect, w: number, h: number, startQuad: number, numQuads: number, translateX: number, translateY: number): void;
    draw(): void;
}
