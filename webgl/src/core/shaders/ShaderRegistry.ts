import type { NodeStore } from '../nodes/NodeStore.js';
import {
  DIRTY_SHADER,
  NULL,
  ST_ALPHA_UNUSED,
  ST_PER_OP,
} from '../nodes/NodeFlags.js';
import {
  SYSTEM_UNIFORMS,
  U_ALPHA,
  U_DIMENSIONS,
  U_TIME,
  U_TRANSFORM,
  U_UV_RECT,
  UniformTable,
} from '../gl/Program.js';
import { defaultVertex } from './glsl.js';
import { SHADER, ShaderNode, type Facade } from './ShaderNode.js';
import {
  UniformWriter,
  UpdateContext,
  type AdvancedProp,
  type ShaderClock,
  type ShaderContext,
  type ShaderType,
  type UpdateNode,
} from './ShaderType.js';
import {
  F_H,
  F_STRIDE,
  F_W,
  F_WA,
  F_WB,
  F_WC,
  F_WD,
  F_WORLD_ALPHA,
  I_SHADER,
  I_STATE,
  I_STRIDE,
  I_UID,
  I_UV_X1,
  I_UV_X2,
  I_UV_Y1,
  I_UV_Y2,
} from '../nodes/NodeLayout.js';

/**
 * Where programs compile: the GL backend, which the Renderer installs, or
 * headless the stand-in of `headlessHost`.
 */
export interface ProgramHost {
  readonly resizable?: boolean;
  /** viewportGlsl for the canvas: what source functions compile in. */
  readonly viewport: string;
  /** Compile and link; throws when that fails. `name` is for developer tools. */
  register(
    vertex: string,
    fragment: string,
    extensions: string[] | null,
    table: UniformTable,
    time: ((node: number) => number) | null,
    name: string,
  ): number;
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

type Pack = (
  props: Record<string, unknown>,
  w: number,
  h: number,
  u: UniformWriter,
) => void;

type TimeOf = (
  renderer: ShaderClock,
  props: Record<string, unknown>,
) => number | null;

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

interface Entry {
  readonly key: string;
  /**
   * What the key was built from: the props key and the size, which an
   * unchanged node compares without building a key (`holds`).
   */
  readonly props: string;
  readonly w: number;
  readonly h: number;
  /** Its pack marked it as reading no world alpha (`UniformWriter.alphaUnused`). */
  readonly noAlpha: boolean;
  refs: number;
}

/** The per-op uniforms that differ between nodes sharing a params block. */
const MATCHED = (1 << U_ALPHA) | (1 << U_TRANSFORM) | (1 << U_UV_RECT);
/**
 * What a program's params key holds. A type with a pack keys its blocks by
 * props and size (SIZED). Without a pack, a program reading the node size
 * (`u_dimensions`) still gets an empty block per props and size, and one
 * reading a time function's value (a function of the props) an empty
 * block per props (PROPS), so that ops split where those per-op values
 * differ, as 1.10 did; any other gets no block (UNKEYED), and its nodes
 * batch on the program alone (`time: true` draws one elapsed time for all).
 */
const UNKEYED = 0;
const PROPS = 1;
const SIZED = 2;
/**
 * Blocks no node holds that a cache miss lets pile up before it drops
 * them: an endless shader-prop animation never reaches idle maintenance.
 */
const MAX_IDLE = 256;

const isAdvanced = (config: unknown): config is AdvancedProp =>
  config !== null &&
  typeof config === 'object' &&
  (config as AdvancedProp).default !== undefined;

const copyOf = (value: unknown): unknown =>
  Array.isArray(value) === true ? (value as unknown[]).slice() : value;

/** The params key of a props key at (w, h), for a program keyed `keyed`. */
const keyOf = (props: string, keyed: number, w: number, h: number): string =>
  keyed === SIZED ? props + w + ',' + h : props;

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
export class ShaderRegistry {
  host: ProgramHost;
  /**
   * A compile failed on a lost context (the Renderer reports the loss
   * outside the frame); null headless.
   */
  onLost: (() => void) | null = null;
  /**
   * An op of a timed program was drawn (the time functions this registry
   * hands the programs mark it): the Renderer asks for the next frame, as
   * 1.10's timer that updates every loop did. Only drawn nodes mark it (a
   * node out of bounds or hidden is not emitted), and not a time
   * function's null (a static value) or NaN.
   */
  timed = false;
  /**
   * Reports what a type's time function (app code, run while drawing)
   * threw, from `reportErrors` after the draw: the Renderer's loop error.
   * Null headless: logged.
   */
  onError: ((error: unknown) => void) | null = null;

