import type { Renderer } from '../Renderer.js';
import type { GlBackend } from '../core/gl/GlBackend.js';
import type { OpList } from '../core/gl/OpList.js';
import { WORDS_PER_QUAD, type VertexStream } from '../core/gl/VertexStream.js';
import type { ClipStore } from '../core/scene/ClipStore.js';
import type { NodeExtras } from '../core/nodes/Node.js';
import type { TextState } from '../core/nodes/TextNode.js';
import { NULL, ST_TEXT } from '../core/nodes/NodeFlags.js';
import {
  F_STRIDE,
  F_Z_INDEX,
  I_COLOR_BL,
  I_COLOR_BR,
  I_COLOR_TL,
  I_COLOR_TR,
  I_FIRST_CHILD,
  I_PARENT,
  I_SOURCE_TEXTURE,
  I_STATE,
  I_STRIDE,
  I_UID,
} from '../core/nodes/NodeLayout.js';
import { KIND_SUB } from '../core/textures/TextureStore.js';

/** What `auditFrame` takes; every key has a default. */
export interface FrameAuditOptions {
  /**
   * The overdraw grid's cell size, in logical px: a cell counts a quad
   * when the quad covers its centre.
   *
   * @defaultValue 8
   */
  cellSize: number;
  /**
   * A quad covering at least this share of the viewport (after its clip)
   * is listed as a full-screen layer.
   *
   * @defaultValue 0.9
   */
  fullScreen: number;
}

/**
 * Why an op did not extend the one before it: a key that differs (all of
 * them, in this order), `perOp` when every key matched and a per-op
 * uniform split them (`perOpMatch`), or `chunk` for the first op of a
 * chunk after a full stream was flushed.
 */
export type BatchKey =
  | 'program'
  | 'params'
  | 'texture'
  | 'clip'
  | 'perOp'
  | 'chunk';

/** A node, named so that a person can find it. */
export interface AuditNode {
  /** Store slot (`node.id`). */
  id: number;
  /** `node.uid`, as the DOM inspector keys its elements. */
  uid: number;
  /**
   * The path from the root, one `name[childIndex]` per level (the
   * componentName, else `node` or `text`), then `#uid`, the text, the
   * image (`src=`, or `sub=` for a SubTexture of that sheet) and `data`.
   */
  label: string;
  /** The path without child indices: what the copies of a component share. */
  path: string;
  /** `data`'s strings, numbers and booleans (the inspector's data-* attributes). */
  data: Record<string, string | number | boolean> | null;
}

/**
 * The texture record an op binds (a SubTexture's quads bind their sheet's).
 * Id 0, kind `none`, is no record: the backend's white texture, which a
 * colour quad draws with, and so does an image not uploaded yet.
 */
export interface AuditTexture {
  id: number;
  kind: 'none' | 'image' | 'color' | 'noise' | 'subTexture';
  src: string | null;
  w: number;
  h: number;
}

