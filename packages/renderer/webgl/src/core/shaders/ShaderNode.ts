import { NULL } from '../nodes/NodeFlags.js';
import type { ShaderType } from './ShaderType.js';
import type {
  ProgramSlot,
  ShaderRegistry,
  TypeRecord,
} from './ShaderRegistry.js';

/**
 * A `props` facade's link to its shader. A symbol: no prop name collides
 * with it, and `for...in` never lists it.
 */
export const SHADER: unique symbol = Symbol('shader');

/** A shader's `props` facade, as its prototype's accessors see it. */
export interface Facade {
  [SHADER]: ShaderNode;
}

/**
 * A shader (spec 8.2), from `renderer.createShader`, assigned to
 * `node.shader`. Its props are a facade object of their own, as in 1.10:
 * `shader.props`, whose prototype (built once per type) has an enumerable
 * accessor per prop. A write, direct or by an animation or Solid's
 * effects, resolves the value, stores it in `values` and marks every node
 * using the shader, nothing else. A key the type does not declare (Solid
 * writes `props.border = {...}`) lands on the facade and does nothing, as
 * in 1.10. One shader can serve many nodes of any sizes: each node packs a
 * params block of its own size. The other members are the registry's, on
 * the shader, never on the facade: a prop may have any name.
 */
export class ShaderNode {
  /** The registered type (1.10 `shaderType`; Solid tests `'shaderType' in` a shader). */
  readonly shaderType: ShaderType;
  /** The resolved, alias-free prop values: what `pack` reads. */
  readonly values: Record<string, unknown>;
  /** @hidden */
  readonly _registry: ShaderRegistry;
  /** @hidden */
  readonly _rec: TypeRecord;
  /**
   * The program of this shader's variant: replaced when a prop write changes the variant.
   *
   * @hidden
   */
  _slot: ProgramSlot;
  /** The first node using the shader (ShaderRegistry's links), NULL when none. */
  _head = NULL;
  /**
   * The props part of the params key; null once a prop changed. A values
   * array changed in place (no write) leaves it describing the old
   * content: the registry rebuilds it on a cache miss.
   */
  _key: string | null = null;
  /** One of the type's `variantProps` changed: the next pack re-derives the variant. */
  _rederive = false;
  private readonly _props: Record<string, unknown>;

  constructor(
    registry: ShaderRegistry,
    rec: TypeRecord,
    values: Record<string, unknown>,
    slot: ProgramSlot,
  ) {
    this._registry = registry;
    this._rec = rec;
    this.shaderType = rec.type;
    this.values = values;
    this._slot = slot;
    const props = Object.create(rec.proto) as Facade;
    props[SHADER] = this;
    this._props = props as unknown as Record<string, unknown>;
  }

  /** The facade: `shader.props.radius = 10`; a read returns the resolved value. */
  get props(): Record<string, unknown> {
    return this._props;
  }

  /** Write each key to the facade, as 1.10's `props` setter did. */
  set props(props: Record<string, unknown>) {
    const facade = this._props;
    for (const key in props) {
      facade[key] = props[key];
    }
  }

  /**
   * A prop changed: rebuild the key, and repack every node using the
   * shader; `variant` when it is one of the type's `variantProps`.
   */
  _changed(variant: boolean): void {
    this._key = null;
    if (variant === true) {
      this._rederive = true;
    }
    this._registry.markUsers(this);
  }
}