  private readonly nodes: NodeStore;
  private readonly owner: ShaderClock;
  private pixelRatio: number;
  private readonly resizeContexts: UpdateContext[] = [];
  private readonly writer: UniformWriter;
  private readonly byName: Record<string, TypeRecord> = Object.create(
    null,
  ) as Record<string, TypeRecord>;
  private readonly records = new Map<object, TypeRecord>();
  /** The records in registration order, one per type object: what `warmNext` walks. */
  private readonly order: TypeRecord[] = [];
  /** The index in `order` of the next type `warmNext` looks at. */
  private warmed = 0;
  private readonly cache = new Map<string, Float32Array>();
  private readonly entries = new Map<Float32Array, Entry>();
  /** Per program id: its system uniform mask, and its type's canBatch. */
  private readonly masks: number[] = [0];
  private readonly batches: (((a: object, b: object) => boolean) | null)[] = [
    null,
  ];
  /** Blocks in the cache that no node holds. */
  private idle = 0;
  /** Whether the last `packBlock` marked its block alphaUnused. */
  private packedNoAlpha = false;
  /** Per node: the shader it was packed with, and the links of that shader's users. */
  private readonly users: (ShaderNode | null)[] = [];
  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  /** Program slots whose pack threw: reported once, not packed again until the idle trim. */
  private readonly failedSlots: ProgramSlot[] = [];
  /** Types whose time function threw: reported once, until the idle trim. */
  private readonly failedTimes: TypeRecord[] = [];
  /** The first error a time function threw in this draw, for `reportErrors`. */
  private thrown = false;
  private thrownError: unknown = null;
  private thrownName = '';

  constructor(
    nodes: NodeStore,
    owner: ShaderClock,
    pixelRatio: number,
    host: ProgramHost,
  ) {
    this.nodes = nodes;
    this.owner = owner;
    this.pixelRatio = pixelRatio;
    this.host = host;
    this.writer = new UniformWriter(pixelRatio);
  }

  /** Params blocks in the cache, held or not (for tests and telemetry). */
  get blockCount(): number {
    return this.cache.size;
  }

  /** 1.10 registerShaderType: a name taken already keeps its type. */
  register(name: string, type: ShaderType): void {
    if (this.byName[name] !== undefined) {
      console.warn(`Shader type ${name} is already registered`);
      return;
    }
    let rec = this.records.get(type);
    if (rec === undefined) {
      rec = this.record(name, type);
      this.records.set(type, rec);
      this.order.push(rec);
    }
    this.byName[name] = rec;
  }

  /**
   * The idle warm-up (the Renderer's timer chain): compile the program of
   * the next registered type's default props, in registration order, unless
   * a node packed it already; false when no type is left. A failure is not
   * reported: the slot stays uncompiled, so the first node packing it
   * compiles it again and reports that. A type whose `resolve` or
   * `variant` (app code) throws on its default props is skipped.
   */
  warmNext(): boolean {
    const order = this.order;
    while (this.warmed < order.length) {
      const shader = this.defaults(order[this.warmed++]!);
      if (shader !== null && shader._slot.id === -1) {
        this.compile(shader, false);
        return true;
      }
    }
    return false;
  }

  /**
   * A shader of a registered type, its props resolved; null, with a
   * warning, for a name not registered (1.10 returned its default shader).
   * Nothing compiles here: a program compiles when a node first packs it.
   */
  create(name: string, props?: Record<string, unknown>): ShaderNode | null {
    const rec = this.byName[name];
    if (rec === undefined) {
      console.warn(`Shader type ${name} is not registered`);
      return null;
    }
    const given = props === undefined ? {} : props;
    const values: Record<string, unknown> = {};
    const names = rec.names;
    const configs = rec.configs;
    // An array, given or a default, is copied: an alias writes into the
    // shader's own, never into one the app or another shader holds.
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!;
      const config = configs[i];
      const value = given[key];
      if (isAdvanced(config) === false) {
        values[key] = copyOf(value !== undefined ? value : config);
      } else if (config.resolve !== undefined) {
        values[key] = config.resolve(value, values);
      } else {
        values[key] = copyOf(value !== undefined ? value : config.default);
      }
    }
    // Aliases after the props they write, as 1.10's definition order had it.
    const aliases = rec.aliases;
    for (let i = 0; i < aliases.length; i++) {
      const value = given[aliases[i]!];
      if (value !== undefined) {
        rec.aliasConfigs[i]!.set!(value, values);
      }
    }
    const variant = rec.variant === null ? '' : rec.variant(values);
    return new ShaderNode(this, rec, values, this.slot(rec, variant));
  }

