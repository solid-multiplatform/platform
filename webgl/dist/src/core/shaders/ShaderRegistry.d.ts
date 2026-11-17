import type { NodeStore } from '../nodes/NodeStore.js';
import { UniformTable } from '../gl/Program.js';
import { ShaderNode } from './ShaderNode.js';
import { UniformWriter, type AdvancedProp, type ShaderClock, type ShaderType } from './ShaderType.js';
/**
 * Where programs compile: the GL backend, which the Renderer installs, or
 * headless the stand-in of `headlessHost`.
 */
export interface ProgramHost {
    /** viewportGlsl for the canvas: what source functions compile in. */
    readonly viewport: string;
    /** Compile and link; throws when that fails. `name` is for developer tools. */
    register(vertex: string, fragment: string, extensions: string[] | null, table: UniformTable, time: ((node: number) => number) | null, name: string): number;
    /** Bit i set when SYSTEM_UNIFORMS[i] is active in `program`. */
    systemMask(program: number): number;
    /** The context is lost (a compile that failed for that reason). */
    isLost(): boolean;
}
/** One program of a type, per variant: compiled the first time a node packs it. */
export interface ProgramSlot {
    /** The program id: -1 until compiled, 0 (Default) when the compile failed. */
    id: number;
    readonly variant: string;
    /** The layout of the blocks packed for it. */
    readonly table: UniformTable;
    /** What its params key holds (UNKEYED, PROPS or SIZED), set when it compiles. */
    keyed: number;
    /** Its pack threw: its nodes draw with Default until the idle trim. */
    packFailed: boolean;
}
type Pack = (props: Record<string, unknown>, w: number, h: number, u: UniformWriter) => void;
/** A registered shader type, normalized once per type object. */
export interface TypeRecord {
    readonly id: number;
    readonly name: string;
    readonly type: ShaderType;
    /** Props that hold a value, in definition order (the key's order). */
    readonly names: string[];
    readonly configs: unknown[];
    /** Props that read and write others (1.10 `set` / `get` aliases). */
    readonly aliases: string[];
    readonly aliasConfigs: AdvancedProp[];
    /**
     * Props and aliases declared colours (AdvancedProp `color`): animations
     * blend them.
     */
    readonly colors: string[];
    /** The prototype of the type's `props` facades: an accessor per prop. */
    readonly proto: object;
    readonly slots: Record<string, ProgramSlot>;
    readonly pack: Pack | null;
    readonly variant: ((props: Record<string, unknown>) => string) | null;
    readonly timeOf: ((node: number) => number) | null;
    /** Variants made so far: past 16, a warning (once). */
    variants: number;
    /** A re-derived variant threw: reported once. */
    variantThrew: boolean;
    /** Its time function threw: reported once, until the idle trim. */
    timeThrew: boolean;
}
/**
 * Shader types, programs and params blocks (spec 8). A type registers by
 * name and is normalized once: its props split into the ones that hold a
 * value and the aliases, and a facade prototype with an accessor per prop.
 * `pack` is the shader part of the scene pass's `packShader`, run
 * for a node in bounds whose shader, a shader prop or its size changed: it
 * compiles the program of the shader's variant the first time one is used
 * (a failure is reported, and its nodes draw without the effect), then
 * points the node at a params block, an immutable Float32Array cached by
 * (type, variant, props, w, h) and shared by every node with that key, so
 * equal shaders batch into one op (a type without a pack: see SIZED). The
 * node's program id and block are store data (its `I_SHADER` word and
 * `params`), which ScenePass.emit reads.
 */
