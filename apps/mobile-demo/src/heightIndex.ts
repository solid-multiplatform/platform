/**
 * A Fenwick (binary indexed) tree of item heights.
 *
 * The chat needs four operations while it scrolls and as messages measure:
 * total height, the offset of item `i`, the item at an offset, and updating
 * one item's height. Every one is O(log n) and none scans the transcript.
 *
 * The tree is rebuilt in O(n) when constructed and when an append outgrows
 * the arrays (doubling, so the cost is amortised). Updates walk to the array
 * capacity, not the current item count: a later append needs the ancestors
 * that earlier updates already filled in.
 * Heights are floating point (a message's laid-out height), so comparisons
 * use a small epsilon.
 */
const EPSILON = 1e-9;

/** Builds the tree in O(n) from the first `count` values of `values`. */
function buildTree(values: Float64Array, count: number): Float64Array {
  const tree = new Float64Array(values.length + 1);
  for (let i = 1; i <= count; i++) {
    tree[i] = tree[i]! + values[i - 1]!;
    const parent = i + (i & -i);
    if (parent <= values.length) tree[parent] = tree[parent]! + tree[i]!;
  }
  return tree;
}

export class HeightIndex {
  private tree: Float64Array;
  private values: Float64Array;
  private count = 0;

  constructor(values: readonly number[] = []) {
    let capacity = 1;
    while (capacity < values.length) capacity <<= 1;
    this.values = new Float64Array(capacity);
    this.count = values.length;
    for (let i = 0; i < values.length; i++) this.values[i] = values[i]!;
    this.tree = buildTree(this.values, this.count);
  }

  get length(): number {
    return this.count;
  }

  /** Height of item `index`. */
  get(index: number): number {
    if (index < 0 || index >= this.count) return 0;
    return this.values[index]!;
  }

  /** Appends an item and returns its index. */
  append(height: number): number {
    if (this.count === this.values.length) this.grow();
    const index = this.count++;
    this.values[index] = height;
    for (let i = index + 1; i <= this.values.length; i += i & -i) {
      this.tree[i] = this.tree[i]! + height;
    }
    return index;
  }

  /** Sets one item's height; returns whether it changed. */
  set(index: number, height: number): boolean {
    if (index < 0 || index >= this.count) return false;
    const delta = height - this.values[index]!;
    if (Math.abs(delta) <= EPSILON) return false;
    this.values[index] = height;
    for (let i = index + 1; i <= this.values.length; i += i & -i) {
      this.tree[i] = this.tree[i]! + delta;
    }
    return true;
  }

  /** Sum of every item's height. */
  total(): number {
    return this.offsetOf(this.count);
  }

  /** Sum of the heights before item `index`. */
  offsetOf(index: number): number {
    let sum = 0;
    for (let i = Math.min(index, this.count); i > 0; i -= i & -i) {
      sum += this.tree[i]!;
    }
    return sum;
  }

  /**
   * The last item whose top is at or above `offset`; clamped to the first
   * and last item. An offset below the first top returns 0, and an offset
   * past the end returns the last item.
   */
  indexAt(offset: number): number {
    if (this.count === 0) return 0;
    if (offset <= 0) return 0;
    let bit = 1;
    while (bit << 1 <= this.count) bit <<= 1;
    let position = 0;
    let remaining = offset;
    for (; bit > 0; bit >>= 1) {
      const next = position + bit;
      if (next <= this.count && this.tree[next]! <= remaining + EPSILON) {
        position = next;
        remaining -= this.tree[next]!;
      }
    }
    return Math.min(position, this.count - 1);
  }

  private grow(): void {
    const capacity = Math.max(1, this.values.length * 2);
    const values = new Float64Array(capacity);
    values.set(this.values);
    this.values = values;
    this.tree = buildTree(values, this.count);
  }
}