  /**
   * The shader part of PassHooks.packShader: the node's shader, a shader
   * prop or its size changed. Compiles the shader's program on first use
   * and repacks only when the key changed.
   */
  pack(id: number): void {
    const s = this.nodes;
    const ref = s.shaderRefs[id] as ShaderNode | null;
    // Another registry's shader, or an object that is no shader, draws
    // with Default.
    const shader = ref !== null && ref._registry === this ? ref : null;
    const users = this.users;
    if (shader === null && (id >= users.length || users[id] === null)) {
      return;
    }
    this.ensure(id);
    if (users[id] !== shader) {
      this.detach(id);
      if (shader !== null) {
        this.attach(shader, id);
      }
    }
    if (shader === null) {
      this.unset(id);
      return;
    }
    let props = shader._key;
    // Built from the values in this pack, not cached by an earlier one.
    const fresh = props === null;
    if (props === null) {
      // New, or a prop changed. A write to one of the type's variantProps
      // re-derives the variant, and the nodes switch program with it;
      // without them the variant stays as created (1.10).
      if (shader._rederive === true) {
        shader._rederive = false;
        this.rederive(shader);
      }
      props = this.propsKey(shader);
      shader._key = props;
    }
    const slot = shader._slot;
    if (slot.id === -1) {
      this.compile(shader, true);
    }
    if (slot.id === 0) {
      this.unset(id);
      return;
    }
    const w = s.f64[id * F_STRIDE + F_W]!;
    const h = s.f64[id * F_STRIDE + F_H]!;
    const keyed = slot.keyed;
    const current = s.params[id] as Float32Array | null;
    if (current !== null && this.holds(current, props, keyed, w, h) === true) {
      return;
    }
    let block: Float32Array | null = null;
    if (keyed !== UNKEYED) {
      block = this.cached(shader, fresh, keyed, w, h);
      if (block === null) {
        // The key of what is packed now (`cached` may have rebuilt it).
        const packed = shader._key!;
        // Without a pack the block is empty (its table is empty: it uploads
        // nothing), but one per key, so that block-reference batching
        // splits the ops where the per-op values differ (see SIZED).
        block =
          shader._rec.pack === null
            ? new Float32Array(0)
            : this.packBlock(shader, w, h);
        // A custom pack (app code) destroyed the node.
        if (s.i32[id * I_STRIDE + I_UID] === 0) {
          return;
        }
        if (block === null) {
          this.unset(id);
          return;
        }
        this.add(
          block,
          packed,
          keyed,
          w,
          h,
          shader._rec.pack !== null && this.packedNoAlpha,
        );
      }
    }
    this.unref(current);
    let noAlpha = false;
    if (block !== null) {
      const entry = this.entries.get(block)!;
      if (entry.refs === 0) {
        this.idle--;
      }
      entry.refs++;
      noAlpha = entry.noAlpha;
    }
    s.params[id] = block;
    const program = slot.id;
    s.i32[id * I_STRIDE + I_SHADER] = program;
    let state = s.u32[id * I_STRIDE + I_STATE]!;
    state =
      (this.masks[program]! & MATCHED) !== 0 || this.batches[program] !== null
        ? state | ST_PER_OP
        : state & ~ST_PER_OP;
    s.u32[id * I_STRIDE + I_STATE] =
      noAlpha === true ? state | ST_ALPHA_UNUSED : state & ~ST_ALPHA_UNUSED;
  }

