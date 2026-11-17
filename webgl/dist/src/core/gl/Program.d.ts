import type { NodeStore } from '../nodes/NodeStore.js';
import { type GlContext } from './GlContext.js';
/**
 * The vertex attributes (roadmap 4.4), bound to these locations in every
 * program so that all programs share one layout: world position, uv (the
 * SDF program's glyph UVs too), packed premultiplied colour, the extra
 * scalar (SDF distance range) and the static per-corner node coordinates.
 */
export declare const ATTRIBUTES: string[];
/**
 * The system uniforms a program may declare, by their index into
 * `Program.system` (spec 7.1: a location cache indexed by a compile-time
 * index, not looked up by name per call). The first five are per-op
 * uniforms, uploaded from the op's first node (`Program.perOp`): world
 * alpha, the world 2x2 and UV rect of a growing quad, the node size (1.10
 * custom shaders) and the shader type's time value. Resolution and pixel
 * ratio never change: GlBackend.registerProgram uploads them once.
 */
export declare const U_ALPHA = 0;
export declare const U_TIME = 1;
export declare const U_TRANSFORM = 2;
export declare const U_UV_RECT = 3;
export declare const U_DIMENSIONS = 4;
export declare const U_RESOLUTION = 5;
export declare const U_PIXEL_RATIO = 6;
export declare const SYSTEM_UNIFORMS: string[];
/** The kinds of a UniformTable entry, defined beside GlContext.uniformv. */
export { K_F1, K_F2, K_F3, K_F4, K_I1, K_I2, K_I3, K_I4, K_M2, K_M3, K_M4, } from './GlContext.js';
/**
 * The layout of a program's params blocks (spec 8.1): one entry per uniform
 * name, in first-write order, at a fixed float offset into every block. The
 * built-in shaders write rows of `u_params` only, one entry the draw loop
 * uploads straight from the block (`direct`); a custom shader's named
 * uniforms add entries, uploaded through a scratch array each, so that no
 * upload allocates. Append only: an entry's offset and size never change,
 * so a block packed before an entry existed still reads right (an entry
 * past its length uploads 0, as a block that never wrote it holds).
 */
export declare class UniformTable {
    readonly names: string[];
    readonly kinds: number[];
    readonly offsets: number[];
    readonly sizes: number[];
    readonly scratch: (Float32Array | Int32Array)[];
    /** Floats in a block packed now. */
    length: number;
    /** The one entry is `u_params`: uploaded with uniform4fv straight from the block. */
    direct: boolean;
    /** A pack wrote past an entry's size and was cut: warned about once. */
    warned: boolean;
    indexOf(name: string): number;
    /** Append an entry of `size` floats; returns its index. */
    add(name: string, kind: number, size: number): number;
}
/** A linked program and the per-program state the draw loop shadows. */
export declare class Program {
    /**
     * What the program draws, for developer tools: Default, Sdf, or its
     * shader type's name with `:variant` when the type has one.
     */
    readonly name: string;
    readonly handle: WebGLProgram;
    /** Location of `u_params`, the packed params block; null without one. */
    readonly params: WebGLUniformLocation | null;
    /** Locations of SYSTEM_UNIFORMS by index, null for one the program does not use. */
    readonly system: (WebGLUniformLocation | null)[];
    /** Bit i set when SYSTEM_UNIFORMS[i] is active. */
    readonly systemMask: number;
    /**
     * The params block last uploaded to this program. Uniform values are
     * program state that survives program switches, and blocks are immutable
     * and shared by reference, so the same reference needs no upload. This
     * holds only because a params block is never mutated or recycled after
     * upload: a block a shader outgrows is dropped and replaced, never
     * trimmed and pooled for reuse, since a recycled reference would still
     * match this shadow and the draw loop would skip an upload the new
     * content needs.
     */
    lastParams: Float32Array | null;
    /**
     * Uploads the program's per-op system uniforms for the op whose first
     * node is `node` (bindSystem installs it); null when the program uses
     * none.
     */
    perOp: ((node: number) => void) | null;
    /** The layout of this program's params blocks; null for a program without them. */
    table: UniformTable | null;
    /** Locations of the table's entries, looked up on each one's first upload. */
    readonly locations: (WebGLUniformLocation | null | undefined)[];
    private readonly ctx;
    private nodes;
    private time;
    private alpha;
    private t;
    private ta;
    private tb;
    private tc;
    private td;
    private ux1;
    private uy1;
    private ux2;
    private uy2;
    private w;
    private h;
    constructor(ctx: GlContext, vertex: string, fragment: string, name: string);
    /**
     * Bind the program to the store its per-op uniforms read and to its shader
     * type's time value (null without one), and install `perOp` when it uses
     * a per-op uniform. Whether a timed op asks for the next frame is the
     * time function's to say (ShaderRegistry): here it only uploads.
     */
    bindSystem(nodes: NodeStore, time: ((node: number) => number) | null): void;
    /**
     * Upload `block` through the table: one call per entry, from its scratch
     * array. An entry added after the block was packed (a name a later pack
     * wrote first) is past the block's end: it uploads 0, as a fresh block
     * that never wrote it does, never the value another block left.
     */
    uploadTable(block: Float32Array): void;
    private uploadSystem;
}
