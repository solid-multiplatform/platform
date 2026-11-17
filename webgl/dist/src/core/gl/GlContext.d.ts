import type { ContextSpy } from './contextSpy.js';
export declare const ARRAY_BUFFER = 34962;
export declare const ELEMENT_ARRAY_BUFFER = 34963;
export declare const STATIC_DRAW = 35044;
export declare const DYNAMIC_DRAW = 35048;
export declare const TEXTURE_2D = 3553;
export declare const TRIANGLES = 4;
export declare const UNSIGNED_BYTE = 5121;
export declare const UNSIGNED_SHORT = 5123;
export declare const FLOAT = 5126;
export declare const COLOR_BUFFER_BIT = 16384;
export declare const SCISSOR_TEST = 3089;
export declare const BLEND = 3042;
export declare const ONE = 1;
export declare const ONE_MINUS_SRC_ALPHA = 771;
export declare const RGBA = 6408;
export declare const TEXTURE_MAG_FILTER = 10240;
export declare const TEXTURE_MIN_FILTER = 10241;
export declare const TEXTURE_WRAP_S = 10242;
export declare const TEXTURE_WRAP_T = 10243;
export declare const LINEAR = 9729;
export declare const LINEAR_MIPMAP_LINEAR = 9987;
export declare const CLAMP_TO_EDGE = 33071;
export declare const UNPACK_PREMULTIPLY_ALPHA_WEBGL = 37441;
export declare const VERTEX_SHADER = 35633;
export declare const FRAGMENT_SHADER = 35632;
export declare const COMPILE_STATUS = 35713;
export declare const LINK_STATUS = 35714;
export declare const MAX_TEXTURE_SIZE = 3379;
export declare const OUT_OF_MEMORY = 1285;
export declare const MAX_TEXTURE_IMAGE_UNITS = 34930;
/**
 * The kinds of a UniformTable entry, which uniformv uploads: float vectors
 * of 1 to 4 components, int vectors, and mat2 to mat4.
 */
export declare const K_F1 = 1;
export declare const K_F2 = 2;
export declare const K_F3 = 3;
export declare const K_F4 = 4;
export declare const K_I1 = 5;
export declare const K_I2 = 6;
export declare const K_I3 = 7;
export declare const K_I4 = 8;
export declare const K_M2 = 9;
export declare const K_M3 = 10;
export declare const K_M4 = 11;
/** A vertex array object: native on WebGL2, OES_vertex_array_object on WebGL1. */
export type Vao = WebGLVertexArrayObjectOES;
/**
 * The only code that touches the raw WebGL context (spec 7.1). It shadows
 * the bound program, VAO, texture and array buffer, the scissor test and
 * box, premultiplied uploads and the clear colour, so that a redundant bind
 * or state change costs no GL call: on the target TVs every call costs CPU.
 * The shadows start from a fresh context's known defaults rather than being
 * read back. Every texture binds on unit 0, the default active unit, so
 * activeTexture is never called.
 */