  /**
   * PassHooks.perOpMatch, asked for an ST_PER_OP node: can its quad join
   * the op whose first node is `opNode`? OpList.add compares the params
   * block, so this compares what the per-op uniforms take from the op's
   * first node: world alpha (unless the shared block reads none,
   * `ST_ALPHA_UNUSED`), and a growing quad's 2x2 and UV rect. A type's
   * `canBatch` decides instead, given the two node handles (1.10).
   */
  perOpMatch(id: number, opNode: number): boolean {
    const s = this.nodes;
    const program = s.i32[id * I_STRIDE + I_SHADER]!;
    // A different program, a glyph op's included, starts an op anyway.
    if (s.i32[opNode * I_STRIDE + I_SHADER] !== program) {
      return true;
    }
    const canBatch = this.batches[program]!;
    if (canBatch !== null) {
      return canBatch(s.handles[id]!, s.handles[opNode]!);
    }
    const mask = this.masks[program]!;
    if (
      (mask & (1 << U_ALPHA)) !== 0 &&
      s.f64[id * F_STRIDE + F_WORLD_ALPHA] !==
        s.f64[opNode * F_STRIDE + F_WORLD_ALPHA] &&
      (s.u32[id * I_STRIDE + I_STATE]! & ST_ALPHA_UNUSED) === 0
    ) {
      return false;
    }
    if (
      (mask & (1 << U_TRANSFORM)) !== 0 &&
      (s.f64[id * F_STRIDE + F_WA] !== s.f64[opNode * F_STRIDE + F_WA] ||
        s.f64[id * F_STRIDE + F_WB] !== s.f64[opNode * F_STRIDE + F_WB] ||
        s.f64[id * F_STRIDE + F_WC] !== s.f64[opNode * F_STRIDE + F_WC] ||
        s.f64[id * F_STRIDE + F_WD] !== s.f64[opNode * F_STRIDE + F_WD])
    ) {
      return false;
    }
    return (
      (mask & (1 << U_UV_RECT)) === 0 ||
      (s.f32[id * I_STRIDE + I_UV_X1] === s.f32[opNode * I_STRIDE + I_UV_X1] &&
        s.f32[id * I_STRIDE + I_UV_Y1] === s.f32[opNode * I_STRIDE + I_UV_Y1] &&
        s.f32[id * I_STRIDE + I_UV_X2] === s.f32[opNode * I_STRIDE + I_UV_X2] &&
        s.f32[id * I_STRIDE + I_UV_Y2] === s.f32[opNode * I_STRIDE + I_UV_Y2])
    );
  }

  /** RendererCore.releaseNode: the node is destroyed; drop its shader state. */
  release(id: number): void {
    if (id < this.users.length) {
      this.detach(id);
      this.unset(id);
    }
  }

  /** Mark every node using `shader` for a repack (a prop changed). */
  setPixelRatio(value: number): void {
    if (this.pixelRatio === value) return;
    this.pixelRatio = value;
    this.writer.pixelRatio = value;
    for (const context of this.resizeContexts) context.stage.pixelRatio=value;
    for (let id = 0; id < this.users.length; id++) {
      if (this.users[id]) {
        this.unset(id);
        this.nodes.markDirty(id, DIRTY_SHADER);
      }
    }
    this.dropIdle();
  }

  markUsers(shader: ShaderNode): void {
    const nodes = this.nodes;
    const next = this.next;
    let id = shader._head;
    while (id !== NULL) {
      nodes.markDirty(id, DIRTY_SHADER);
      id = next[id]!;
    }
  }

  /**
   * Idle maintenance: drop the params blocks no node holds, and give the
   * programs whose pack threw another try (a pack that throws again is
   * reported again), as the types whose time function threw.
   */
  trim(): void {
    const failedSlots = this.failedSlots;
    for (let i = 0; i < failedSlots.length; i++) {
      failedSlots[i]!.packFailed = false;
    }
    failedSlots.length = 0;
    const failedTimes = this.failedTimes;
    for (let i = 0; i < failedTimes.length; i++) {
      failedTimes[i]!.timeThrew = false;
    }
    failedTimes.length = 0;
    this.dropIdle();
  }

  /**
   * Drop the params blocks no node holds: the idle trim, and a cache miss
   * past MAX_IDLE, which leaves the failure flags alone (an endless
   * animation would otherwise report a failure again about every 257
   * misses).
   */
  private dropIdle(): void {
    const cache = this.cache;
    const entries = this.entries;
    entries.forEach((entry, block) => {
      if (entry.refs === 0) {
        entries.delete(block);
        cache.delete(entry.key);
      }
    });
    this.idle = 0;
  }

