import { type UniformTable } from '../gl/Program.js';
/**
 * A 1.10 advanced prop: a default plus a normalizer (`resolve`), or an
 * alias that reads and writes other props (`set` / `get`, such as
 * `top-left` writing `radius[0]`). The built-in types use the same forms.
 * `P` is the shader's props type. Its default takes `any` values, not
 * `unknown`: an interface is assignable only to the former, so an
 * AdvancedProp<T> written apart from its type (as the built-ins' helpers
 * are) still fits a shader whose props are an interface.
 */
export interface AdvancedProp<T = unknown, P extends object = Record<string, any>> {
    default: T;
    /**
     * Normalizes a value. `props` holds the shader's resolved props: when a
     * shader is created, only those declared before this one (1.10's
     * definition order; the later ones are undefined); on a write, all of
     * them.
     */
    resolve?: (value: T | undefined, props: P) => T;
    /**
     * An alias: `props` holds the shader's resolved props, never its
     * aliases (an alias key of P reads undefined there).
     */
    set?: (value: T, props: P) => void;
    get?: (props: P) => T;
    /**
     * A 0xRRGGBBAA colour, a prop's or an alias's: a shaderProps animation
     * blends it per channel. A prop whose name contains `color` is taken for
     * one anyway (1.10).
     */
    color?: boolean;
}
/** The renderer's constants a source function gets with the props. */
export interface ShaderContext {
    /** Device pixels per logical pixel. */
    readonly pixelRatio: number;
    /** viewportGlsl for this canvas: PIXEL_RATIO, RESOLUTION and pxToClip. */
    readonly viewport: string;
    /** 1.10 source functions read `renderer.stage.pixelRatio`. */
    readonly stage: {
        readonly pixelRatio: number;
    };
}
export type ShaderSource<P> = string | ((ctx: ShaderContext, props: P) => string);
/**
 * The renderer as a time function sees it: 1.10's Stage timing values, in
 * ms (`elapsedTime` since the renderer started; the current and previous
 * frame times; their difference). The Renderer writes them each frame.
 */
export interface ShaderClock {
    readonly elapsedTime: number;
    readonly deltaTime: number;
    readonly lastFrameTime: number;
    readonly currentFrameTime: number;
}
/** The node a 1.10 `update` receives: its size, nothing else. */
export interface UpdateNode {
    w: number;
    h: number;
    width: number;
    height: number;
}
/**
 * A shader type (spec 8.1), registered by name with
 * `renderer.registerShaderType`. `pack` writes the uniforms of one set of
 * props at one node size into `u`: blocks are cached by (type, variant,
 * props, w, h) and shared by reference, so `pack` reads nothing else. The
 * 1.10 contract is accepted too: `update` (with `this.props` and the
 * `this.uniform*` calls) in place of `pack`, `getCacheMarkers` in place of
 * `variant`. App code a type brings runs where 1.10 ran it: `variant` in
 * `createShader` (again in the frame only for `variantProps`), `pack` and
 * `time` in the frame.
 */
export interface ShaderType<P extends object = Record<string, unknown>> {
    /**
     * A default per prop, or an AdvancedProp. A value is a number, string,
     * boolean or null, or a flat array of those: the params blocks are keyed
     * by the values' string forms, so an object that is not an array (keyed
     * as "[object Object]") or a nested array can share a block with another
     * (1.10 the same). An array is copied when a shader is created.
     */
    props?: {
        [K in keyof P]: P[K] | AdvancedProp<P[K], P>;
    };
    /**
     * The name of the compile-time variant the props need (1.10's
     * `getCacheMarkers`): the program cache keys on it, so each variant
     * compiles once, and the `vertex` and `fragment` source functions build
     * its source from the same props. Evaluated when a shader is created
     * and, after a write to one of `variantProps`, again: the shader's nodes
     * then move to the program of the new variant.
     */
    variant?: (props: P) => string;
    /**
     * The props whose writes re-derive the variant: discrete inputs, such as
     * a colour count. Without them the variant is fixed when the shader is
     * created (1.10), so an animated prop never compiles a program in the
     * frame. A write through an alias never re-derives it.
     */
    variantProps?: string[];
    /** Defaults to the default vertex shader with `v_nodeCoords`. */
    vertex?: ShaderSource<P>;
    fragment: ShaderSource<P>;
    /**
     * Writes the uniforms of one set of props at one node size into `u`. A
     * program's first pack fixes its layout: each uniform takes the size of
     * its first write (`u_params` the rows written), and a later, longer
     * write is cut to it, with a warning once per program.
     */
    pack?: (props: P, w: number, h: number, u: UniformWriter) => void;
    /**
     * The value of `u_time`: the renderer's elapsed ms for `true`, or what
     * the function returns, from the renderer's clock and the props. Every
     * drawn op of a timed program asks for the next frame (1.10: a timer
     * that updates every loop), unless the function returns null, or
     * anything else that is not a number: a static value (`u_time` 0, no
     * frame asked). One that throws reads as static too, and is reported
     * once per type until the idle trim. Mediump is binary16 on Mali-400
     * (65504 at most): return something small, such as the position in a
     * cycle.
     */
    time?: boolean | ((renderer: ShaderClock, props: P) => number | null);
    /** Replaces the default batch checks between two node handles (1.10). */
    canBatch?: (a: object, b: object) => boolean;
    /** WebGL1 extensions the shader needs, enabled before it compiles (1.10). */
    webgl1Extensions?: string[];
    /** 1.10: writes uniforms with `this.uniform*`, reads `this.props`. */
    update?: (this: UpdateContext<P>, node: UpdateNode) => void;
    /** 1.10 name of `variant`. */
    getCacheMarkers?: (props: P) => string;
}
/** The 1.10 name of a shader type. */
export type WebGlShaderType<P extends object = Record<string, unknown>> = ShaderType<P>;
/**
 * Records one params block. Built-in shaders write rows of
 * `uniform vec4 u_params[N]` only (`row`), uploaded with one uniform4fv;
 * the named forms (`f1` to `f4`, `fv`, `iv`, `mat`, `rgba`) record
 * per-uniform values into the same block, laid out by the program's
 * UniformTable. One writer serves every pack; `finish` creates the block.
 * The first pack of a program fixes the layout: a later pack writing more
 * rows, or a longer array under a name, is cut to it (warned once).
 */
