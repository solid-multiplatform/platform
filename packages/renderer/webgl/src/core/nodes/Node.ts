import { EventEmitter } from '../../common/EventEmitter.js';
import { Animation } from '../animation/Animation.js';
import type {
  AnimationSettings,
  IAnimationController,
  NodeImageState,
  RenderStateValue,
  TextureOptions,
} from '../../common/types.js';
import type { NodeStore } from './NodeStore.js';
import type { ShaderNode } from '../shaders/ShaderNode.js';
import type { Texture } from '../textures/Texture.js';
import type { TextureNodes } from '../textures/TextureNodes.js';
import type { AnimateProps } from '../animation/Animation.js';
import type { AnimationManager } from '../animation/AnimationManager.js';
import type { ClipStore } from '../scene/ClipStore.js';
import {
  DIRTY_ALPHA,
  DIRTY_CLIP,
  DIRTY_COLOR,
  DIRTY_DIRECTION,
  DIRTY_INHERITED,
  DIRTY_LOCAL,
  DIRTY_RENDERABLE,
  DIRTY_SHADER,
  DIRTY_TEXTURE,
  NULL,
  ST_AUTOSIZE,
  ST_AUTOSIZE_DUE,
  ST_CLIPS,
  ST_CONTAIN,
  ST_IGNORE_PARENT_ALPHA,
  ST_PRELOAD,
  ST_RTL,
  ST_SRC,
  renderStateOf,
  visibilityOf,
} from './NodeFlags.js';
import {
  DIR_INHERIT,
  DIR_LTR,
  DIR_RTL,
  F_ALPHA,
  F_H,
  F_MOUNT_X,
  F_MOUNT_Y,
  F_PIVOT_X,
  F_PIVOT_Y,
  F_ROTATION,
  F_SCALE_X,
  F_SCALE_Y,
  F_STRIDE,
  F_W,
  F_WTX,
  F_WTY,
  F_X,
  F_Y,
  F_Z_INDEX,
  I_CLIP,
  I_COLOR_BL,
  I_COLOR_BR,
  I_COLOR_TL,
  I_COLOR_TR,
  I_DIRECTION,
  I_FIRST_CHILD,
  I_PARENT,
  I_PLACEHOLDER_COLOR,
  I_STATE,
  I_STRIDE,
  I_UID,
} from './NodeLayout.js';

/**
 * 1.10 parity: `textureOptions` defaults to this shared frozen empty object
 * (main:src/core/Stage.ts `EMPTY_TEXTURE_OPTIONS`) rather than `null` or
 * `undefined`, so `node.textureOptions.resizeMode` never throws. Frozen and
 * shared (not allocated per read or per node) since it is never written to.
 */
const EMPTY_TEXTURE_OPTIONS: TextureOptions = Object.freeze({});

/** What a handle needs from its renderer. `RendererCore` implements it. */
export interface NodeOwner {
  readonly nodes: NodeStore;
  readonly animationManager: AnimationManager;
  readonly clips: ClipStore;
  /** `node.imageState` reads its texture state through it. */
  readonly textureNodes: TextureNodes;
  /** @internal `node.destroy()` is the public way (spec 13.3). */
  destroyNode(node: Node): void;
}

export type ClippingValue = boolean | [number, number, number, number];