  /**
   * After the draw: report the first error a time function threw while
   * drawing (app code), through `onError` (the Renderer's loop error), else
   * console.error. Never inside the draw loop. A type's is reported once,
   * until the idle trim, not on every frame it draws; one that waited behind
   * another type's in a draw is reported after a later one.
   */
  reportErrors(): void {
    if (this.thrown === false) {
      return;
    }
    this.thrown = false;
    const error = this.thrownError;
    this.thrownError = null;
    const onError = this.onError;
    if (onError !== null) {
      onError(error);
    } else {
      console.error(`Shader ${this.thrownName} time function threw`, error);
    }
  }

  /**
   * A program outside any shader type (the SDF text program, phase 5),
   * compiled when first needed: 0 when it fails, reported with `failure`,
   * the caller's account of what happens then (no node falls back to
   * Default for it: text does not draw), unless the context is lost. With
   * `failure` null (the idle warm-up) a failure returns -1, unreported:
   * not compiled yet, so the first use compiles it again and reports that.
   * `name` is the program's, for developer tools.
   */
  program(
    vertex: string,
    fragment: string,
    failure: string | null,
    name: string,
  ): number {
    try {
      return this.host.register(
        vertex,
        fragment,
        null,
        new UniformTable(),
        null,
        name,
      );
    } catch (error) {
      if (failure === null) {
        return -1;
      }
      this.failed(failure, error);
      return 0;
    }
  }

  private record(name: string, type: ShaderType): TypeRecord {
    const names: string[] = [];
    const configs: unknown[] = [];
    const aliases: string[] = [];
    const aliasConfigs: AdvancedProp[] = [];
    const colors: string[] = [];
    const props = (type.props ?? {}) as Record<string, unknown>;
    for (const key in props) {
      const config = props[key];
      // A prop or an alias: an animation writes either through the facade.
      if (isAdvanced(config) === true && config.color === true) {
        colors.push(key);
      }
      if (isAdvanced(config) === true && config.set !== undefined) {
        aliases.push(key);
        aliasConfigs.push(config);
        continue;
      }
      names.push(key);
      configs.push(config);
    }
    let pack = (type.pack ?? null) as Pack | null;
    const update = type.update;
    if (pack === null && update !== undefined) {
      // 1.10: `this` offers the props and the uniform* calls, `node` its size.
      const context = new UpdateContext(this.pixelRatio);
      if(this.host.resizable) this.resizeContexts.push(context);
      const node: UpdateNode = { w: 0, h: 0, width: 0, height: 0 };
      pack = (values, w, h, u) => {
        context.props = values;
        context.u = u;
        node.w = w;
        node.width = w;
        node.h = h;
        node.height = h;
        update.call(context as never, node);
      };
    }
    const variant = (type.variant ?? type.getCacheMarkers ?? null) as
      | ((props: Record<string, unknown>) => string)
      | null;
    // Re-derived only with a variant to re-derive.
    const variantProps = variant === null ? null : type.variantProps ?? null;
    const time = type.time;
    const owner = this.owner;
    let timeOf: ((node: number) => number) | null = null;
    if (time === true) {
      timeOf = () => this.drawn(owner.elapsedTime);
    } else if (typeof time === 'function') {
      // The shader the node was packed with: `users` changes only on a
      // pack, so the one its op was emitted with, even if replaced since.
      // Only a node destroyed after its quad was emitted reads as static.
      timeOf = (node) => {
        const shader = this.users[node];
        return this.drawn(
          shader === null || shader === undefined
            ? null
            : this.evaluate(time as TimeOf, shader),
        );
      };
    }
    return {
      id: this.records.size,
      name,
      type,
      names,
      configs,
      aliases,
      aliasConfigs,
      colors,
      proto: facadeProto(names, configs, aliases, aliasConfigs, variantProps),
      slots: Object.create(null) as Record<string, ProgramSlot>,
      pack,
      variant,
      timeOf,
      variants: 0,
      variantThrew: false,
      timeThrew: false,
    };
  }