/** A clip record's logical rect. */
export interface AuditClip {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One drawn op: one drawElements. */
export interface AuditOp {
  index: number;
  /** The chunk it was drawn in: 0, or more when a full stream flushed mid-walk. */
  chunk: number;
  /** The program's name: `Default`, `Sdf`, or the shader type's. */
  program: string;
  /** Equal numbers are the same params block (one batch key); null for none. */
  params: number | null;
  texture: AuditTexture;
  clip: AuditClip | null;
  quads: number;
  /** The node of its first quad (`OpList.node`): the one that started it. */
  node: AuditNode;
  /** Its quads are glyphs. */
  text: boolean;
  /** Null for the frame's first op. */
  break: BatchKey[] | null;
  /**
   * GL calls it issued, its drawElements included: measured with the
   * context spy (`glCallsMeasured`), else estimated from the keys that
   * changed (per-op uniforms not counted).
   */
  glCalls: number;
}

/** A quad that covers (nearly) the whole viewport: a full pass of fill. */
export interface AuditLayer {
  op: number;
  node: AuditNode;
  /** The share of the viewport it covers, 0 to 1. */
  coverage: number;
}

/**
 * The emitted quads' bounding rects (after their clip) rasterized into a
 * grid of `cellSize` px cells: how many quads each cell is shaded by. A
 * grown quad (a border or shadow outside the node) counts its node's rect
 * only, so this is a lower bound there.
 */
export interface AuditOverdraw {
  cellSize: number;
  cols: number;
  rows: number;
  /** Layers per cell over the viewport: the frame's fill in screens. */
  mean: number;
  max: number;
  fullScreen: AuditLayer[];
}

export type FindingKind =
  | 'transparent-shader'
  | 'ztext-flush'
  | 'split-run'
  | 'separate-textures';

/**
 * Batch breaks a scene change could avoid, grouped by kind, culprit path
 * and detail. `glCalls` is what merging would save: the culprit op's calls
 * plus, when it splits a run, those of the op that restarts the run.
 */
export interface AuditFinding {
  kind: FindingKind;
  detail: string;
  /** The culprits' path without child indices. */
  path: string;
  count: number;
  glCalls: number;
  /** The culprit ops, by index. */
  ops: number[];
  /** The first culprit's label. */
  example: string;
}

/** One drawn frame: what it drew, and why it batched the way it did. */
export interface FrameAuditReport {
  /** The frame's time (`renderer.currentFrameTime`). */
  time: number;
  viewport: { w: number; h: number; pixelRatio: number };
  /** Draws: 1, plus one per full stream flushed mid-walk. */
  chunks: number;
  /** Scene walks of the frame's update (re-walks for mid-frame writes). */
  walks: number;
  /** The renderer's count of the frame's ops, as telemetry's `renderUpdate` reports it. */
  renderOps: number;
  /** Quads drawn, glyphs included. */
  quads: number;
  /** Vertex bytes written for upload (the stream's cursor x 4, per chunk). */
  uploadBytes: number;
  scene: {
    visited: number;
    updated: number;
    emitted: number;
    textEmitted: number;
  };
  /** GL calls by method during the draw, from the context spy; null without `enableContextSpy`. */
  glCalls: Record<string, number> | null;
  /** The ops' `glCalls` were measured (the context spy is on), not estimated. */
  glCallsMeasured: boolean;
  /** Ops by the first key that broke them from the op before. */
  breaks: Record<BatchKey, number>;
  overdraw: AuditOverdraw;
  /** Most GL calls first. */
  findings: AuditFinding[];
  ops: AuditOp[];
}

const DEFAULT_OPTIONS: FrameAuditOptions = { cellSize: 8, fullScreen: 0.9 };

const KIND_NAMES: AuditTexture['kind'][] = [
  'image',
  'color',
  'noise',
  'subTexture',
];

const NO_TEXTURE: AuditTexture = {
  id: 0,
  kind: 'none',
  src: null,
  w: 1,
  h: 1,
};

const FIXES: Record<FindingKind, string> = {
  'transparent-shader':
    'drop the shader while the colour is transparent (it still draws a quad), unless it draws a border or shadow',
  'ztext-flush':
    'drop the zIndex where the node need not cover text: it draws the text queued before it early',
  'split-run':
    'move it out of the run in the tree (emit order is tree order), or give it the run keys',
  'separate-textures':
    'put these images in one sheet (SubTexture), so neighbours share a texture',
};

/** One capture at a time per renderer: a second call shares the first's. */
const pending = new WeakMap<Renderer, Promise<FrameAuditReport>>();

/**
 * Capture the next drawn frame (a frame is requested, so a static scene
 * draws one): its ops as drawn, which key broke each batch, GL calls (by
 * method with `enableContextSpy`), upload bytes, scene counters, overdraw
 * and the breaks a scene change could avoid. A development tool: it wraps
 * the backend's frame start and draw, the op list's adds and, with the
 * spy, the context's upload and draw, for that one frame only, so a
 * renderer that never calls it pays nothing. The capture is built inside
 * the frame, which is slower for it.
 */
export function auditFrame(
  renderer: Renderer,
  options: Partial<FrameAuditOptions> = {},
): Promise<FrameAuditReport> {
  const current = pending.get(renderer);
  if (current !== undefined) {
    return current;
  }
  const settings: FrameAuditOptions = {
    cellSize: options.cellSize ?? DEFAULT_OPTIONS.cellSize,
    fullScreen: options.fullScreen ?? DEFAULT_OPTIONS.fullScreen,
  };
  const promise = new Promise<FrameAuditReport>((resolve) => {
    new FrameCapture(renderer, settings, (report) => {
      pending.delete(renderer);
      resolve(report);
    }).install();
  });
  pending.set(renderer, promise);
  renderer.requestRender();
  return promise;
}

/** The report as console lines: totals, breaks, overdraw, then the findings. */
export function formatFrameAudit(report: FrameAuditReport, top = 10): string {
  const lines: string[] = [];
  const kb = (report.uploadBytes / 1024).toFixed(1);
  lines.push(
    `Frame audit: ${report.ops.length} ops in ${report.chunks} chunk(s) (renderOps ${report.renderOps}), ` +
      `${report.quads} quads, ${kb} kB uploaded, ${report.walks} walk(s)`,
  );
  const sc = report.scene;
  lines.push(
    `Scene: ${sc.visited} visited, ${sc.updated} updated, ${sc.emitted} emitted, ${sc.textEmitted} of them text`,
  );
  const gl = report.glCalls;
  if (gl === null) {
    lines.push(
      'GL calls by method: off (construct the renderer with enableContextSpy: true)',
    );
  } else {
    const names: string[] = [];
    let total = 0;
    for (const name in gl) {
      names.push(name);
      total += gl[name]!;
    }
    names.sort((a, b) => gl[b]! - gl[a]!);
    const parts: string[] = [];
    for (let i = 0; i < names.length; i++) {
      parts.push(`${names[i]!} ${gl[names[i]!]!}`);
    }
    lines.push(`GL calls in the draw: ${total} (${parts.join(', ')})`);
  }
  const b = report.breaks;
  lines.push(
    `Batch breaks: program ${b.program}, params ${b.params}, texture ${b.texture}, ` +
      `clip ${b.clip}, per-op ${b.perOp}, chunk ${b.chunk}`,
  );
  const od = report.overdraw;
  lines.push(
    `Overdraw (${od.cellSize} px cells): mean ${od.mean} layers, max ${od.max}; ` +
      `${od.fullScreen.length} full-screen layer(s)`,
  );
  for (let i = 0; i < od.fullScreen.length; i++) {
    const layer = od.fullScreen[i]!;
    const op = report.ops[layer.op]!;
    const t = op.texture;
    const texture =
      t.kind === 'none'
        ? 'no texture'
        : t.src === null
        ? t.kind
        : baseName(t.src);
    lines.push(
      `  ${Math.round(layer.coverage * 100)}%: op ${layer.op} (${
        op.program
      }, ${texture}) ${layer.node.label}`,
    );
  }
  const findings = report.findings;
  if (findings.length === 0) {
    lines.push('Avoidable breaks: none found');
    return lines.join('\n');
  }
  lines.push(
    `Avoidable breaks, most GL calls first (${
      report.glCallsMeasured === true ? 'measured' : 'estimated'
    }):`,
  );
  const n = findings.length < top ? findings.length : top;
  for (let i = 0; i < n; i++) {
    const f = findings[i]!;
    lines.push(
      `  ${f.glCalls} calls  ${f.kind} x${f.count}: ${f.detail} at ${f.path}`,
    );
    lines.push(`      e.g. ${f.example}`);
    lines.push(`      fix: ${FIXES[f.kind]}`);
  }
  if (findings.length > n) {
    lines.push(`  ... ${findings.length - n} more in report.findings`);
  }
  return lines.join('\n');
}

/** Log `formatFrameAudit(report)` to the console. */
export function printFrameAudit(report: FrameAuditReport, top = 10): void {
  console.log(formatFrameAudit(report, top));
}

/** Calls counted so far, every method. */
function callTotal(data: Record<string, number>): number {
  let total = 0;
  for (const name in data) {
    total += data[name]!;
  }
  return total;
}

/** The last path segment of a URL, a data URL shortened. */
function baseName(src: string): string {
  if (src.substring(0, 5) === 'data:') {
    return 'data:...';
  }
  const slash = src.lastIndexOf('/');
  const name = slash < 0 ? src : src.substring(slash + 1);
  return name.length > 40 ? `${name.substring(0, 40)}...` : name;
}

function sameKeys(
  a: number,
  b: number,
  program: number[],
  params: (Float32Array | null)[],
  texture: number[],
  clip: number[],
): boolean {
  return (
    program[a] === program[b] &&
    params[a] === params[b] &&
    texture[a] === texture[b] &&
    clip[a] === clip[b]
  );
}

/** A captured frame's raw data: its ops in draw order, and its quads' cover. */
interface Captured {
  program: number[];
  params: (Float32Array | null)[];
  texture: number[];
  clip: number[];
  clipRect: (AuditClip | null)[];
  node: number[];
  count: number[];
  chunkOf: number[];
  /** Measured GL calls per op (with the spy). */
  calls: number[];
  /** GL calls by method over the frame's draws (with the spy). */
  glTotals: Record<string, number>;
  cols: number;
  rows: number;
  /** Quads shading each cell, row-major. */
  layers: Uint16Array;
  fullScreen: { op: number; node: number; coverage: number }[];
  chunks: number;
  quads: number;
  uploadBytes: number;
}

/** One capture: the wrappers, then the frame's raw data. */
class FrameCapture {
  private readonly r: Renderer;
  private readonly options: FrameAuditOptions;
  private readonly done: (report: FrameAuditReport) => void;
  /** The node of each quad of the chunk being built (from the op list's adds). */
  private readonly quadNodes: Int32Array;
  private readonly d: Captured;
  /** beginFrame was seen: draws before it are not this capture's. */
  private armed = false;
  /** The spy's call total after the chunk's upload, then after each op. */
  private baseline = 0;
  private restore: (() => void)[] = [];

