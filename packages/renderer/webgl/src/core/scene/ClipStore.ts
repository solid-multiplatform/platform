import { NULL } from '../nodes/NodeFlags.js';

function growF64(a: Float64Array | undefined, n: number): Float64Array {
  const b = new Float64Array(n);
  if (a !== undefined) b.set(a);
  return b;
}
function growI32(a: Int32Array | undefined, n: number): Int32Array {
  const b = new Int32Array(n);
  if (a !== undefined) b.set(a);
  return b;
}
function growU8(a: Uint8Array | undefined, n: number): Uint8Array {
  const b = new Uint8Array(n);
  if (a !== undefined) b.set(a);
  return b;
}

/**
 * Clip records: a logical rect plus its device-pixel scissor box (bottom-left
 * origin), derived once when the rect is written. Record 0 is "no clip".
 * `owner` holds the node id that allocated each record (-1 when free), so a
 * node can tell its own record from the one it shares with its parent.
 *
 * `alloc()` may grow the store, which replaces every typed array; never
 * cache one of this class's typed-array fields across a call to `alloc`.
 */
export class ClipStore {
  capacity = 0;
  x!: Float64Array;
  y!: Float64Array;
  w!: Float64Array;
  h!: Float64Array;
  sx!: Int32Array;
  sy!: Int32Array;
  sw!: Int32Array;
  sh!: Int32Array;
  valid!: Uint8Array;
  owner!: Int32Array;

  private freeHead = NULL;
  private nextFree!: Int32Array;

  constructor(capacity = 64) {
    this.resize(capacity < 2 ? 2 : capacity);
  }

  private resize(capacity: number): void {
    const old = this.capacity;
    this.x = growF64(this.x, capacity);
    this.y = growF64(this.y, capacity);
    this.w = growF64(this.w, capacity);
    this.h = growF64(this.h, capacity);
    this.sx = growI32(this.sx, capacity);
    this.sy = growI32(this.sy, capacity);
    this.sw = growI32(this.sw, capacity);
    this.sh = growI32(this.sh, capacity);
    this.valid = growU8(this.valid, capacity);
    this.owner = growI32(this.owner, capacity);
    this.nextFree = growI32(this.nextFree, capacity);
    // Slot 0 is reserved: never on the free list, never owned.
    const first = old === 0 ? 1 : old;
    for (let i = first; i < capacity - 1; i++) {
      this.nextFree[i] = i + 1;
    }
    this.nextFree[capacity - 1] = this.freeHead;
    this.freeHead = first;
    for (let i = first; i < capacity; i++) {
      this.owner[i] = NULL;
    }
    if (old === 0) {
      this.owner[0] = NULL;
    }
    this.capacity = capacity;
  }

  /** Take a record for node `owner`; it starts invalid until `set`. */
  alloc(owner: number): number {
    if (this.freeHead === NULL) {
      this.resize(this.capacity * 2);
    }
    const id = this.freeHead;
    this.freeHead = this.nextFree[id]!;
    this.valid[id] = 0;
    this.owner[id] = owner;
    return id;
  }

  free(id: number): void {
    this.valid[id] = 0;
    this.owner[id] = NULL;
    this.nextFree[id] = this.freeHead;
    this.freeHead = id;
  }

  /** Write a logical rect and derive its scissor box. Marks the record valid. */
  set(
    id: number,
    x: number,
    y: number,
    w: number,
    h: number,
    pixelRatio: number,
    canvasH: number,
  ): void {
    this.x[id] = x;
    this.y[id] = y;
    this.w[id] = w;
    this.h[id] = h;
    this.valid[id] = 1;
    this.updateScissor(id, pixelRatio, canvasH);
  }

  invalidate(id: number): void {
    this.valid[id] = 0;
  }

  /**
   * Replace record `id` with its intersection with record `other` (both must
   * be valid). A non-overlapping pair becomes the empty rect, still valid,
   * exactly as 1.10's intersectRect.
   */
  intersect(
    id: number,
    other: number,
    pixelRatio: number,
    canvasH: number,
  ): void {
    const ax = this.x[id]!;
    const ay = this.y[id]!;
    const bx = this.x[other]!;
    const by = this.y[other]!;
    const x = ax > bx ? ax : bx;
    const y = ay > by ? ay : by;
    const ar = ax + this.w[id]!;
    const br = bx + this.w[other]!;
    const ab = ay + this.h[id]!;
    const bb = by + this.h[other]!;
    const w = (ar < br ? ar : br) - x;
    const h = (ab < bb ? ab : bb) - y;
    if (w > 0 && h > 0) {
      this.x[id] = x;
      this.y[id] = y;
      this.w[id] = w;
      this.h[id] = h;
    } else {
      this.x[id] = 0;
      this.y[id] = 0;
      this.w[id] = 0;
      this.h[id] = 0;
    }
    this.updateScissor(id, pixelRatio, canvasH);
  }

  private updateScissor(id: number, pixelRatio: number, canvasH: number): void {
    const sh = Math.round(this.h[id]! * pixelRatio);
    this.sx[id] = Math.round(this.x[id]! * pixelRatio);
    this.sw[id] = Math.round(this.w[id]! * pixelRatio);
    this.sh[id] = sh;
    this.sy[id] = Math.round(canvasH - sh - this.y[id]! * pixelRatio);
  }
}