  /**
   * `block`, a node's, is the one for props key `props` at (w, h): the
   * key is unchanged, and no key string is built to find that out.
   */
  private holds(
    block: Float32Array,
    props: string,
    keyed: number,
    w: number,
    h: number,
  ): boolean {
    const entry = this.entries.get(block)!;
    return (
      entry.props === props &&
      (keyed !== SIZED || (entry.w === w && entry.h === h))
    );
  }

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
  private cached(
    shader: ShaderNode,
    fresh: boolean,
    keyed: number,
    w: number,
    h: number,
  ): Float32Array | null {
    const cache = this.cache;
    const key = shader._key!;
    const block = cache.get(keyOf(key, keyed, w, h));
    if (block !== undefined) {
      return block;
    }
    if (fresh === true) {
      return null;
    }
    const props = this.propsKey(shader);
    // The same key misses again: every frame of a size animation lands here.
    if (props === key) {
      return null;
    }
    shader._key = props;
    const rebuilt = cache.get(keyOf(props, keyed, w, h));
    return rebuilt === undefined ? null : rebuilt;
  }

  /**
   * Cache a new block for props key `props` at (w, h), held by no node
   * yet; first, past MAX_IDLE blocks no node holds, drop those.
   */
  private add(
    block: Float32Array,
    props: string,
    keyed: number,
    w: number,
    h: number,
    noAlpha: boolean,
  ): void {
    if (this.idle > MAX_IDLE) {
      this.dropIdle();
    }
    const key = keyOf(props, keyed, w, h);
    this.cache.set(key, block);
    this.entries.set(block, { key, props, w, h, noAlpha, refs: 0 });
    this.idle++;
  }

  /**
   * The props part of a params key: type, variant and every value, in
   * order, each by its string form and an array by its elements'. Numbers,
   * strings, booleans, null, undefined and flat arrays of those key apart;
   * an object that is not an array keys as "[object Object]" and a nested
   * array flattens, so two such values can share a block (1.10 the same).
   */
  private propsKey(shader: ShaderNode): string {
    const rec = shader._rec;
    const values = shader.values;
    const names = rec.names;
    let key = rec.id + '|' + shader._slot.variant;
    for (let i = 0; i < names.length; i++) {
      const value = values[names[i]!];
      key +=
        '|' +
        (Array.isArray(value) === true
          ? (value as unknown[]).join(',')
          : String(value));
    }
    return key + '|';
  }

  /** Compile the shader's slot; `report` false (the warm-up) leaves a failed one uncompiled. */
  private compile(shader: ShaderNode, report: boolean): void {
    const slot = shader._slot;
    const rec = shader._rec;
    const type = rec.type;
    const host = this.host;
    const ratio = this.pixelRatio;
    const context: ShaderContext = {
      pixelRatio: ratio,
      resizable: host.resizable,
      viewport: host.viewport,
      stage: { pixelRatio: ratio },
    };
    const values = shader.values as never;
    try {
      const vertex =
        type.vertex === undefined
          ? defaultVertex(
              host.viewport,
              'varying vec2 v_nodeCoords;',
              'v_nodeCoords=a_nodeCoords;',
            )
          : typeof type.vertex === 'string'
          ? type.vertex
          : type.vertex(context, values);
      const fragment =
        typeof type.fragment === 'string'
          ? type.fragment
          : type.fragment(context, values);
      const id = host.register(
        vertex,
        fragment,
        type.webgl1Extensions ?? null,
        slot.table,
        rec.timeOf,
        slot.variant === '' ? rec.name : rec.name + ':' + slot.variant,
      );
      // Kept dense (program ids grow from 0): perOpMatch reads them.
      const masks = this.masks;
      const batches = this.batches;
      while (masks.length <= id) {
        masks.push(0);
        batches.push(null);
      }
      const mask = host.systemMask(id);
      masks[id] = mask;
      batches[id] = (type.canBatch ?? null) as
        | ((a: object, b: object) => boolean)
        | null;
      slot.keyed =
        rec.pack !== null || (mask & (1 << U_DIMENSIONS)) !== 0
          ? SIZED
          : (mask & (1 << U_TIME)) !== 0 && typeof type.time === 'function'
          ? PROPS
          : UNKEYED;
      slot.id = id;
    } catch (error) {
      if (report === false) {
        return;
      }
      slot.id = 0;
      this.failed(
        `Shader ${rec.name} failed to compile; its nodes draw without it`,
        error,
      );
    }
  }

  /**
   * A shader of `rec` with its default props, as `createShader` without
   * props makes it (its slot is the one a node would compile); null when
   * a `resolve` or `variant` threw.
   */
  private defaults(rec: TypeRecord): ShaderNode | null {
    try {
      return this.create(rec.name);
    } catch (error) {
      return null;
    }
  }