  constructor(
    renderer: Renderer,
    options: FrameAuditOptions,
    done: (report: FrameAuditReport) => void,
  ) {
    this.r = renderer;
    this.options = options;
    this.done = done;
    this.quadNodes = new Int32Array(renderer.stream.capacityQuads);
    const cols = Math.ceil(renderer.view.w / options.cellSize);
    const rows = Math.ceil(renderer.view.h / options.cellSize);
    this.d = {
      program: [],
      params: [],
      texture: [],
      clip: [],
      clipRect: [],
      node: [],
      count: [],
      chunkOf: [],
      calls: [],
      glTotals: {},
      cols,
      rows,
      layers: new Uint16Array(cols * rows),
      fullScreen: [],
      chunks: 0,
      quads: 0,
      uploadBytes: 0,
    };
  }

  install(): void {
    const backend = this.r.backend;
    const ops = this.r.ops;
    const beginFrame = backend.beginFrame;
    backend.beginFrame = (): void => {
      this.reset();
      beginFrame.call(backend);
    };
    const draw = backend.draw;
    backend.draw = (stream, list, clips): void => {
      this.draw(stream, list, clips, draw);
    };
    const add = ops.add;
    ops.add = (
      program,
      params,
      texture,
      clip,
      node,
      quad,
      perOpMatch,
    ): void => {
      this.quadNodes[quad] = node;
      add.call(ops, program, params, texture, clip, node, quad, perOpMatch);
    };
    const addRun = ops.addRun;
    ops.addRun = (program, params, texture, clip, node, quad, count): void => {
      const quadNodes = this.quadNodes;
      for (let q = quad, end = quad + count; q < end; q++) {
        quadNodes[q] = node;
      }
      addRun.call(ops, program, params, texture, clip, node, quad, count);
    };
    this.restore.push(() => {
      backend.beginFrame = beginFrame;
      backend.draw = draw;
      ops.add = add;
      ops.addRun = addRun;
    });
    const spy = backend.spy;
    if (spy === null) {
      return;
    }
    // Each op's calls: the spy's count between the end of the op before
    // (or the chunk's upload) and the end of its drawElements.
    const ctx = backend.ctx;
    const upload = ctx.uploadVertices;
    ctx.uploadVertices = (buffer, data): void => {
      upload.call(ctx, buffer, data);
      this.baseline = callTotal(spy.data);
    };
    const drawQuads = ctx.drawQuads;
    ctx.drawQuads = (start, count): void => {
      drawQuads.call(ctx, start, count);
      const total = callTotal(spy.data);
      this.d.calls.push(total - this.baseline);
      this.baseline = total;
    };
    this.restore.push(() => {
      ctx.uploadVertices = upload;
      ctx.drawQuads = drawQuads;
    });
  }

