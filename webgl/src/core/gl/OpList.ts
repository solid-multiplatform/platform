function growI32(a: Int32Array, n: number): Int32Array {
  const b = new Int32Array(n);
  b.set(a);
  return b;
}

/**
 * Batched draw ops in parallel arrays, reset every frame. An op is a run of
 * consecutive quads drawn with one program, one params block, one texture and
 * one clip record. See roadmap section 4.4.
 */
export class OpList {
  program: Int32Array;
  texture: Int32Array;
  clip: Int32Array;
  node: Int32Array;
  start: Int32Array;
  count: Int32Array;
  params: (Float32Array | null)[];
  length = 0;

  constructor(capacity = 256) {
    capacity = capacity < 1 ? 1 : capacity;
    this.program = new Int32Array(capacity);
    this.texture = new Int32Array(capacity);
    this.clip = new Int32Array(capacity);
    this.node = new Int32Array(capacity);
    this.start = new Int32Array(capacity);
    this.count = new Int32Array(capacity);
    // Array.prototype.fill arrived in Chrome 45; push in a loop keeps the
    // array packed the same way grow() does, with no reliance on it.
    this.params = [];
    for (let i = 0; i < capacity; i++) {
      this.params.push(null);
    }
  }

  /**
   * Add quad `quad` (its index in the VertexStream) drawn with the given keys.
   * Extends the last op when every key matches, `perOpMatch` is true and
   * `quad` directly follows the op's last quad. Quads and glyphs land in this
   * one list in stream order (text is deferred in the scene pass, spec 7.3),
   * so the adjacency test only guards against a writer that skips a quad.
   */
  add(
    program: number,
    params: Float32Array | null,
    texture: number,
    clip: number,
    node: number,
    quad: number,
    perOpMatch: boolean,
  ): void {
    const i = this.length - 1;
    if (
      i >= 0 &&
      perOpMatch === true &&
      this.start[i]! + this.count[i]! === quad &&
      this.program[i] === program &&
      this.params[i] === params &&
      this.texture[i] === texture &&
      this.clip[i] === clip
    ) {
      this.count[i] = this.count[i]! + 1;
      return;
    }
    const n = this.length;
    if (n === this.program.length) {
      this.grow();
    }
    this.program[n] = program;
    this.params[n] = params;
    this.texture[n] = texture;
    this.clip[n] = clip;
    this.node[n] = node;
    this.start[n] = quad;
    this.count[n] = 1;
    this.length = n + 1;
  }

  /**
   * Add `count` consecutive quads from `quad` drawn with the same keys (a
   * text node's glyphs, which no per-op uniform splits), extending the
   * last op as add() would.
   */
  addRun(
    program: number,
    params: Float32Array | null,
    texture: number,
    clip: number,
    node: number,
    quad: number,
    count: number,
  ): void {
    const i = this.length - 1;
    if (
      i >= 0 &&
      this.start[i]! + this.count[i]! === quad &&
      this.program[i] === program &&
      this.params[i] === params &&
      this.texture[i] === texture &&
      this.clip[i] === clip
    ) {
      this.count[i] = this.count[i]! + count;
      return;
    }
    const n = this.length;
    if (n === this.program.length) {
      this.grow();
    }
    this.program[n] = program;
    this.params[n] = params;
    this.texture[n] = texture;
    this.clip[n] = clip;
    this.node[n] = node;
    this.start[n] = quad;
    this.count[n] = count;
    this.length = n + 1;
  }

  reset(): void {
    // Drop params references so blocks can be collected; the typed arrays are
    // overwritten as ops are added.
    const params = this.params;
    for (let i = 0, n = this.length; i < n; i++) {
      params[i] = null;
    }
    this.length = 0;
  }

  private grow(): void {
    const n = this.program.length * 2;
    this.program = growI32(this.program, n);
    this.texture = growI32(this.texture, n);
    this.clip = growI32(this.clip, n);
    this.node = growI32(this.node, n);
    this.start = growI32(this.start, n);
    this.count = growI32(this.count, n);
    for (let i = this.params.length; i < n; i++) {
      this.params.push(null);
    }
  }
}