/** 1.10's clipping rect: logical pixels; `valid: false` when nothing clips. */
export interface RectWithValid {
  valid: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ImageType = 'regular' | 'compressed' | 'svg' | null;

export interface NodeExtras {
  srcX: number | undefined;
  srcY: number | undefined;
  srcWidth: number | undefined;
  srcHeight: number | undefined;
  imageType: ImageType | undefined;
  componentName: string | undefined;
  componentLocation: string | undefined;
  atlasGroup: string | undefined;
}

export interface INodeProps {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  color: number;
  colorTop: number;
  colorBottom: number;
  colorLeft: number;
  colorRight: number;
  colorTl: number;
  colorTr: number;
  colorBl: number;
  colorBr: number;
  scale: number | null;
  scaleX: number;
  scaleY: number;
  rotation: number;
  mount: number;
  mountX: number;
  mountY: number;
  pivot: number;
  pivotX: number;
  pivotY: number;
  zIndex: number;
  clipping: ClippingValue;
  parent: Node | null;
  ignoreParentAlpha: boolean;
  placeholderColor: number;
  autosize: boolean;
  /**
   * The layout direction of this node's children: true lays them out
   * mirrored (a child's x is measured from this node's right edge, its
   * mount and pivot flipped), false lays them out left to right, null (the
   * default) inherits the parent's. A node's own placement follows its
   * parent's resolved direction; its own value governs its children and,
   * for a text node, its left/right alignment. Reads back as written.
   */
  rtl: boolean | null;
  data: Record<string, unknown> | null;
  src: string | null;
  // Optional, typed and nullable as in 1.10's props (Solid's DOM renderer
  // implements them).
  srcX?: number;
  srcY?: number;
  srcWidth?: number;
  srcHeight?: number;
  imageType?: ImageType;
  textureOptions: TextureOptions;
  texture: Texture | null;
  shader: object | null;
  componentName?: string;
  componentLocation?: string;
  /**
   * With the `imageAtlas` setting: images shown in this node's subtree go
   * onto atlas pages of this group only, so a row's images share pages,
   * batch together and are freed together. The nearest ancestor (or the
   * node itself) that sets one decides, when the image is uploaded; an
   * image already on a page stays there. Unset everywhere: one shared
   * group. Inert without the setting.
   */
  atlasGroup?: string;
}

export interface AnimationSlot {
  controller: Animation;
  settings: Partial<AnimationSettings>;
}

/** Store prop `field` (an F_* offset) and mark `bits`, when it changed. */
function setF(n: Node, field: number, v: number, bits: number): void {
  const id = n.id;
  if (id === NULL) {
    return;
  }
  const s = n.renderer.nodes;
  const f64 = s.f64;
  const i = id * F_STRIDE + field;
  if (f64[i] === v) {
    return;
  }
  f64[i] = v;
  s.markDirty(id, bits);
}

/** Store colour `field` (an I_COLOR_* offset) and mark DIRTY_COLOR, when it changed. */
function setC(n: Node, field: number, v: number): void {
  const id = n.id;
  if (id === NULL) {
    return;
  }
  // Coerce once before comparing: a colour built with bitwise ops (e.g.
  // `x | 0`) can be a negative signed int32 that is bit-identical to the
  // always-unsigned value already stored, so comparing the raw `v` against
  // `arr[id]` without coercion never matches and marks dirty on every
  // write of the "same" colour.
  const uv = v >>> 0;
  const s = n.renderer.nodes;
  const u32 = s.u32;
  const i = id * I_STRIDE + field;
  if (u32[i] === uv) {
    return;
  }
  u32[i] = uv;
  s.markDirty(id, DIRTY_COLOR);
}

function setStateBit(n: Node, bit: number, on: boolean, dirty: number): void {
  const id = n.id;
  if (id === NULL) {
    return;
  }
  const s = n.renderer.nodes;
  const state = s.u32[id * I_STRIDE + I_STATE]!;
  const next = on === true ? state | bit : state & ~bit;
  if (next === state) {
    return;
  }
  s.u32[id * I_STRIDE + I_STATE] = next;
  s.markDirty(id, dirty);
}

/**
 * A texture input changed: raise `bits`, and list a node with preload set
 * for TextureNodes.drainPreloads, since preload is a want outside the walk
 * (spec 9.2) and the walk never visits a node under a culled ancestor.
 */
function textureDirty(n: Node, id: number, bits: number): void {
  const s = n.renderer.nodes;
  s.markDirty(id, bits);
  if ((s.u32[id * I_STRIDE + I_STATE]! & ST_PRELOAD) !== 0) {
    s.queuePreload(id);
  }
}

/**
 * Resolve (and lazily create) a node's extras record.
 *
 * `s.extras` is a plain JS array, not a typed array: indexing it at a
 * negative id does not throw, but it also is not `null` the way a freed,
 * in-range slot is (`NodeStore.free` explicitly resets those to `null`) - an
 * index that was never written reads back `undefined`. A destroyed handle's
 * `id` is `NULL` (-1), so it must be special-cased here and returned as
 * `null` directly: comparing the raw read against `null` would miss the
 * `undefined` case and let a caller dereference it, and creating on demand
 * would write into `s.extras[-1]`, a single slot shared by every destroyed
 * handle.
 */
function extrasOf(n: Node, create: boolean): NodeExtras | null {
  const id = n.id;
  if (id === NULL) {
    return null;
  }
  const s = n.renderer.nodes;
  let e = s.extras[id] as NodeExtras | null;
  if (e === null && create === true) {
    e = {
      srcX: undefined,
      srcY: undefined,
      srcWidth: undefined,
      srcHeight: undefined,
      imageType: undefined,
      componentName: undefined,
      componentLocation: undefined,
      atlasGroup: undefined,
    };
    s.extras[id] = e;
  }
  return e;
}

/**
 * A node handle: four own fields (`id`, `renderer`, `_uid`, and the lazily
 * allocated listener map inherited from EventEmitter); everything else is
 * an accessor over the store. See spec section 5.2.
 */
export class Node extends EventEmitter {
  id: number;
  readonly renderer: NodeOwner;
  private readonly _uid: number;
  /**
   * The node's element in the inspector's DOM mirror, while an inspector
   * is attached to its renderer (`@solidtv/renderer/inspector`); undefined
   * otherwise. A prototype accessor the inspector installs: no field.
   */
  declare readonly div: HTMLElement | undefined;