  /**
   * Pack a block; null when the pack (app code) throws, which is reported
   * once per program: its nodes draw without the effect and do not run the
   * pack again until the idle trim, whatever their key (a size animation
   * makes a new one every frame).
   */
  private packBlock(
    shader: ShaderNode,
    w: number,
    h: number,
  ): Float32Array | null {
    const slot = shader._slot;
    if (slot.packFailed === true) {
      return null;
    }
    const u = this.writer;
    try {
      shader._rec.pack!(shader.values, w, h, u);
    } catch (error) {
      u.reset();
      slot.packFailed = true;
      this.failedSlots.push(slot);
      console.error(
        `Shader ${shader._rec.name} failed to pack; its nodes draw without it`,
        error,
      );
      return null;
    }
    this.packedNoAlpha = u.noAlpha;
    return u.finish(slot.table);
  }

  /**
   * The program slot of a type's variant, made on first use. Each compiles
   * a program of its own: past 16, a warning, once per type.
   */
  private slot(rec: TypeRecord, variant: string): ProgramSlot {
    let slot = rec.slots[variant];
    if (slot === undefined) {
      slot = {
        id: -1,
        variant,
        table: new UniformTable(),
        keyed: UNKEYED,
        packFailed: false,
      };
      rec.slots[variant] = slot;
      rec.variants++;
      if (rec.variants === 17) {
        console.warn(
          `Shader ${rec.name} has more than 16 variants: each compiles a program of its own`,
        );
      }
    }
    return slot;
  }

  /**
   * A write to one of the type's `variantProps`: evaluate the variant (app
   * code, in the frame) and move the shader to that variant's program. One
   * that throws is reported once per type and keeps the current program.
   */
  private rederive(shader: ShaderNode): void {
    const rec = shader._rec;
    let variant: string;
    try {
      variant = rec.variant!(shader.values);
    } catch (error) {
      if (rec.variantThrew === false) {
        rec.variantThrew = true;
        console.error(
          `Shader ${rec.name} variant threw; its nodes keep their program`,
          error,
        );
      }
      return;
    }
    if (variant !== shader._slot.variant) {
      shader._slot = this.slot(rec, variant);
    }
  }

  /**
   * The time value a drawn op uploads. Every drawn op of a timed program
   * marks `timed`, so the Renderer asks for the next frame (1.10's timer
   * that updates every loop): only drawn nodes, since one out of bounds or
   * hidden is not emitted. A time function's null is a static value: 0,
   * and no frame asked, as is anything else not a number (undefined, from
   * a 1.10 function with a missing return); NaN asks for none either.
   */
  private drawn(t: number | null): number {
    if (typeof t !== 'number') {
      return 0;
    }
    if (t === t) {
      this.timed = true;
    }
    return t;
  }

  /**
   * A type's time function, run while drawing: a throw (app code) reads as
   * a static value, so the draw goes on and asks for no frame, and the
   * draw's first error of a type not reported since the idle trim waits for
   * `reportErrors`. The try/catch keeps to this small helper, out of the
   * draw loop's body.
   */
  private evaluate(time: TimeOf, shader: ShaderNode): number | null {
    try {
      return time(this.owner, shader.values);
    } catch (error) {
      const rec = shader._rec;
      if (this.thrown === false && rec.timeThrew === false) {
        rec.timeThrew = true;
        this.failedTimes.push(rec);
        this.thrown = true;
        this.thrownError = error;
        this.thrownName = rec.name;
      }
      return null;
    }
  }

  /** A compile failed: the context's loss, else `message` and the error. */
  private failed(message: string, error: unknown): void {
    if (this.host.isLost() === true) {
      const onLost = this.onLost;
      if (onLost !== null) {
        onLost();
      }
      return;
    }
    console.error(message, error);
  }

  /** The node draws with Default: program 0, no block, no per-op check. */
  private unset(id: number): void {
    const s = this.nodes;
    this.unref(s.params[id] as Float32Array | null);
    s.params[id] = null;
    s.i32[id * I_STRIDE + I_SHADER] = 0;
    s.u32[id * I_STRIDE + I_STATE] =
      s.u32[id * I_STRIDE + I_STATE]! & ~(ST_PER_OP | ST_ALPHA_UNUSED);
  }