export declare class GlContext {
    /** A WebGL2 context used through the WebGL1 surface (forceWebGL2). */
    readonly isWebGl2: boolean;
    /** VAOs are available (WebGL2, or OES_vertex_array_object) and not disabled. */
    readonly canUseVao: boolean;
    private readonly gl;
    private readonly vaoExt;
    private program;
    private vao;
    private texture;
    private arrayBuffer;
    private scissorOn;
    private sx;
    private sy;
    private sw;
    private sh;
    private premultiply;
    private clearRgba;
    constructor(gl: WebGLRenderingContext, webgl2: boolean, disableVao: boolean, width: number, height: number);
    useProgram(program: WebGLProgram): void;
    /** Bind a VAO, null for the default one. Only when canUseVao. */
    bindVao(vao: Vao | null): void;
    /** A new VAO, or null when allocation failed. Only when canUseVao. */
    createVao(): Vao | null;
    /** Point attribute `index` at `buffer`, recorded in the bound VAO. */
    attribPointer(buffer: WebGLBuffer, index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
    /**
     * Enable the arrays in `mask` in the bound VAO, whose arrays are all
     * disabled: a fresh VAO, or a fresh context's default one.
     */
    enableAttribs(mask: number): void;
    /** Record the index buffer in the bound VAO: the element binding is VAO state. */
    bindIndexBuffer(buffer: WebGLBuffer): void;
    createBuffer(): WebGLBuffer;
    /** A buffer filled once (STATIC_DRAW). */
    staticBuffer(target: number, data: ArrayBufferView): WebGLBuffer;
    /** Re-specify `buffer` from `data` (DYNAMIC_DRAW): one call per chunk. */
    uploadVertices(buffer: WebGLBuffer, data: Float32Array): void;
    bindTexture(texture: WebGLTexture | null): void;
    /**
     * A texture with `minFilter` and CLAMP_TO_EDGE wrapping: LINEAR is
     * NPOT-safe, with no mipmaps (1.10); LINEAR_MIPMAP_LINEAR is for a
     * compressed texture that carries its whole chain of levels. Mag
     * filtering is left at the GL default, which is already LINEAR, so
     * setting it would be a wasted call on every texture.
     */
    createTexture(minFilter: number): WebGLTexture;
    /**
     * Upload `source` into `texture`: an image-like source, or `w` x `h` RGBA
     * bytes. `premultiply` asks WebGL to premultiply straight-alpha pixels.
     */
    texImage(texture: WebGLTexture, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
    /**
     * Allocate `w` x `h` RGBA texels in `texture`, with no pixels: WebGL
     * zero-fills them, so an atlas page starts transparent.
     */
    texStorage(texture: WebGLTexture, w: number, h: number): void;
    /**
     * Upload `source` into the region of `texture` at `x`, `y`: an image-like
     * source, or `w` x `h` RGBA bytes. `premultiply` as for texImage.
     */
    texSubImage(texture: WebGLTexture, x: number, y: number, source: TexImageSource | ArrayBufferView, w: number, h: number, premultiply: boolean): void;
    /** gl.getExtension: for compressed formats, enabling one is getting it. */
    extension(name: string): object | null;
    /** One compressed mip level into `texture` (compressed.ts). */
    compressedTexImage(texture: WebGLTexture, level: number, format: number, w: number, h: number, data: ArrayBufferView): void;
    /** Deleting the bound texture unbinds it in GL, and here. */
    deleteTexture(texture: WebGLTexture): void;
    /**
     * Compile and link a program with `attributes[i]` bound to location i, so
     * that every program shares one vertex layout. Checks LINK_STATUS only:
     * `getShaderParameter(COMPILE_STATUS)` per shader is a second blocking
     * round trip to Chrome's GPU process for every shader, and shaders compile
     * on first use (mid-frame on TVs), so a failed compile is left to fail the
     * link instead. On failure the error carries the program log plus both
     * shaders' logs, since a compile error's own text lives in the shader's
     * log, not the program's.
     */
    compile(vertex: string, fragment: string, attributes: string[]): WebGLProgram;
    uniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
    uniform4fv(location: WebGLUniformLocation | null, value: Float32Array): void;
    uniform1f(location: WebGLUniformLocation, x: number): void;
    uniform2f(location: WebGLUniformLocation, x: number, y: number): void;
    uniform4f(location: WebGLUniformLocation, x: number, y: number, z: number, w: number): void;
    /**
     * A UniformTable entry: `kind` is one of the K_* kinds above; one it does
     * not know uploads nothing.
     */
    uniformv(kind: number, location: WebGLUniformLocation, data: Float32Array | Int32Array): void;
    /** The context is lost: every call is a no-op and every query answers null. */
    isLost(): boolean;
    scissorTest(on: boolean): void;
    scissor(x: number, y: number, w: number, h: number): void;
    /** The clear colour, 0xRRGGBBAA, uploaded straight (not premultiplied), as in 1.10. */
    clearColor(rgba: number): void;
    clear(): void;
    /** Draw `count` quads from quad `start` (six Uint16 indices per quad). */
    drawQuads(start: number, count: number): void;
    parameter(name: number): number;
    /**
     * Drain the GL error queue; true when it held GL_OUT_OF_MEMORY. Errors
     * persist until drained, so one drain on going idle catches any raised
     * while drawing. Never call it in the frame loop: getError() stalls for
     * the GPU (spec 12.1). Bounded, since a lost context keeps answering.
     */
    outOfMemory(): boolean;
    /** Release every GL object at once by losing the context (destroy). */
    lose(): void;
    private bindArrayBuffer;
    /** Compile `source`; a failure surfaces through the caller's LINK_STATUS check. */
    private shader;
}
/**
 * Create the context with the 1.10 attributes (spec 7.1): no antialias (SDF
 * edges do their own), no depth or stencil buffer, premultiplied alpha, no
 * preserved drawing buffer. `forceWebGL2` asks for WebGL2 and uses it
 * through the WebGL1 surface; `experimental-webgl` is the last resort. The
 * spy, when given, wraps the raw context before anything uses it. The
 * canvas is already sized.
 */
export declare function createGlContext(canvas: HTMLCanvasElement, forceWebGL2: boolean, powerPreference: WebGLPowerPreference, disableVao: boolean, spy: ContextSpy | null): GlContext;
