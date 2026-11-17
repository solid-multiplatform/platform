import { premultiplyColorABGR } from '../../common/color.js';
import type { NodeStore } from '../nodes/NodeStore.js';
import type { TextState } from '../nodes/TextNode.js';
import { ST_WORLD_TRANSLATE } from '../nodes/NodeFlags.js';
import type { OpList } from '../gl/OpList.js';
import type { VertexStream } from '../gl/VertexStream.js';
import type { ShaderRegistry } from '../shaders/ShaderRegistry.js';
import { SDF_FRAGMENT, sdfVertex } from '../shaders/builtin/Sdf.js';
import { GLYPH_WORDS } from './TextLayout.js';
import {
  F_STRIDE,
  F_WA,
  F_WB,
  F_WC,
  F_WD,
  F_WORLD_ALPHA,
  F_WTX,
  F_WTY,
  I_CLIP,
  I_COLOR_TL,
  I_PM_TL,
  I_STATE,
  I_STRIDE,
} from '../nodes/NodeLayout.js';

/** Opaque white, ABGR premultiplied at alpha 1. */
const WHITE = 0xffffffff;

/**
 * Glyph quads (spec 10.3): PassHooks.emitText, run for each text node the
 * walk queued, in walk order, after the walk or before a quad with a
 * zIndex. Each glyph's four vertices are written into the frame's stream
 * from the node's world transform and the layout's glyph runs (one
 * multiply-add per coordinate for a translate-only node), every drawn frame:
 * nothing is cached between frames. A node's glyphs form one op run keyed
 * by (SDF program, atlas texture, clip record), so the glyphs of
 * consecutive cards on one atlas merge into one op whatever their size or
 * alpha. Stores only: nothing is allocated per frame.
 */
export class TextEmitter {
  private readonly nodes: NodeStore;
  private readonly stream: VertexStream;
  private readonly ops: OpList;
  private readonly shaders: ShaderRegistry;
  private readonly flush: () => void;
  /** The SDF program: -1 until the first glyph, 0 when it failed to compile. */
  private program = -1;
  /** The warm-up tried it: a failure there is not tried again until the first glyph. */
  private warmed = false;

  constructor(
    nodes: NodeStore,
    stream: VertexStream,
    ops: OpList,
    shaders: ShaderRegistry,
    flush: () => void,
  ) {
    this.nodes = nodes;
    this.stream = stream;
    this.ops = ops;
    this.shaders = shaders;
    this.flush = flush;
  }

  /**
   * The idle warm-up: compile the SDF program before the first glyph needs
   * it, once; false when it was tried already. A failure is not reported
   * and leaves it uncompiled: the first glyph compiles it again and
   * reports that.
   */
  warm(): boolean {
    if (this.warmed === true || this.program !== -1) {
      return false;
    }
    this.warmed = true;
    this.program = this.shaders.program(
      sdfVertex(this.shaders.host.viewport),
      SDF_FRAGMENT,
      null,
      'Sdf',
    );
    return true;
  }

  /**
   * Text node `id`'s glyphs, renderable (laid out, its atlas uploaded):
   * one quad each, in the node's premultiplied colour (white for colour 0,
   * as 1.10 drew `color || 0xffffffff`), with the atlas range at its size
   * as `a_extra`. A full stream is drawn between two glyphs.
   */
  emitText(id: number): void {
    let program = this.program;
    if (program === -1) {
      // Compiled on first use, as 1.10 deferred the SDF shader's compile.
      program = this.shaders.program(
        sdfVertex(this.shaders.host.viewport),
        SDF_FRAGMENT,
        'The SDF text program failed to compile; text does not draw',
        'Sdf',
      );
      this.program = program;
    }
    if (program === 0) {
      return;
    }
    const s = this.nodes;
    const o = id * I_STRIDE;
    const fo = id * F_STRIDE;
    const t = s.texts[id] as TextState;
    const layout = t.layout!;
    const texture = t.font!.rec;
    const clip = s.i32[o + I_CLIP]!;
    const color =
      s.u32[o + I_COLOR_TL] === 0
        ? premultiplyColorABGR(WHITE, s.f64[fo + F_WORLD_ALPHA]!)
        : s.u32[o + I_PM_TL]!;
    const extra = layout.distanceRange;
    const fs = layout.fontScale;
    const tx = s.f64[fo + F_WTX]!;
    const ty = s.f64[fo + F_WTY]!;
    const translate = (s.u32[o + I_STATE]! & ST_WORLD_TRANSLATE) !== 0;
    // 1.10's per-glyph transform, the font scale folded into the matrix.
    const m0 = s.f64[fo + F_WA]! * fs;
    const m1 = s.f64[fo + F_WC]! * fs;
    const m3 = s.f64[fo + F_WB]! * fs;
    const m4 = s.f64[fo + F_WD]! * fs;
    const g = layout.f32;
    const n = layout.glyphCount;
    const stream = this.stream;
    const ops = this.ops;
    const f = stream.f32;
    const u = stream.u32;
    const end = f.length;
    // The stream's cursor, kept in a local: written back before a flush,
    // which draws and resets the stream, and once after the last glyph.
    let w = stream.cursor;
    let first = stream.quadCount;
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (w >= end) {
        stream.cursor = w;
        if (run > 0) {
          ops.addRun(program, null, texture, clip, id, first, run);
        }
        this.flush();
        w = 0;
        first = 0;
        run = 0;
      }
      const o = i * GLYPH_WORDS;
      const gx1 = g[o]!;
      const gy1 = g[o + 1]!;
      const gx2 = gx1 + g[o + 2]!;
      const gy2 = gy1 + g[o + 3]!;
      const u1 = g[o + 4]!;
      const v1 = g[o + 5]!;
      const u2 = g[o + 6]!;
      const v2 = g[o + 7]!;
      let x0: number;
      let y0: number;
      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;
      let x3: number;
      let y3: number;
      if (translate === true) {
        x0 = fs * gx1 + tx;
        x1 = fs * gx2 + tx;
        y0 = fs * gy1 + ty;
        y2 = fs * gy2 + ty;
        x2 = x0;
        x3 = x1;
        y1 = y0;
        y3 = y2;
      } else {
        x0 = m0 * gx1 + m3 * gy1 + tx;
        y0 = m1 * gx1 + m4 * gy1 + ty;
        x1 = m0 * gx2 + m3 * gy1 + tx;
        y1 = m1 * gx2 + m4 * gy1 + ty;
        x2 = m0 * gx1 + m3 * gy2 + tx;
        y2 = m1 * gx1 + m4 * gy2 + ty;
        x3 = m0 * gx2 + m3 * gy2 + tx;
        y3 = m1 * gx2 + m4 * gy2 + ty;
      }
      f[w] = x0;
      f[w + 1] = y0;
      f[w + 2] = u1;
      f[w + 3] = v1;
      u[w + 4] = color;
      f[w + 5] = extra;
      f[w + 6] = x1;
      f[w + 7] = y1;
      f[w + 8] = u2;
      f[w + 9] = v1;
      u[w + 10] = color;
      f[w + 11] = extra;
      f[w + 12] = x2;
      f[w + 13] = y2;
      f[w + 14] = u1;
      f[w + 15] = v2;
      u[w + 16] = color;
      f[w + 17] = extra;
      f[w + 18] = x3;
      f[w + 19] = y3;
      f[w + 20] = u2;
      f[w + 21] = v2;
      u[w + 22] = color;
      f[w + 23] = extra;
      w += 24;
      run++;
    }
    stream.cursor = w;
    if (run > 0) {
      ops.addRun(program, null, texture, clip, id, first, run);
    }
  }
}