export declare class ShaderRegistry {
    host: ProgramHost;
    /**
     * A compile failed on a lost context (the Renderer reports the loss
     * outside the frame); null headless.
     */
    onLost: (() => void) | null;
    /**
     * An op of a timed program was drawn (the time functions this registry
     * hands the programs mark it): the Renderer asks for the next frame, as
     * 1.10's timer that updates every loop did. Only drawn nodes mark it (a
     * node out of bounds or hidden is not emitted), and not a time
     * function's null (a static value) or NaN.
     */
    timed: boolean;
    /**
     * Reports what a type's time function (app code, run while drawing)
     * threw, from `reportErrors` after the draw: the Renderer's loop error.
     * Null headless: logged.
     */
    onError: ((error: unknown) => void) | null;
    private readonly nodes;
    private readonly owner;
    private readonly pixelRatio;
    private readonly writer;
    private readonly byName;
    private readonly records;
    /** The records in registration order, one per type object: what `warmNext` walks. */
    private readonly order;
    /** The index in `order` of the next type `warmNext` looks at. */
    private warmed;
    private readonly cache;
    private readonly entries;
    /** Per program id: its system uniform mask, and its type's canBatch. */
    private readonly masks;
    private readonly batches;
    /** Blocks in the cache that no node holds. */
    private idle;
    /** Whether the last `packBlock` marked its block alphaUnused. */
    private packedNoAlpha;
    /** Per node: the shader it was packed with, and the links of that shader's users. */
    private readonly users;
    private next;
    private prev;
    /** Program slots whose pack threw: reported once, not packed again until the idle trim. */
    private readonly failedSlots;
    /** Types whose time function threw: reported once, until the idle trim. */
    private readonly failedTimes;
    /** The first error a time function threw in this draw, for `reportErrors`. */
    private thrown;
    private thrownError;
    private thrownName;
    constructor(nodes: NodeStore, owner: ShaderClock, pixelRatio: number, host: ProgramHost);
    /** Params blocks in the cache, held or not (for tests and telemetry). */
    get blockCount(): number;
    /** 1.10 registerShaderType: a name taken already keeps its type. */
    register(name: string, type: ShaderType): void;
    /**
     * The idle warm-up (the Renderer's timer chain): compile the program of
     * the next registered type's default props, in registration order, unless
     * a node packed it already; false when no type is left. A failure is not
     * reported: the slot stays uncompiled, so the first node packing it
     * compiles it again and reports that. A type whose `resolve` or
     * `variant` (app code) throws on its default props is skipped.
     */
    warmNext(): boolean;
    /**
     * A shader of a registered type, its props resolved; null, with a
     * warning, for a name not registered (1.10 returned its default shader).
     * Nothing compiles here: a program compiles when a node first packs it.
     */
    create(name: string, props?: Record<string, unknown>): ShaderNode | null;
    /**
     * The shader part of PassHooks.packShader: the node's shader, a shader
     * prop or its size changed. Compiles the shader's program on first use
     * and repacks only when the key changed.
     */
    pack(id: number): void;
    /**
     * PassHooks.perOpMatch, asked for an ST_PER_OP node: can its quad join
     * the op whose first node is `opNode`? OpList.add compares the params
     * block, so this compares what the per-op uniforms take from the op's
     * first node: world alpha (unless the shared block reads none,
     * `ST_ALPHA_UNUSED`), and a growing quad's 2x2 and UV rect. A type's
     * `canBatch` decides instead, given the two node handles (1.10).
     */
    perOpMatch(id: number, opNode: number): boolean;
    /** RendererCore.releaseNode: the node is destroyed; drop its shader state. */
    release(id: number): void;
    /** Mark every node using `shader` for a repack (a prop changed). */
    markUsers(shader: ShaderNode): void;
    /**
     * Idle maintenance: drop the params blocks no node holds, and give the
     * programs whose pack threw another try (a pack that throws again is
     * reported again), as the types whose time function threw.
     */
    trim(): void;
    /**
     * Drop the params blocks no node holds: the idle trim, and a cache miss
     * past MAX_IDLE, which leaves the failure flags alone (an endless
     * animation would otherwise report a failure again about every 257
     * misses).
     */
    private dropIdle;
    /**
     * After the draw: report the first error a time function threw while
     * drawing (app code), through `onError` (the Renderer's loop error), else
     * console.error. Never inside the draw loop. A type's is reported once,
     * until the idle trim, not on every frame it draws; one that waited behind
     * another type's in a draw is reported after a later one.
     */
    reportErrors(): void;
    /**
     * A program outside any shader type (the SDF text program, phase 5),
     * compiled when first needed: 0 when it fails, reported with `failure`,
     * the caller's account of what happens then (no node falls back to
     * Default for it: text does not draw), unless the context is lost. With
     * `failure` null (the idle warm-up) a failure returns -1, unreported:
     * not compiled yet, so the first use compiles it again and reports that.
     * `name` is the program's, for developer tools.
     */
    program(vertex: string, fragment: string, failure: string | null, name: string): number;
    private record;
    /**
     * `block`, a node's, is the one for props key `props` at (w, h): the
     * key is unchanged, and no key string is built to find that out.
     */
    private holds;
    /**
     * The cached block for the shader's props key at (w, h), or null. On a
     * miss with a key cached by an earlier pack (not `fresh`), the key is
     * rebuilt from the values and, when that changed it, looked up again
     * (the node's own block is among the cached ones): a values array
     * changed in place since (`props.radius[0] = 20`) is no write and left
     * the key as it was, so the block packed on this miss would be cached
     * under the key of the old content, and every shader holding that
     * content would draw it. So a block is only ever cached under the key of
     * what it was packed from.
     */
    private cached;
    /**
     * Cache a new block for props key `props` at (w, h), held by no node
     * yet; first, past MAX_IDLE blocks no node holds, drop those.
     */
    private add;
    /**
     * The props part of a params key: type, variant and every value, in
     * order, each by its string form and an array by its elements'. Numbers,
     * strings, booleans, null, undefined and flat arrays of those key apart;
     * an object that is not an array keys as "[object Object]" and a nested
     * array flattens, so two such values can share a block (1.10 the same).
     */
    private propsKey;
    /** Compile the shader's slot; `report` false (the warm-up) leaves a failed one uncompiled. */
    private compile;
    /**
     * A shader of `rec` with its default props, as `createShader` without
     * props makes it (its slot is the one a node would compile); null when
     * a `resolve` or `variant` threw.
     */
    private defaults;
    /**
     * Pack a block; null when the pack (app code) throws, which is reported
     * once per program: its nodes draw without the effect and do not run the
     * pack again until the idle trim, whatever their key (a size animation
     * makes a new one every frame).
     */
    private packBlock;
    /**
     * The program slot of a type's variant, made on first use. Each compiles
     * a program of its own: past 16, a warning, once per type.
     */
    private slot;
    /**
     * A write to one of the type's `variantProps`: evaluate the variant (app
     * code, in the frame) and move the shader to that variant's program. One
     * that throws is reported once per type and keeps the current program.
     */
    private rederive;
    /**
     * The time value a drawn op uploads. Every drawn op of a timed program
     * marks `timed`, so the Renderer asks for the next frame (1.10's timer
     * that updates every loop): only drawn nodes, since one out of bounds or
     * hidden is not emitted. A time function's null is a static value: 0,
     * and no frame asked, as is anything else not a number (undefined, from
     * a 1.10 function with a missing return); NaN asks for none either.
     */
    private drawn;
    /**
     * A type's time function, run while drawing: a throw (app code) reads as
     * a static value, so the draw goes on and asks for no frame, and the
     * draw's first error of a type not reported since the idle trim waits for
     * `reportErrors`. The try/catch keeps to this small helper, out of the
     * draw loop's body.
     */
    private evaluate;
    /** A compile failed: the context's loss, else `message` and the error. */
    private failed;
    /** The node draws with Default: program 0, no block, no per-op check. */
    private unset;
    private unref;
    /** Grow the per-node arrays to the store's capacity. */
    private ensure;
    private attach;
    private detach;
}
/**
 * The program host of the headless core: ids from 1, and a uniform is
 * active when a source names it (as the fake GL context has it). Nothing
 * compiles.
 */
export declare function headlessHost(viewport: string): ProgramHost;
export {};