export declare class UniformWriter {
    /** Device pixels per logical pixel (fixed at construction). */
    readonly pixelRatio: number;
    /**
     * The pack called `alphaUnused`; read before `finish`, which clears it.
     *
     * @hidden
     */
    noAlpha: boolean;
    private rows;
    private rowCount;
    private names;
    private kinds;
    private values;
    constructor(pixelRatio: number);
    /** Row `i` of `u_params`. */
    row(i: number, x: number, y: number, z: number, w: number): void;
    f1(name: string, x: number): void;
    f2(name: string, x: number, y: number): void;
    f3(name: string, x: number, y: number, z: number): void;
    f4(name: string, x: number, y: number, z: number, w: number): void;
    /** A float uniform of `n` components, or an array of them: `values` holds every element. */
    fv(name: string, n: number, values: ArrayLike<number>): void;
    /** An int uniform of `n` components, or an array of them. */
    iv(name: string, n: number, values: ArrayLike<number>): void;
    /** A mat2, mat3 or mat4 (`n` 2, 3 or 4). */
    mat(name: string, n: number, values: ArrayLike<number>): void;
    /** A 0xRRGGBBAA colour as normalized RGBA (1.10 uniformRGBA). */
    rgba(name: string, color: number): void;
    /**
     * The block's draw reads no world alpha (`u_alpha`): a built-in box that
     * draws neither a border nor a visible shadow. Nodes that share the
     * block then batch whatever their world alpha.
     *
     * @hidden
     */
    alphaUnused(): void;
    /**
     * End the pack: lay what was written out by `table` (adding an entry for
     * each uniform written for the first time) into a new block, and reset.
     *
     * @hidden
     */
    finish(table: UniformTable): Float32Array;
    /**
     * Drop what was written (a pack that threw), zeroing the rows used: a
     * row the next pack leaves unwritten reads 0, not this pack's value.
     */
    reset(): void;
    private named;
}
/**
 * `this` in a 1.10 `update`: the props and the `uniform*` calls of 1.10's
 * WebGlShaderNode, recorded into the pack's writer. One per shader type,
 * reused for every pack.
 */
export declare class UpdateContext<P = Record<string, unknown>> {
    props: P;
    readonly stage: {
        readonly pixelRatio: number;
    };
    u: UniformWriter;
    constructor(pixelRatio: number);
    uniform1f(name: string, x: number): void;
    uniform2f(name: string, x: number, y: number): void;
    uniform3f(name: string, x: number, y: number, z: number): void;
    uniform4f(name: string, x: number, y: number, z: number, w: number): void;
    uniform2fa(name: string, v: ArrayLike<number>): void;
    uniform3fa(name: string, v: ArrayLike<number>): void;
    uniform4fa(name: string, v: ArrayLike<number>): void;
    uniform1fv(name: string, v: ArrayLike<number>): void;
    uniform2fv(name: string, v: ArrayLike<number>): void;
    uniform3fv(name: string, v: ArrayLike<number>): void;
    uniform4fv(name: string, v: ArrayLike<number>): void;
    uniform1i(name: string, x: number): void;
    uniform2i(name: string, x: number, y: number): void;
    uniform3i(name: string, x: number, y: number, z: number): void;
    uniform4i(name: string, x: number, y: number, z: number, w: number): void;
    uniform1iv(name: string, v: ArrayLike<number>): void;
    uniform2iv(name: string, v: ArrayLike<number>): void;
    uniform3iv(name: string, v: ArrayLike<number>): void;
    uniform4iv(name: string, v: ArrayLike<number>): void;
    uniformMatrix2fv(name: string, v: ArrayLike<number>): void;
    uniformMatrix3fv(name: string, v: ArrayLike<number>): void;
    uniformMatrix4fv(name: string, v: ArrayLike<number>): void;
    uniformRGBA(name: string, color: number): void;
}