  constructor(renderer: NodeOwner, id: number) {
    super();
    this.renderer = renderer;
    this.id = id;
    this._uid = renderer.nodes.i32[id * I_STRIDE + I_UID]!;
    renderer.nodes.handles[id] = this;
  }

  get uid(): number {
    return this._uid;
  }
  get destroyed(): boolean {
    return this.id === NULL;
  }
  /**
   * 1.10's `node.stage`: the renderer (spec 12.2), its root included, as
   * 1.10's Stage had it (Solid's scroller reads `node.stage.root`).
   */
  get stage(): NodeOwner & { readonly root: Node } {
    return this.renderer as NodeOwner & { readonly root: Node };
  }

  // Position and size
  get x(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_X]!;
  }
  set x(v: number) {
    setF(this, F_X, v, DIRTY_LOCAL);
  }
  get y(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_Y]!;
  }
  set y(v: number) {
    setF(this, F_Y, v, DIRTY_LOCAL);
  }
  get w(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_W]!;
  }
  set w(v: number) {
    setF(this, F_W, v, DIRTY_LOCAL | DIRTY_SHADER);
  }
  get h(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_H]!;
  }
  set h(v: number) {
    setF(this, F_H, v, DIRTY_LOCAL | DIRTY_SHADER);
  }
  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  get alpha(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_ALPHA]!;
  }
  set alpha(v: number) {
    setF(this, F_ALPHA, v, DIRTY_ALPHA);
  }

  get rotation(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_ROTATION]!;
  }
  set rotation(v: number) {
    setF(this, F_ROTATION, v, DIRTY_LOCAL);
  }

  get scaleX(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_SCALE_X]!;
  }
  set scaleX(v: number) {
    setF(this, F_SCALE_X, v, DIRTY_LOCAL);
  }
  get scaleY(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_SCALE_Y]!;
  }
  set scaleY(v: number) {
    setF(this, F_SCALE_Y, v, DIRTY_LOCAL);
  }
  /**
   * Always reads `scaleX` (1.10 parity: `CoreNode.scale` returns
   * `this.scaleX` regardless of `scaleY`, main:src/core/CoreNode.ts
   * ~2158-2162).
   */
  get scale(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_SCALE_X]!;
  }
  set scale(v: number | null) {
    if (v === null) {
      return;
    }
    this.scaleX = v;
    this.scaleY = v;
  }

  get mountX(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_MOUNT_X]!;
  }
  set mountX(v: number) {
    setF(this, F_MOUNT_X, v, DIRTY_LOCAL);
  }
  get mountY(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_MOUNT_Y]!;
  }
  set mountY(v: number) {
    setF(this, F_MOUNT_Y, v, DIRTY_LOCAL);
  }
  get mount(): number {
    return this.mountX;
  }
  set mount(v: number) {
    this.mountX = v;
    this.mountY = v;
  }

  get pivotX(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_PIVOT_X]!;
  }
  set pivotX(v: number) {
    setF(this, F_PIVOT_X, v, DIRTY_LOCAL);
  }
  get pivotY(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_PIVOT_Y]!;
  }
  set pivotY(v: number) {
    setF(this, F_PIVOT_Y, v, DIRTY_LOCAL);
  }
  get pivot(): number {
    return this.pivotX;
  }
  set pivot(v: number) {
    this.pivotX = v;
    this.pivotY = v;
  }

  // Colors (RGBA). `color` reads the top-left corner.
  get color(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TL]!;
  }
  set color(v: number) {
    setC(this, I_COLOR_TL, v);
    setC(this, I_COLOR_TR, v);
    setC(this, I_COLOR_BL, v);
    setC(this, I_COLOR_BR, v);
  }
  get colorTop(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TL]!;
  }
  set colorTop(v: number) {
    setC(this, I_COLOR_TL, v);
    setC(this, I_COLOR_TR, v);
  }
  get colorBottom(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_BL]!;
  }
  set colorBottom(v: number) {
    setC(this, I_COLOR_BL, v);
    setC(this, I_COLOR_BR, v);
  }
  get colorLeft(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TL]!;
  }
  set colorLeft(v: number) {
    setC(this, I_COLOR_TL, v);
    setC(this, I_COLOR_BL, v);
  }
  get colorRight(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TR]!;
  }
  set colorRight(v: number) {
    setC(this, I_COLOR_TR, v);
    setC(this, I_COLOR_BR, v);
  }
  get colorTl(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TL]!;
  }
  set colorTl(v: number) {
    setC(this, I_COLOR_TL, v);
  }
  get colorTr(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_TR]!;
  }
  set colorTr(v: number) {
    setC(this, I_COLOR_TR, v);
  }
  get colorBl(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_BL]!;
  }
  set colorBl(v: number) {
    setC(this, I_COLOR_BL, v);
  }
  get colorBr(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_COLOR_BR]!;
  }
  set colorBr(v: number) {
    setC(this, I_COLOR_BR, v);
  }

  get placeholderColor(): number {
    return this.renderer.nodes.u32[this.id * I_STRIDE + I_PLACEHOLDER_COLOR]!;
  }
  set placeholderColor(v: number) {
    const id = this.id;
    const s = this.renderer.nodes;
    if (id === NULL) {
      return;
    }
    // Coerce before comparing/storing, like the corner colour setters
    // (setC above): a colour built with bitwise ops (e.g. `x | 0`) can be a
    // negative signed int32 that is bit-identical to the always-unsigned
    // value already stored, so comparing the raw `v` never matches and
    // marks dirty on every write of the "same" colour.
    const uv = v >>> 0;
    if (s.u32[id * I_STRIDE + I_PLACEHOLDER_COLOR] === uv) {
      return;
    }
    s.u32[id * I_STRIDE + I_PLACEHOLDER_COLOR] = uv;
    s.markDirty(id, DIRTY_COLOR | DIRTY_RENDERABLE);
  }

  // Structure
  get zIndex(): number {
    return this.renderer.nodes.f64[this.id * F_STRIDE + F_Z_INDEX]!;
  }
  set zIndex(v: number) {
    if (this.id === NULL) {
      return;
    }
    this.renderer.nodes.setZIndex(this.id, v);
  }

  get parent(): Node | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    const s = this.renderer.nodes;
    const p = s.i32[id * I_STRIDE + I_PARENT]!;
    return p === NULL ? null : (s.handles[p] as Node);
  }
  set parent(p: Node | null) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const s = this.renderer.nodes;
    const old = s.i32[id * I_STRIDE + I_PARENT]!;
    const next = p === null ? NULL : p.id;
    if (old === next) {
      return;
    }
    if (old !== NULL) {
      s.unlink(id);
      s.markDirty(old, 0);
    }
    if (next !== NULL) {
      s.appendChild(next, id);
    }
    s.markDirty(id, DIRTY_INHERITED | DIRTY_RENDERABLE);
  }

  /**
   * Make `child` a child of this node, before `before` (new in 2.0, for
   * Solid 1.7, whose draw order then follows its child order). `null`, or
   * a node that is not this node's child, appends, as setting
   * `child.parent` does; a child of this node moves, and one placed before
   * itself stays (as in the DOM). Siblings stay sorted by zIndex: where
   * `before`'s zIndex is not the child's, the child goes to the nearest
   * place that keeps them sorted. A destroyed node on either side does
   * nothing.
   */
  insertBefore(child: Node, before: Node | null): void {
    const id = this.id;
    const c = child.id;
    if (id === NULL || c === NULL) {
      return;
    }
    const s = this.renderer.nodes;
    let b = before === null ? NULL : before.id;
    if (b === c) {
      b = s.next[c]!;
    }
    if (b !== NULL && s.i32[b * I_STRIDE + I_PARENT] !== id) {
      b = NULL;
    }
    const old = s.i32[c * I_STRIDE + I_PARENT]!;
    s.unlink(c);
    s.insertBefore(id, c, b);
    if (old === id) {
      // A move among its siblings: only the draw order changed.
      s.markDirty(c, 0);
      return;
    }
    s.markDirty(old, 0);
    s.markDirty(c, DIRTY_INHERITED | DIRTY_RENDERABLE);
  }

  /**
   * The children in draw order. The array is shared: the first read after
   * the child list changes (a child added, removed or moved: insertBefore,
   * zIndex) builds it, and every read until the next change returns it, so 1.10's
   * `for (...; i < node.children.length; ...) node.children[i]` stays O(n).
   * Never mutate it. Unlike 1.10's live array, a change builds a new one
   * and leaves an array already returned as it was, so a loop over it may
   * destroy or re-parent the children it lists.
   */
  get children(): Node[] {
    const id = this.id;
    if (id === NULL) {
      return [];
    }
    const s = this.renderer.nodes;
    const cached = s.childArrays[id];
    if (cached !== null) {
      return cached as Node[];
    }
    const out: Node[] = [];
    let c = s.i32[id * I_STRIDE + I_FIRST_CHILD]!;
    while (c !== NULL) {
      out.push(s.handles[c] as Node);
      c = s.next[c]!;
    }
    s.childArrays[id] = out;
    return out;
  }

  get clipping(): ClippingValue {
    const id = this.id;
    if (id === NULL) {
      return false;
    }
    const s = this.renderer.nodes;
    const margins = s.clipMargins[id];
    if (margins !== null) {
      return margins as [number, number, number, number];
    }
    return (s.u32[id * I_STRIDE + I_STATE]! & ST_CLIPS) !== 0;
  }
  set clipping(v: ClippingValue) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const s = this.renderer.nodes;
    const clips = v !== false;
    const margins = Array.isArray(v) === true ? (v as number[]) : null;
    const state = s.u32[id * I_STRIDE + I_STATE]!;
    const wasClipping = (state & ST_CLIPS) !== 0;
    if (wasClipping === clips && s.clipMargins[id] === margins) {
      return;
    }
    s.u32[id * I_STRIDE + I_STATE] =
      clips === true ? state | ST_CLIPS : state & ~ST_CLIPS;
    s.clipMargins[id] = margins;
    s.markDirty(id, DIRTY_CLIP);
  }

  get rtl(): boolean | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    const own = this.renderer.nodes.i32[id * I_STRIDE + I_DIRECTION]!;
    if (own === DIR_INHERIT) {
      return null;
    }
    return own === DIR_RTL;
  }
  /**
   * Stores the own direction and raises DIRTY_DIRECTION: the scene pass
   * derives the resolved direction (ST_RTL) of this node and its subtree
   * at the next frame. `undefined` is inherit, as `null` is (a framework
   * undoing a style).
   */
  set rtl(v: boolean | null | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    let own = DIR_INHERIT;
    if (v === true) {
      own = DIR_RTL;
    } else if (v === false) {
      own = DIR_LTR;
    }
    const s = this.renderer.nodes;
    const i = id * I_STRIDE + I_DIRECTION;
    if (s.i32[i] === own) {
      return;
    }
    s.i32[i] = own;
    s.markDirty(id, DIRTY_DIRECTION);
  }

  get ignoreParentAlpha(): boolean {
    return (
      (this.renderer.nodes.u32[this.id * I_STRIDE + I_STATE]! &
        ST_IGNORE_PARENT_ALPHA) !==
      0
    );
  }
  set ignoreParentAlpha(v: boolean) {
    setStateBit(this, ST_IGNORE_PARENT_ALPHA, v, DIRTY_ALPHA);
  }

  get autosize(): boolean {
    return (
      (this.renderer.nodes.u32[this.id * I_STRIDE + I_STATE]! & ST_AUTOSIZE) !==
      0
    );
  }
  /**
   * Turned on, the node takes its texture's size at the next resolve
   * (ST_AUTOSIZE_DUE), as 1.10 sized it when autosize was turned on after
   * the load; otherwise only a load sizes it, so a w/h written since stays.
   */
  set autosize(v: boolean | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    // Solid assigns `undefined` to undo a state style: off, as `false`.
    const on = v === true;
    const s = this.renderer.nodes;
    const state = s.u32[id * I_STRIDE + I_STATE]!;
    if (((state & ST_AUTOSIZE) !== 0) === on) {
      return;
    }
    s.u32[id * I_STRIDE + I_STATE] =
      on === true
        ? state | ST_AUTOSIZE | ST_AUTOSIZE_DUE
        : state & ~(ST_AUTOSIZE | ST_AUTOSIZE_DUE);
    s.markDirty(id, DIRTY_TEXTURE);
  }

  /**
   * 1.10 always gave a node a `data` object (`props.data ?? {}`), so app
   * code writes into it without initializing it first (`node.data.foo = 1`).
   * A live node whose slot is still `null` gets `{}` created and stored here
   * on first read, so every later read (including the one after this write)
   * sees the same object. A destroyed handle returns `null` and never
   * allocates.
   */
  get data(): Record<string, unknown> | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    const s = this.renderer.nodes;
    let d = s.data[id] as Record<string, unknown> | null;
    if (d === null) {
      d = {};
      s.data[id] = d;
    }
    return d;
  }
  set data(v: Record<string, unknown> | null | undefined) {
    // Solid assigns `undefined` to undo a state style; treat it as `null`
    // like every other reference prop below, instead of storing `undefined`
    // and bypassing the lazy `{}` in the getter above.
    if (v === undefined) v = null;
    if (this.id !== NULL) {
      this.renderer.nodes.data[this.id] = v;
    }
  }

  // Texture inputs: setters store and mark; TextureNodes.resolveTexture
  // does the work on the node's next visit in bounds.
  get src(): string | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    return this.renderer.nodes.srcs[id]!;
  }
  set src(v: string | null | undefined) {
    // Solid assigns `undefined` to undo a state style; normalize to `null`
    // so it is never stored (the scene pass tests reference side arrays for
    // "unused", documented as `null`, not `undefined`).
    if (v === undefined) v = null;
    const id = this.id;
    const s = this.renderer.nodes;
    if (id === NULL || s.srcs[id] === v) {
      return;
    }
    s.srcs[id] = v;
    // 1.10 precedence: whichever of `src` and `texture` was written last is
    // what the node shows, and clearing `src` (null or '') cleared the
    // texture with it.
    if (v === null || v === '') {
      s.textureRefs[id] = null;
      s.u32[id * I_STRIDE + I_STATE] =
        s.u32[id * I_STRIDE + I_STATE]! & ~ST_SRC;
    } else {
      s.u32[id * I_STRIDE + I_STATE] = s.u32[id * I_STRIDE + I_STATE]! | ST_SRC;
    }
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  /**
   * The texture last assigned with `texture`, or null: a node showing `src`
   * returns the texture `src` shadows, if any (spec 14: 1.10 returned the
   * texture it built from the src).
   */
  get texture(): Texture | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    return this.renderer.nodes.textureRefs[id] as Texture | null;
  }
  set texture(v: object | null | undefined) {
    // Solid assigns `undefined` to undo a state style; normalize to `null`
    // (see the note on `src` above).
    if (v === undefined) v = null;
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const s = this.renderer.nodes;
    const state = s.u32[id * I_STRIDE + I_STATE]!;
    // Equal but shadowed by a later `src`: still a write, it wins now.
    if (s.textureRefs[id] === v && (state & ST_SRC) === 0) {
      return;
    }
    s.textureRefs[id] = v;
    s.u32[id * I_STRIDE + I_STATE] = state & ~ST_SRC;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  get textureOptions(): TextureOptions {
    const id = this.id;
    if (id === NULL) {
      return EMPTY_TEXTURE_OPTIONS;
    }
    const v = this.renderer.nodes.textureOptions[id] as TextureOptions | null;
    return v === null ? EMPTY_TEXTURE_OPTIONS : v;
  }
  set textureOptions(v: TextureOptions | null | undefined) {
    // Solid assigns `undefined` to undo a state style. Without this, `v !==
    // null && v.preload` throws on the `undefined` case below, leaving
    // ST_PRELOAD set from whatever was stored before.
    if (v === undefined) v = null;
    const id = this.id;
    if (id === NULL) {
      return;
    }
    // No identity check (1.10 had none): an object changed in place and
    // assigned again re-derives the bits, and composeWorld trusts
    // ST_CONTAIN to mean that resizeMode is there.
    const s = this.renderer.nodes;
    s.textureOptions[id] = v;
    const old = s.u32[id * I_STRIDE + I_STATE]!;
    let state = old & ~(ST_PRELOAD | ST_CONTAIN);
    if (v !== null) {
      if (v.preload === true) {
        state |= ST_PRELOAD;
      }
      const mode = v.resizeMode;
      if (mode !== undefined && mode !== null && mode.type === 'contain') {
        state |= ST_CONTAIN;
      }
    }
    s.u32[id * I_STRIDE + I_STATE] = state;
    // Cover, flips, preload and preventCleanup are texture work; contain,
    // set or cleared, also lives in composeWorld (DIRTY_LOCAL, as 1.10).
    s.markDirty(
      id,
      ((old | state) & ST_CONTAIN) !== 0
        ? DIRTY_TEXTURE | DIRTY_LOCAL
        : DIRTY_TEXTURE,
    );
    // Preload on or off: the drain adds or drops the preload want.
    if (((old | state) & ST_PRELOAD) !== 0) {
      s.queuePreload(id);
    }
  }
  get srcX(): number | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.srcX;
  }
  set srcX(v: number | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.srcX === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.srcX = v;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  get srcY(): number | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.srcY;
  }
  set srcY(v: number | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.srcY === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.srcY = v;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  get srcWidth(): number | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.srcWidth;
  }
  set srcWidth(v: number | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.srcWidth === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.srcWidth = v;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  get srcHeight(): number | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.srcHeight;
  }
  set srcHeight(v: number | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.srcHeight === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.srcHeight = v;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  /** 1.10 parity: unset reads as `null`, not `undefined` (`get imageType()
   * { return this.props.imageType || null; }`). */
  get imageType(): ImageType {
    const e = extrasOf(this, false);
    if (e === null || e.imageType === undefined) {
      return null;
    }
    return e.imageType;
  }
  set imageType(v: ImageType | undefined) {
    const id = this.id;
    if (id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.imageType === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.imageType = v;
    textureDirty(this, id, DIRTY_TEXTURE);
  }
  get componentName(): string | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.componentName;
  }
  set componentName(v: string | undefined) {
    if (this.id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.componentName === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.componentName = v;
  }
  get componentLocation(): string | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.componentLocation;
  }
  set componentLocation(v: string | undefined) {
    if (this.id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.componentLocation === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.componentLocation = v;
  }
  /**
   * Stored only: read when an image in the subtree is uploaded
   * (AtlasPages), so it marks nothing.
   */
  get atlasGroup(): string | undefined {
    const e = extrasOf(this, false);
    return e === null ? undefined : e.atlasGroup;
  }
  set atlasGroup(v: string | undefined) {
    if (this.id === NULL) {
      return;
    }
    const e = extrasOf(this, false);
    if (e !== null && e.atlasGroup === v) {
      return;
    }
    if (e === null && v === undefined) {
      return;
    }
    extrasOf(this, true)!.atlasGroup = v;
  }

  // Shader: null without one (1.10 read its shared default shader node).
  get shader(): ShaderNode | null {
    const id = this.id;
    if (id === NULL) {
      return null;
    }
    return this.renderer.nodes.shaderRefs[id] as ShaderNode | null;
  }
  set shader(v: object | null | undefined) {
    // Solid assigns `undefined` to undo a state style; normalize to `null`
    // so the scene pass's `shaderRefs[id] !== null` check does not count an
    // undone shader as still assigned (see the note on `src` above).
    if (v === undefined) v = null;
    const id = this.id;
    const s = this.renderer.nodes;
    if (id === NULL || s.shaderRefs[id] === v) {
      return;
    }
    s.shaderRefs[id] = v;
    s.markDirty(id, DIRTY_SHADER | DIRTY_RENDERABLE);
  }

  // Derived, read-only
  /**
   * Ported from 1.10 exactly (main:src/core/CoreNode.ts ~2107-2113),
   * including its `||` fallback: when the parent's own `absX` is falsy
   * (typically exactly `0`, e.g. a parent whose recursive x/w/mountX chain
   * nets to zero), 1.10 falls back to the parent's actual world-transform
   * translation (`globalTransform.tx`; here the store's `wtx`) rather than
   * treating the parent as contributing nothing. This matters because the
   * additive absX/absY formula does not account for a rotated or scaled
   * ancestor, so it can legitimately diverge from the true world position.
   */
  get absX(): number {
    const id = this.id;
    if (id === NULL) {
      return 0;
    }
    const s = this.renderer.nodes;
    const p = this.parent;
    const x = s.f64[id * F_STRIDE + F_X]!;
    const w = s.f64[id * F_STRIDE + F_W]!;
    const mountX = s.f64[id * F_STRIDE + F_MOUNT_X]!;
    let own = x - w * mountX;
    if (p !== null && (s.u32[p.id * I_STRIDE + I_STATE]! & ST_RTL) !== 0) {
      // The mirror image within the parent, as composeWorld places it.
      own = s.f64[p.id * F_STRIDE + F_W]! - x - (1 - mountX) * w;
    }
    return (
      own + (p === null ? 0 : p.absX || s.f64[p.id * F_STRIDE + F_WTX]! || 0)
    );
  }
  get absY(): number {
    const id = this.id;
    if (id === NULL) {
      return 0;
    }
    const s = this.renderer.nodes;
    const own =
      s.f64[id * F_STRIDE + F_Y]! -
      s.f64[id * F_STRIDE + F_H]! * s.f64[id * F_STRIDE + F_MOUNT_Y]!;
    const p = this.parent;
    return (
      own + (p === null ? 0 : p.absY || s.f64[p.id * F_STRIDE + F_WTY]! || 0)
    );
  }
  /** 1.10 numeric render state: 0 Init, 2 OutOfBounds, 4 InBounds, 8 InViewport. */
  get renderState(): RenderStateValue {
    const id = this.id;
    if (id === NULL) {
      return 0;
    }
    return renderStateOf(
      visibilityOf(this.renderer.nodes.u32[id * I_STRIDE + I_STATE]!),
    );
  }
  /**
   * The load state of the image the node's `src` or `texture` (whichever
   * was written last) names, read from the texture store when asked, so a
   * reader that comes after the `loaded` or `failed` event still finds the
   * outcome (spec 9.7):
   *
   * - `'none'`: no `src` (null or '') and no `texture`; also destroyed.
   * - `'loaded'`: its pixels (a SubTexture's: its sheet's) are uploaded; a
   *   node in bounds draws them from the next frame at the latest.
   * - `'failed'`: its load failed for good, after the last retry (the
   *   node's `failed` event); it stays so until the source changes.
   * - `'loading'`: anything else: queued, loading, decoded and waiting for
   *   its upload, or waiting for a retry; and not requested at all, as no
   *   load starts before a node is first in bounds (spec 9.2), and a
   *   cleanup frees the pixels nobody wants (they load again when wanted).
   *
   * It follows the source as written, at once: a new `src` reads its own
   * image's state (`'loading'` until it is there), though the node keeps
   * drawing the old one until the new one is uploaded (spec 9.4).
   */
  get imageState(): NodeImageState {
    const id = this.id;
    if (id === NULL) {
      return 'none';
    }
    return this.renderer.textureNodes.imageState(id);
  }
  /**
   * 1.10's `clippingRect`, as of the node's last visit by the walk: its own
   * clip (intersected with its ancestors') when it clips, else the nearest
   * clipping ancestor's. A copy: writing into it changes nothing. The walk
   * skips a node under a culled ancestor (item 33), so such a node reads the
   * record of its last visit, which may since have been freed or reused.
   */
  get clippingRect(): RectWithValid {
    const id = this.id;
    const rec =
      id === NULL ? 0 : this.renderer.nodes.i32[id * I_STRIDE + I_CLIP]!;
    if (rec === 0) {
      return { valid: false, x: 0, y: 0, w: 0, h: 0 };
    }
    const c = this.renderer.clips;
    return {
      valid: c.valid[rec] === 1,
      x: c.x[rec]!,
      y: c.y[rec]!,
      w: c.w[rec]!,
      h: c.h[rec]!,
    };
  }

  // Animation
  /**
   * A controller for `props` (call its `start()` to run it): the
   * controller interface of 1.10, whatever class implements it.
   */
  animate(
    props: AnimateProps,
    settings: Partial<AnimationSettings> = {},
  ): IAnimationController {
    return new Animation(this.renderer.animationManager, this, props, settings);
  }

  /**
   * Solid's transition path: one controller per prop name, reused while the
   * same settings object is passed; a different settings object stops the
   * previous controller and starts a new one.
   */
  animateProp(
    name: string,
    value: number,
    settings: Partial<AnimationSettings> = {},
  ): IAnimationController {
    const id = this.id;
    const s = this.renderer.nodes;
    let map = (id === NULL ? null : s.animations[id]) as Record<
      string,
      AnimationSlot
    > | null;
    if (map === null) {
      map = {};
      if (id !== NULL) {
        s.animations[id] = map;
      }
    }
    const existing = map[name];
    if (existing !== undefined) {
      if (existing.settings === settings) {
        const c = existing.controller;
        c.retarget(value);
        c.progress = 0;
        if (settings.adaptiveDuration === true) {
          const now = this.renderer.animationManager.clock();
          const rawElapsed = now - c.lastRunTime;
          // A clock reset (or a first call with a stale lastRunTime) must
          // never hand back a negative duration.
          const elapsed = rawElapsed < 0 ? 0 : rawElapsed;
          c.lastRunTime = now;
          const duration = settings.duration ?? c.duration;
          c.duration = elapsed < duration ? elapsed : duration;
        }
        return c.start();
      }
      existing.controller.stop();
    }
    const controller = new Animation(
      this.renderer.animationManager,
      this,
      { [name]: value },
      settings,
    );
    map[name] = { controller, settings };
    return controller.start();
  }

  destroy(): void {
    if (this.id === NULL) {
      return;
    }
    this.renderer.destroyNode(this);
  }
}