  private unref(block: Float32Array | null): void {
    if (block === null) {
      return;
    }
    const entry = this.entries.get(block)!;
    entry.refs--;
    if (entry.refs === 0) {
      this.idle++;
    }
  }

  /** Grow the per-node arrays to the store's capacity. */
  private ensure(id: number): void {
    const users = this.users;
    if (id < users.length) {
      return;
    }
    const n = this.nodes.capacity;
    while (users.length < n) {
      users.push(null);
    }
    const old = this.next.length;
    const next = new Int32Array(n);
    next.set(this.next);
    const prev = new Int32Array(n);
    prev.set(this.prev);
    // A loop: typed-array fill is Chrome 45, above the Chrome 38 floor.
    for (let i = old; i < n; i++) {
      next[i] = NULL;
      prev[i] = NULL;
    }
    this.next = next;
    this.prev = prev;
  }

  private attach(shader: ShaderNode, id: number): void {
    const head = shader._head;
    this.users[id] = shader;
    this.next[id] = head;
    this.prev[id] = NULL;
    if (head !== NULL) {
      this.prev[head] = id;
    }
    shader._head = id;
  }

  private detach(id: number): void {
    const shader = this.users[id]!;
    if (shader === null) {
      return;
    }
    const next = this.next;
    const prev = this.prev;
    const p = prev[id]!;
    const n = next[id]!;
    if (p !== NULL) {
      next[p] = n;
    } else {
      shader._head = n;
    }
    if (n !== NULL) {
      prev[n] = p;
    }
    next[id] = NULL;
    prev[id] = NULL;
    this.users[id] = null;
  }
}

/**
 * The prototype of a type's `props` facades: an enumerable accessor per
 * prop and alias, reaching the shader through the facade's SHADER link.
 * A write that resolves to the value held changes nothing, unless it is an
 * array or another object: that one always stores and marks, so an array
 * written back after a change in place repacks (1.10's setter always
 * marked), as does a new array with equal content. A write to a prop in
 * `variantProps` re-derives the variant at the next pack (an alias never).
 */
function facadeProto(
  names: string[],
  configs: unknown[],
  aliases: string[],
  aliasConfigs: AdvancedProp[],
  variantProps: string[] | null,
): object {
  const proto = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const config = configs[i];
    const resolver =
      isAdvanced(config) === true && config.resolve !== undefined
        ? config
        : null;
    const variant = variantProps !== null && variantProps.indexOf(name) !== -1;
    Object.defineProperty(proto, name, {
      enumerable: true,
      get(this: Facade): unknown {
        // Read on the prototype itself (an inspector expanding it): no shader.
        const shader = this[SHADER];
        return shader === undefined ? undefined : shader.values[name];
      },
      set(this: Facade, v: unknown): void {
        const shader = this[SHADER];
        const values = shader.values;
        const value = resolver === null ? v : resolver.resolve!(v, values);
        // typeof null is 'object': null is a value held like a number.
        if (
          value === values[name] &&
          (value === null || typeof value !== 'object')
        ) {
          return;
        }
        values[name] = value;
        shader._changed(variant);
      },
    });
  }
  for (let i = 0; i < aliases.length; i++) {
    const config = aliasConfigs[i]!;
    Object.defineProperty(proto, aliases[i]!, {
      enumerable: true,
      get(this: Facade): unknown {
        const shader = this[SHADER];
        return shader === undefined || config.get === undefined
          ? undefined
          : config.get(shader.values);
      },
      set(this: Facade, v: unknown): void {
        const shader = this[SHADER];
        config.set!(v, shader.values);
        shader._changed(false);
      },
    });
  }
  return proto;
}

/**
 * The program host of the headless core: ids from 1, and a uniform is
 * active when a source names it (as the fake GL context has it). Nothing
 * compiles.
 */
export function headlessHost(viewport: string): ProgramHost {
  const masks: number[] = [0];
  return {
    viewport,
    register(vertex, fragment) {
      let mask = 0;
      for (let i = 0; i < SYSTEM_UNIFORMS.length; i++) {
        const name = SYSTEM_UNIFORMS[i]!;
        if (vertex.indexOf(name) !== -1 || fragment.indexOf(name) !== -1) {
          mask |= 1 << i;
        }
      }
      masks.push(mask);
      return masks.length - 1;
    },
    systemMask(program) {
      return masks[program]!;
    },
    isLost() {
      return false;
    },
  };
}