  private reset(): void {
    this.armed = true;
    const d = this.d;
    d.program.length = 0;
    d.params.length = 0;
    d.texture.length = 0;
    d.clip.length = 0;
    d.clipRect.length = 0;
    d.node.length = 0;
    d.count.length = 0;
    d.chunkOf.length = 0;
    d.calls.length = 0;
    d.fullScreen.length = 0;
    d.chunks = 0;
    d.quads = 0;
    d.uploadBytes = 0;
    const totals = d.glTotals;
    for (const name in totals) {
      totals[name] = 0;
    }
    const layers = d.layers;
    for (let i = 0; i < layers.length; i++) {
      layers[i] = 0;
    }
  }

  private draw(
    stream: VertexStream,
    ops: OpList,
    clips: ClipStore,
    draw: GlBackend['draw'],
  ): void {
    const r = this.r;
    const backend = r.backend;
    if (this.armed === false) {
      draw.call(backend, stream, ops, clips);
      return;
    }
    // A mid-walk flush draws with `flushes` already counted; the frame's
    // last draw comes after update(), with every flush drawn.
    const d = this.d;
    const last = r.flushes === d.chunks;
    this.record(stream, ops, clips);
    const spy = backend.spy;
    const before: Record<string, number> = {};
    if (spy !== null) {
      const data = spy.data;
      for (const name in data) {
        before[name] = data[name]!;
      }
    }
    draw.call(backend, stream, ops, clips);
    if (spy !== null) {
      const data = spy.data;
      const totals = d.glTotals;
      for (const name in data) {
        const delta = data[name]! - (before[name] ?? 0);
        if (delta > 0) {
          totals[name] = (totals[name] ?? 0) + delta;
        }
      }
    }
    d.chunks++;
    if (last === true) {
      this.finish();
    }
  }

