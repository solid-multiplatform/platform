import type { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import type { CoreShaderProgram } from '../CoreShaderProgram.js';
import type { WebGlCtxTexture } from './WebGlCtxTexture.js';
import type { WebGlRenderer, WebGlRenderOp } from './WebGlRenderer.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import type { BufferCollection } from './internal/BufferCollection.js';
import { CoreNode } from '../../CoreNode.js';
export declare class WebGlShaderProgram implements CoreShaderProgram {
    protected program: WebGLProgram | null;
    protected renderer: WebGlRenderer;
    protected glw: WebGlContextWrapper;
    protected attributeLocations: string[];
    protected uniformLocations: Record<string, WebGLUniformLocation> | null;
    protected lifecycle: Pick<WebGlShaderType, 'update' | 'canBatch'>;
    protected useSystemAlpha: boolean;
    protected useSystemDimensions: boolean;
    protected useSystemTranslate: boolean;
    /**
     * The program grows its quad past the node (border and shadow shaders, see
     * `growQuadGlsl`), so it takes the node's 2x2 world transform
     * (`u_nodeTransform`) and the UV rect its quad samples (`u_uvRect`) as
     * per-draw system uniforms.
     */
    protected useSystemTransform: boolean;
    protected useSystemUvRect: boolean;
    protected useTimeValue: boolean;
    /**
     * The program declares `u_pixelRatio` / `u_resolution` and they have not
     * been uploaded yet. Built-in shaders compile the viewport in instead
     * (`viewportGlsl`); custom shaders written against the documented system
     * uniforms still get them, once, since neither value changes after
     * construction.
     */
    protected viewportUniformsPending: boolean;
    /**
     * Shadow copies of this program's GL uniform state, used by
     * {@link bindRenderOp} to skip redundant gl.uniform* calls.
     *
     * @remarks
     * GL uniform values are state on the program object and persist across
     * useProgram switches, and bindRenderOp is the only writer of these
     * uniforms, so the shadows always mirror GL truth — even when ops using
     * other programs are interleaved between two ops of this program.
     *
     * `lastBoundUniforms` tracks the shader node's uniform collection by
     * identity: collections are created once, filled once, and shared by
     * reference across shader nodes with the same value key (see
     * WebGlShaderNode.update), so reference equality implies value equality.
     * The failure direction is safe — a new collection holding identical
     * values just causes a redundant upload, never a wrong skip.
     *
     * Sentinels: -1 never collides with real alphas, dimensions, time values
     * or texture coords (all >= 0).
     */
    protected lastBoundUniforms: unknown;
    protected lastAlpha: number;
    protected lastDimensionsW: number;
    protected lastDimensionsH: number;
    protected lastTime: number;
    /**
     * The u_translate shadows start at NaN, not -1: a translation delta is the
     * one system uniform that can legitimately be negative (-1 included), and
     * NaN compares unequal to every value, so the first bind always uploads.
     */
    protected lastTranslateX: number;
    protected lastTranslateY: number;
    /** NaN as well: rotations and flips make transform components negative. */
    protected lastTransformA: number;
    protected lastTransformB: number;
    protected lastTransformC: number;
    protected lastTransformD: number;
    protected lastUvX1: number;
    protected lastUvY1: number;
    protected lastUvX2: number;
    protected lastUvY2: number;
    /**
     * Cached Vertex Array Objects, keyed by the buffer collection they capture.
     *
     * @remarks
     * A VAO records this program's attribute layout (enabled arrays, pointers and
     * their source buffers) plus the shared element index buffer, so a draw only
     * needs a single `bindVertexArray` instead of re-pointing every attribute. In
     * practice a program only ever binds one collection, but keying by collection
     * keeps it correct if that ever changes. Empty / unused when the context has
     * no VAO support (see {@link WebGlContextWrapper.canUseVertexArrayObject}).
     */
    protected vaos: Map<BufferCollection, WebGLVertexArrayObject | null>;
    constructor(renderer: WebGlRenderer, config: WebGlShaderType, resolvedProps: Record<string, any>);
    disableAttributes(): void;
    reuseRenderOp(node: CoreNode, currentRenderOp: WebGlRenderOp): boolean;
    /**
     * The buffer collection is passed in rather than read off the op: every
     * CoreNode resolved it through a getter that hopped to `stage.renderer` and
     * cast to the WebGL renderer, which made this a polymorphic access (getter
     * on CoreNode, plain field on SdfRenderOp). Both callers already hold the
     * collection.
     */
    bindRenderOp(renderOp: WebGlRenderOp, buffer: BufferCollection): void;
    bindBufferCollection(buffer: BufferCollection): void;
    /**
     * Point this program's vertex attributes at the given buffer collection.
     * When a VAO is bound this records into it; otherwise it mutates global state.
     */
    private bindAttributes;
    /**
     * Create and populate a Vertex Array Object capturing this program's
     * attribute layout for the given buffer collection. The new VAO is left bound.
     * Returns null if the context reports VAO support but allocation fails (e.g.
     * under GL OOM), in which case the caller falls back to per-draw binding.
     */
    private createVao;
    /**
     * A render op binds exactly one texture. The undefined check is not dead
     * defensiveness: a GPU OOM releases a Texture and clears its ctxTexture, so
     * the op can be holding a stale reference by the time it draws.
     */
    bindTexture(texture: WebGlCtxTexture | null): void;
    attach(): void;
    detach(): void;
}
