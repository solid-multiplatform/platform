import { CoreRenderOp } from '../CoreRenderOp.js';
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
export class SdfRenderOp extends CoreRenderOp {
    renderer;
    numQuads = 0;
    time = 0;
    stage;
    /**
     * Index of the first quad in the shared SDF buffer.
     * Used to compute the byte offset into the element index buffer.
     */
    startQuad = 0;
    /**
     * Translation applied to every vertex of this op in the vertex shader via
     * the per-op `u_translate` uniform (see `WebGlShaderProgram.bindRenderOp`).
     * Carries the delta of cache-hit text drawn away from its cache base (the
     * scroll path); 0/0 for static and freshly computed text. Ops merge only
     * when their deltas match, see `WebGlRenderer.finalizeSdfBatch`.
     */
    translateX = 0;
    translateY = 0;
    shader;
    quadBufferCollection;
    renderOpTexture;
    worldAlpha = 0;
    /**
     * Stored by reference, never copied: draw() reads the caller-owned rect
     * live at draw time. init() must keep assigning the reference so pooling
     * does not change these aliasing semantics.
     */
    clippingRect;
    w = 0;
    h = 0;
    constructor(renderer) {
        super();
        this.renderer = renderer;
        this.stage = renderer.stage;
    }
    /**
     * Reinitialize this op for a new batch. Assigns EVERY mutable field on the
     * class so a pooled instance is indistinguishable from a freshly
     * constructed one; `renderer` and `stage` are per-instance constants of
     * the owning renderer and stay readonly.
     */
    init(shader, quadBufferCollection, renderOpTexture, worldAlpha, clippingRect, w, h, startQuad, numQuads, translateX, translateY) {
        this.shader = shader;
        this.quadBufferCollection = quadBufferCollection;
        this.renderOpTexture = renderOpTexture;
        this.worldAlpha = worldAlpha;
        this.clippingRect = clippingRect;
        this.w = w;
        this.h = h;
        this.startQuad = startQuad;
        this.numQuads = numQuads;
        this.translateX = translateX;
        this.translateY = translateY;
        this.time = 0;
    }
    draw() {
        const glw = this.renderer.glw;
        this.renderer.useShader(this.shader.program);
        this.shader.program.bindRenderOp(this, this.quadBufferCollection);
        // Clipping: the scissor box was derived when the rect was written
        const cr = this.clippingRect;
        if (cr.valid === true) {
            glw.setScissorTest(true);
            glw.scissor(cr.scissorX, cr.scissorY, cr.scissorW, cr.scissorH);
        }
        else {
            glw.setScissorTest(false);
        }
        // Draw the batch range from the shared SDF buffer using indexed rendering.
        // 4 vertices per glyph, 6 indices per glyph (2 triangles).
        // Byte offset into the shared Uint16 index buffer:
        const byteOffset = this.startQuad * 6 * 2;
        glw.drawElements(glw.TRIANGLES, 6 * this.numQuads, glw.UNSIGNED_SHORT, byteOffset);
    }
}
//# sourceMappingURL=SdfRenderOp.js.map