  /** The chunk's ops, and its quads into the overdraw grid. */
  private record(stream: VertexStream, ops: OpList, clips: ClipStore): void {
    const d = this.d;
    d.uploadBytes += stream.cursor * 4;
    d.quads += stream.quadCount;
    const quadNodes = this.quadNodes;
    for (let i = 0, n = ops.length; i < n; i++) {
      const index = d.program.length;
      const clip = ops.clip[i]!;
      // As GlBackend.draw: an invalid record does not scissor.
      const rect: AuditClip | null =
        clip !== 0 && clips.valid[clip] === 1
          ? {
              id: clip,
              x: clips.x[clip]!,
              y: clips.y[clip]!,
              w: clips.w[clip]!,
              h: clips.h[clip]!,
            }
          : null;
      d.program.push(ops.program[i]!);
      d.params.push(ops.params[i]!);
      d.texture.push(ops.texture[i]!);
      d.clip.push(clip);
      d.clipRect.push(rect);
      d.node.push(ops.node[i]!);
      d.count.push(ops.count[i]!);
      d.chunkOf.push(d.chunks);
      const start = ops.start[i]!;
      for (let q = start, end = start + ops.count[i]!; q < end; q++) {
        this.rasterize(stream.f32, q, rect, index, quadNodes[q]!);
      }
    }
  }

  /** Count quad `q`'s bounding rect, clipped, in every cell whose centre it covers. */
  private rasterize(
    f: Float32Array,
    q: number,
    clip: AuditClip | null,
    op: number,
    node: number,
  ): void {
    const o = q * WORDS_PER_QUAD;
    // The corners' x and y: words 0 and 1 of each six-word vertex.
    let x0 = Math.min(f[o]!, f[o + 6]!, f[o + 12]!, f[o + 18]!);
    let x1 = Math.max(f[o]!, f[o + 6]!, f[o + 12]!, f[o + 18]!);
    let y0 = Math.min(f[o + 1]!, f[o + 7]!, f[o + 13]!, f[o + 19]!);
    let y1 = Math.max(f[o + 1]!, f[o + 7]!, f[o + 13]!, f[o + 19]!);
    const view = this.r.view;
    let cx0 = 0;
    let cy0 = 0;
    let cx1 = view.w;
    let cy1 = view.h;
    if (clip !== null) {
      cx0 = Math.max(cx0, clip.x);
      cy0 = Math.max(cy0, clip.y);
      cx1 = Math.min(cx1, clip.x + clip.w);
      cy1 = Math.min(cy1, clip.y + clip.h);
    }
    x0 = Math.max(x0, cx0);
    y0 = Math.max(y0, cy0);
    x1 = Math.min(x1, cx1);
    y1 = Math.min(y1, cy1);
    if (x1 <= x0 || y1 <= y0) {
      return;
    }
    const d = this.d;
    const coverage = ((x1 - x0) * (y1 - y0)) / (view.w * view.h);
    if (coverage >= this.options.fullScreen) {
      d.fullScreen.push({ op, node, coverage });
    }
    const cell = this.options.cellSize;
    const cols = d.cols;
    // Cell c's centre is (c + 0.5) * cell: covered when in [x0, x1).
    const c0 = Math.max(0, Math.ceil(x0 / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cell - 0.5) - 1);
    const r0 = Math.max(0, Math.ceil(y0 / cell - 0.5));
    const r1 = Math.min(d.rows - 1, Math.ceil(y1 / cell - 0.5) - 1);
    const layers = d.layers;
    for (let row = r0; row <= r1; row++) {
      for (let c = c0, i = row * cols + c0; c <= c1; c++, i++) {
        layers[i] = layers[i]! + 1;
      }
    }
  }

  private finish(): void {
    const restore = this.restore;
    for (let i = 0; i < restore.length; i++) {
      restore[i]!();
    }
    this.restore = [];
    this.done(new ReportBuilder(this.r, this.d, this.options).build());
  }
}

/** Turns a capture's raw data into the report, naming nodes and textures. */
class ReportBuilder {
  private readonly r: Renderer;
  private readonly d: Captured;
  private readonly options: FrameAuditOptions;
  private readonly nodes = new Map<number, AuditNode>();
  private readonly textures = new Map<number, AuditTexture>();

  constructor(
    renderer: Renderer,
    captured: Captured,
    options: FrameAuditOptions,
  ) {
    this.r = renderer;
    this.d = captured;
    this.options = options;
  }

  build(): FrameAuditReport {
    const r = this.r;
    const d = this.d;
    const n = d.program.length;
    const measured = r.backend.spy !== null && d.calls.length === n;
    const calls = measured === true ? d.calls : this.estimateCalls();
    const programs = r.backend.programs;
    const blocks = new Map<Float32Array, number>();
    const breaks: Record<BatchKey, number> = {
      program: 0,
      params: 0,
      texture: 0,
      clip: 0,
      perOp: 0,
      chunk: 0,
    };
    const ops: AuditOp[] = [];
    for (let i = 0; i < n; i++) {
      const block = d.params[i]!;
      let params: number | null = null;
      if (block !== null) {
        params = blocks.get(block) ?? blocks.size;
        blocks.set(block, params);
      }
      const brk = this.breakOf(i);
      if (brk !== null) {
        breaks[brk[0]!]++;
      }
      const program = programs[d.program[i]!];
      ops.push({
        index: i,
        chunk: d.chunkOf[i]!,
        program:
          program !== undefined && program.name !== ''
            ? program.name
            : `#${d.program[i]!}`,
        params,
        texture: this.textureInfo(d.texture[i]!),
        clip: d.clipRect[i]!,
        quads: d.count[i]!,
        node: this.nodeInfo(d.node[i]!),
        text: this.isText(d.node[i]!),
        break: brk,
        glCalls: calls[i]!,
      });
    }
    const scene = r.scene;
    let glCalls: Record<string, number> | null = null;
    if (r.backend.spy !== null) {
      glCalls = {};
      for (const name in d.glTotals) {
        if (d.glTotals[name]! > 0) {
          glCalls[name] = d.glTotals[name]!;
        }
      }
    }
    return {
      time: r.currentFrameTime,
      viewport: { w: r.view.w, h: r.view.h, pixelRatio: r.view.pixelRatio },
      chunks: d.chunks,
      walks: r.updateIterations,
      renderOps: r.flushedOps + r.ops.length,
      quads: d.quads,
      uploadBytes: d.uploadBytes,
      scene: {
        visited: scene.visited,
        updated: scene.updated,
        emitted: scene.emitted,
        textEmitted: scene.textEmitted,
      },
      glCalls,
      glCallsMeasured: measured,
      breaks,
      overdraw: this.overdraw(),
      findings: this.findings(ops),
      ops,
    };
  }

  private breakOf(i: number): BatchKey[] | null {
    const d = this.d;
    if (i === 0) {
      return null;
    }
    if (d.chunkOf[i] !== d.chunkOf[i - 1]) {
      return ['chunk'];
    }
    const keys: BatchKey[] = [];
    if (d.program[i] !== d.program[i - 1]) {
      keys.push('program');
    }
    if (d.params[i] !== d.params[i - 1]) {
      keys.push('params');
    }
    if (d.texture[i] !== d.texture[i - 1]) {
      keys.push('texture');
    }
    if (d.clip[i] !== d.clip[i - 1]) {
      keys.push('clip');
    }
    if (keys.length === 0) {
      keys.push('perOp');
    }
    return keys;
  }

  /**
   * Without the spy: the drawElements, plus a useProgram, bindTexture and
   * scissor change per key that changed and a params upload when the
   * program last drew another block (GlBackend.draw and the state GlContext
   * skips). Per-op uniforms are not counted; the frame's first op counts
   * every change.
   */
  private estimateCalls(): number[] {
    const d = this.d;
    const out: number[] = [];
    const lastParams = new Map<number, Float32Array | null>();
    for (let i = 0; i < d.program.length; i++) {
      const program = d.program[i]!;
      const params = d.params[i]!;
      let calls = 1;
      if (i === 0 || program !== d.program[i - 1]) {
        calls++;
      }
      if (i === 0 || d.texture[i] !== d.texture[i - 1]) {
        calls++;
      }
      if (params !== null && lastParams.get(program) !== params) {
        lastParams.set(program, params);
        calls++;
      }
      if (i === 0 ? d.clip[i] !== 0 : d.clip[i] !== d.clip[i - 1]) {
        calls++;
      }
      out.push(calls);
    }
    return out;
  }

  private overdraw(): AuditOverdraw {
    const d = this.d;
    const layers = d.layers;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < layers.length; i++) {
      const v = layers[i]!;
      sum += v;
      if (v > max) {
        max = v;
      }
    }
    const fullScreen: AuditLayer[] = [];
    for (let i = 0; i < d.fullScreen.length; i++) {
      const layer = d.fullScreen[i]!;
      fullScreen.push({
        op: layer.op,
        node: this.nodeInfo(layer.node),
        coverage: Math.round(layer.coverage * 1000) / 1000,
      });
    }
    return {
      cellSize: this.options.cellSize,
      cols: d.cols,
      rows: d.rows,
      mean:
        layers.length === 0 ? 0 : Math.round((sum / layers.length) * 100) / 100,
      max,
      fullScreen,
    };
  }

  /**
   * Each op is a culprit at most once, checked in this order: a
   * transparent shader node; a quad with a zIndex after text (the queued
   * text drew early); an op between two ops with the same keys (it splits
   * their run); two neighbours that differ in texture alone.
   */
  private findings(ops: AuditOp[]): AuditFinding[] {
    const d = this.d;
    const { program, params, texture, clip, chunkOf } = d;
    const n = ops.length;
    // An op whose calls a finding already counted (a run's restart).
    const claimed: boolean[] = [];
    for (let i = 0; i < n; i++) {
      claimed.push(false);
    }
    const groups = new Map<string, AuditFinding>();
    const add = (
      kind: FindingKind,
      culprit: number,
      detail: string,
      calls: number,
      covered: number[],
    ): void => {
      const node = ops[culprit]!.node;
      const key = `${kind}|${node.path}|${detail}`;
      let f = groups.get(key);
      if (f === undefined) {
        f = {
          kind,
          detail,
          path: node.path,
          count: 0,
          glCalls: 0,
          ops: [],
          example: node.label,
        };
        groups.set(key, f);
      }
      f.count++;
      f.glCalls += calls;
      for (let k = 0; k < covered.length; k++) {
        f.ops.push(covered[k]!);
      }
    };
    for (let i = 1; i < n; i++) {
      if (claimed[i] === true || chunkOf[i] !== chunkOf[i - 1]) {
        continue;
      }
      const op = ops[i]!;
      const next = i + 1 < n && chunkOf[i + 1] === chunkOf[i] ? i + 1 : -1;
      const splits =
        next >= 0 &&
        sameKeys(i - 1, next, program, params, texture, clip) === true;
      const id = d.node[i]!;
      if (op.text === false && this.isTransparentShader(id) === true) {
        let calls = op.glCalls;
        if (splits === true) {
          calls += ops[next]!.glCalls;
          claimed[next] = true;
        }
        add(
          'transparent-shader',
          i,
          `${op.program} with a transparent colour`,
          calls,
          [i],
        );
        continue;
      }
      const prev = ops[i - 1]!;
      const z = this.r.nodes.f64[id * F_STRIDE + F_Z_INDEX]!;
      if (op.text === false && prev.text === true && z !== 0) {
        // The text drawn early: the run of text ops before this one.
        let s = i - 1;
        while (
          s > 0 &&
          ops[s - 1]!.text === true &&
          chunkOf[s - 1] === chunkOf[i]
        ) {
          s--;
        }
        let calls = 0;
        const covered: number[] = [];
        for (let k = s; k < i; k++) {
          calls += ops[k]!.glCalls;
          covered.push(k);
        }
        // Without the text it would have extended the op before the text.
        if (
          s > 0 &&
          chunkOf[s - 1] === chunkOf[i] &&
          sameKeys(s - 1, i, program, params, texture, clip) === true
        ) {
          calls += op.glCalls;
        }
        covered.push(i);
        add(
          'ztext-flush',
          i,
          `zIndex ${z} drew the queued text early`,
          calls,
          covered,
        );
        continue;
      }
      if (op.text === false && splits === true) {
        claimed[next] = true;
        add(
          'split-run',
          i,
          `${this.kindOf(op)} between ${this.kindOf(prev)}s`,
          op.glCalls + ops[next]!.glCalls,
          [i],
        );
        continue;
      }
      const brk = op.break!;
      if (
        op.text === false &&
        prev.text === false &&
        brk.length === 1 &&
        brk[0] === 'texture' &&
        texture[i] !== 0 &&
        texture[i - 1] !== 0
      ) {
        add(
          'separate-textures',
          i,
          `${op.program} quads on separate textures`,
          op.glCalls,
          [i],
        );
      }
    }
    const out: AuditFinding[] = [];
    groups.forEach((f) => {
      out.push(f);
    });
    out.sort((a, b) => b.glCalls - a.glCalls);
    return out;
  }

  /**
   * What an op draws, in a finding's words: general enough that the copies
   * of a component (each poster its own image) group as one finding.
   */
  private kindOf(op: AuditOp): string {
    if (op.text === true) {
      return 'text';
    }
    if (op.program !== 'Default') {
      return `${op.program} quad`;
    }
    return op.texture.id === 0 ? 'plain rect' : 'image';
  }

  private isText(id: number): boolean {
    return (this.r.nodes.u32[id * I_STRIDE + I_STATE]! & ST_TEXT) !== 0;
  }

  /** A node with a shader whose every corner colour has alpha 0. */
  private isTransparentShader(id: number): boolean {
    const s = this.r.nodes;
    if (s.shaderRefs[id] === null || s.shaderRefs[id] === undefined) {
      return false;
    }
    const o = id * I_STRIDE;
    const u32 = s.u32;
    return (
      ((u32[o + I_COLOR_TL]! |
        u32[o + I_COLOR_TR]! |
        u32[o + I_COLOR_BL]! |
        u32[o + I_COLOR_BR]!) &
        0xff) ===
      0
    );
  }

  private textureInfo(id: number): AuditTexture {
    if (id === 0) {
      return NO_TEXTURE;
    }
    let info = this.textures.get(id);
    if (info !== undefined) {
      return info;
    }
    const t = this.r.textures;
    const src = (t.props[id] as { src?: unknown } | null)?.src;
    info = {
      id,
      kind: KIND_NAMES[t.kind[id]!] ?? 'image',
      src: typeof src === 'string' ? src : null,
      w: t.w[id]!,
      h: t.h[id]!,
    };
    this.textures.set(id, info);
    return info;
  }

  private nodeInfo(id: number): AuditNode {
    let info = this.nodes.get(id);
    if (info !== undefined) {
      return info;
    }
    const s = this.r.nodes;
    const i32 = s.i32;
    const root = this.r.root.id;
    const segments: string[] = [];
    const names: string[] = [];
    let n = id;
    while (n !== NULL && n !== root) {
      const parent = i32[n * I_STRIDE + I_PARENT]!;
      let index = 0;
      if (parent !== NULL) {
        let c = i32[parent * I_STRIDE + I_FIRST_CHILD]!;
        while (c !== n && c !== NULL) {
          c = s.next[c]!;
          index++;
        }
      }
      const extras = s.extras[n] as NodeExtras | null;
      let name = this.isText(n) === true ? 'text' : 'node';
      if (
        extras !== null &&
        extras !== undefined &&
        extras.componentName !== undefined
      ) {
        name = extras.componentName;
      }
      segments.push(`${name}[${index}]`);
      names.push(name);
      n = parent;
    }
    segments.reverse();
    names.reverse();
    const uid = i32[id * I_STRIDE + I_UID]!;
    let label = `${segments.join('/')}#${uid}`;
    const text = this.isText(id) === true ? (s.texts[id] as TextState) : null;
    if (text !== null) {
      const t = text.text;
      label += ` "${t.length > 24 ? `${t.substring(0, 24)}...` : t}"`;
    }
    label += this.imageOf(id);
    const data = this.dataOf(id);
    if (data !== null) {
      label += ` ${JSON.stringify(data)}`;
    }
    info = { id, uid, label, path: names.join('/'), data };
    this.nodes.set(id, info);
    return info;
  }

  /** ` src=<name>` for the node's image, ` sub=<sheet>` for a SubTexture. */
  private imageOf(id: number): string {
    const rec = this.r.nodes.i32[id * I_STRIDE + I_SOURCE_TEXTURE]!;
    if (rec === NULL) {
      return '';
    }
    const t = this.r.textures;
    const pixels = t.pixelsOf(rec);
    const src = (t.props[pixels] as { src?: unknown } | null)?.src;
    if (typeof src !== 'string') {
      return '';
    }
    return ` ${t.kind[rec] === KIND_SUB ? 'sub' : 'src'}=${baseName(src)}`;
  }

  private dataOf(id: number): Record<string, string | number | boolean> | null {
    const data = this.r.nodes.data[id] as Record<string, unknown> | null;
    if (data === null || data === undefined) {
      return null;
    }
    let out: Record<string, string | number | boolean> | null = null;
    for (const key in data) {
      const value = data[key];
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean') {
        if (out === null) {
          out = {};
        }
        out[key] = value as string | number | boolean;
      }
    }
    return out;
  }
}
