import type { EventEmitter } from '../../common/EventEmitter.js';
import type { FrameEvents } from '../FrameEvents.js';
import { same, type NodeStore } from '../nodes/NodeStore.js';
import type { TextState } from '../nodes/TextNode.js';
import {
  DIRTY_CLIP,
  DIRTY_LAYOUT,
  DIRTY_LOCAL,
  DIRTY_RENDERABLE,
  NULL,
  ST_RTL,
  ST_TEXT_BOX,
  ST_TEXT_CLIP,
  ST_TEXT_READY,
  VIS_INIT,
  visibilityOf,
} from '../nodes/NodeFlags.js';
import type { FontRecord, FontRegistry } from './FontRegistry.js';
import {
  measureRange,
  measureText,
  metricsAt,
  type SdfFont,
} from './sdfFont.js';
import {
  LayoutCache,
  effectiveAlign,
  inkExceedsBox,
  layoutText,
  mapTextLayout,
  type TextBaselineMode,
  type TextLayout,
} from './TextLayout.js';
import {
  DIR_INHERIT,
  DIR_RTL,
  F_H,
  F_STRIDE,
  F_W,
  I_DIRECTION,
  I_DIRTY,
  I_PARENT,
  I_STATE,
  I_STRIDE,
} from '../nodes/NodeLayout.js';

/** One line of {@link TextNodes.selectionGeometry}. */
export interface SelectionGeometryLine {
  text: string;
  /** Index of `text[0]` in the geometry's `text`. */
  start: number;
  /** Line box, local to the text block. */
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  /** x of each character boundary relative to `x`; length `text.length + 1`. */
  charX: number[];
}

/** A text node's lines, for selection hit-testing and highlights. */
export interface SelectionGeometry {
  /** The lines joined by `\n`: what a selection copies. */
  text: string;
  lines: SelectionGeometryLine[];
}

/**
 * The node side of text (spec 10): the scene pass's `layoutText`, the
 * wait lists of the nodes whose font is not there yet, the forceLoad
 * nodes laid out before the walk, and the layout cache. A text node lays
 * out from its font's description, before the walk composes it, takes the
 * layout's size in that visit (NodeStore.applySizeInVisit) and hears
 * `loaded` between walks (RendererCore.update), and is ready to draw once
 * its font's atlas is uploaded. `measure` lays it out earlier, outside the
 * walk, and the visit then reuses that layout.
 */
export class TextNodes {
  /** Layouts by content, shared by every node (spec 10.2). */
  readonly cache: LayoutCache;
  /** The renderer's baseline anchor (1.10's engine-wide textBaselineMode). */
  readonly baselineMode: TextBaselineMode;

  private readonly nodes: NodeStore;
  private readonly fonts: FontRegistry;
  /** `loaded`, delivered between walks; `failed` waits for the frame's events. */
  private readonly loadedEvents: FrameEvents;
  private readonly events: FrameEvents;
  /** Node ids waiting on each font name, made on demand (a node created before loadFont waits too). */
  private readonly waiting = new Map<string, number[]>();
  /** Text nodes with forceLoad set. */
  private readonly forced: number[] = [];
  /** Layouts layoutAhead makes per idle maintenance pass (settings.idleTextLayouts). */
  private readonly idleLayouts: number;

  constructor(
    nodes: NodeStore,
    fonts: FontRegistry,
    loadedEvents: FrameEvents,
    events: FrameEvents,
    cacheSize: number,
    baselineMode: TextBaselineMode,
    idleLayouts: number,
  ) {
    this.nodes = nodes;
    this.fonts = fonts;
    this.loadedEvents = loadedEvents;
    this.events = events;
    this.cache = new LayoutCache(cacheSize);
    this.baselineMode = baselineMode;
    this.idleLayouts = idleLayouts;
    fonts.onChange = (font) => this.fontChanged(font);
  }

  /**
   * PassHooks.layoutText: DIRTY_LAYOUT on a visited text node, before the
   * visit composes it (or a forceLoad one, before the walk). Without its
   * font's description it waits, drawing nothing; with it, it lays out
   * when a prop the layout reads changed (from the cache when another node
   * laid the same text out the same way), takes the size and queues
   * `loaded`, places its block, and is ready to draw when the atlas is up
   * (else it waits for that). Returns the dirty bits the size and the
   * block raised (DIRTY_LOCAL | DIRTY_SHADER, DIRTY_LOCAL), which the visit
   * takes: the node is drawn in this walk with the transform they give.
   * Never -1: the wait lists raise DIRTY_LAYOUT again when the font
   * changes, so nothing is left pending.
   */
  layoutText(id: number): number {
    const s = this.nodes;
    const t = s.texts[id] as TextState;
    const name = t.fontFamily;
    if (t.waiting !== null && t.waiting !== name) {
      this.unpark(id, t);
    }
    const font = this.fonts.get(name);
    if (font === undefined || font.font === null) {
      t.layout = null;
      t.font = null;
      s.u32[id * I_STRIDE + I_STATE] =
        s.u32[id * I_STRIDE + I_STATE]! & ~ST_TEXT_READY;
      this.park(id, t, name);
      return 0;
    }
    this.syncDirection(id, t);
    let raised = 0;
    let layout = t.layout;
    if (t.stale === true || layout === null || t.font !== font) {
      layout = this.lay(id, t, font, font.font);
      raised = s.applySizeInVisit(id, layout.width, layout.height);
    }
    raised |= this.place(id, t, layout);
    const state = s.u32[id * I_STRIDE + I_STATE]!;
    if (font.ready === false) {
      s.u32[id * I_STRIDE + I_STATE] = state & ~ST_TEXT_READY;
      this.park(id, t, name);
      return raised;
    }
    s.u32[id * I_STRIDE + I_STATE] =
      layout.glyphCount > 0 ? state | ST_TEXT_READY : state & ~ST_TEXT_READY;
    return raised;
  }

  /**
   * TextNode.measure: lay text node `id` out now, outside the walk, when a
   * layout is due (a prop the layout reads changed, or its font), for a
   * framework that sizes its layout by the text before the frame. The size
   * goes through applySize (DIRTY_LOCAL | DIRTY_SHADER, composed by the
   * next walk) and DIRTY_LAYOUT stays raised: the visit finds the layout
   * current, so it only places the block and derives readiness. `loaded`
   * is queued as the visit queues it. Returns false, changing nothing,
   * while the font's description is missing (the walk lays the node out
   * once it arrives); true otherwise.
   */
  measure(id: number): boolean {
    const s = this.nodes;
    const t = s.texts[id] as TextState;
    const font = this.fonts.get(t.fontFamily);
    if (font === undefined || font.font === null) {
      return false;
    }
    this.syncDirection(id, t);
    if (t.stale === false && t.layout !== null && t.font === font) {
      return true;
    }
    const layout = this.lay(id, t, font, font.font);
    s.applySize(id, layout.width, layout.height);
    s.markDirty(id, DIRTY_LAYOUT);
    return true;
  }

  /**
   * The resolved layout direction text `id` lays out with. Once a visit
   * has derived it, its ST_RTL. Before its first visit (a forceLoad node
   * laid out before the walk, the idle pre-layout, `measure()`), the
   * nearest ancestor's own value or derived bit up the chain, so that a
   * text pre-laid under an RTL parent is laid out once, with the layout
   * its visit then looks up, not an LTR one first. A bit left stale under
   * a culled ancestor whose direction changed is taken as it is: that
   * visit re-lays, the one extra layout a direction change costs.
   */
  private directionOf(id: number): boolean {
    const s = this.nodes;
    const i32 = s.i32;
    const u32 = s.u32;
    let n = id;
    while (n !== NULL) {
      const o = n * I_STRIDE;
      const own = i32[o + I_DIRECTION]!;
      if (own !== DIR_INHERIT) {
        return own === DIR_RTL;
      }
      const state = u32[o + I_STATE]!;
      if (visibilityOf(state) !== VIS_INIT) {
        return (state & ST_RTL) !== 0;
      }
      n = i32[o + I_PARENT]!;
    }
    return false;
  }

  /**
   * Take the resolved direction into `t`: it swaps left and right
   * alignment, so a change makes the layout stale (in the visit, the
   * DIRTY_LAYOUT raised with the change re-lays the text out now).
   */
  private syncDirection(id: number, t: TextState): void {
    const rtl = this.directionOf(id);
    if (rtl !== t.rtl) {
      t.rtl = rtl;
      t.stale = true;
    }
  }

  /**
   * Lay `t` out in `font` (from the cache when another node laid the same
   * text out the same way), make it the node's layout, and queue `loaded`
   * for a listener. The caller applies the size.
   */
  private lay(
    id: number,
    t: TextState,
    font: FontRecord,
    sdf: SdfFont,
  ): TextLayout {
    t.stale = false;
    t.font = font;
    const layout = this.cached(font, sdf, t);
    t.layout = layout;
    const node = this.nodes.handles[id] as EventEmitter;
    if (node.hasListener('loaded') === true) {
      this.loadedEvents.queue(node, 'loaded', {
        type: 'text',
        dimensions: { w: layout.width, h: layout.height },
      });
    }
    return layout;
  }

  /**
   * RendererCore.measureText: lay `t` out ahead of any node, into the
   * cache a text node with the same text props lays out from (its visit
   * then looks the layout up instead of laying out in its frame). No node,
   * no event, no frame. Returns the layout, or null while the font's
   * description is missing.
   */
  measureAhead(t: TextState): TextLayout | null {
    const font = this.fonts.get(t.fontFamily);
    if (font === undefined || font.font === null) {
      return null;
    }
    return this.cached(font, font.font, t);
  }

  /**
   * Read-only glyph geometry for text node `id`, for selection: the lines
   * the text draws (as the layout made them, with wrapping and the
   * overflow suffix), each line's box in the text block, and the x of every
   * character boundary, measured with the same `measureRange` the layout
   * advances glyphs with — kerning and letter spacing included, so a
   * highlight matches the glyph run to the pixel. Null before the text has
   * laid out or while its font is missing.
   *
   * Everything is derived on request and allocated with the result; nothing
   * is kept per node and no frame is asked for.
   */
  selectionGeometry(id: number): SelectionGeometry | null {
    const t = this.nodes.texts[id] as TextState | null;
    if (t === null || t.layout === null) {
      return null;
    }
    const font = this.fonts.get(t.fontFamily);
    if (font === undefined || font.font === null) {
      return null;
    }
    const sdf = font.font;
    const fontScale = t.fontSize / sdf.data.info.size;
    const letterSpacing = t.letterSpacing / fontScale;
    const layout = mapTextLayout(
      measureText,
      metricsAt(sdf, t.fontSize),
      t.text,
      effectiveAlign(t.textAlign, t.rtl),
      sdf,
      t.lineHeight,
      t.overflowSuffix,
      t.wordBreak,
      letterSpacing,
      t.maxLines,
      t.maxWidth / fontScale,
      t.maxHeight,
      this.baselineMode,
    );
    const rawLines = layout[0];
    const lineHeight = layout[4];
    const lines: SelectionGeometryLine[] = [];
    let joined = '';
    let start = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i]!;
      const lineText = raw[0];
      if (i > 0) {
        joined += '\n';
        start += 1;
      }
      const charX: number[] = new Array(lineText.length + 1);
      for (let k = 0; k <= lineText.length; k++) {
        charX[k] =
          measureRange(lineText, 0, k, sdf, letterSpacing) * fontScale;
      }
      lines.push({
        text: lineText,
        start,
        x: raw[3] * fontScale + t.boxX,
        y: i * lineHeight + t.boxY,
        width: raw[1] * fontScale,
        height: lineHeight,
        baseline: raw[4] + t.boxY,
        charX,
      });
      joined += lineText;
      start += lineText.length;
    }
    return { text: joined, lines };
  }

  /**
   * Idle maintenance: lay out, into the cache, up to `idleLayouts` text
   * nodes a layout is due for that no walk has visited (beyond the bounds
   * margin, under a hidden parent), from their text props as they are now,
   * as measureAhead does: the visit that brings one in looks its layout up
   * (taking the size, telling `loaded` and placing it as ever) instead of
   * laying it out in its frame. The nodes are not touched: no size, no
   * event, no frame. A layout the cache has already is not made again nor
   * counted. Returns how many were made.
   */
  layoutAhead(): number {
    const budget = this.idleLayouts;
    if (budget <= 0) {
      return 0;
    }
    const s = this.nodes;
    const u32 = s.u32;
    const texts = s.texts;
    const cache = this.cache;
    let made = 0;
    for (let id = 0; id < texts.length && made < budget; id++) {
      const t = texts[id] as TextState | null;
      if (t === null || (u32[id * I_STRIDE + I_DIRTY]! & DIRTY_LAYOUT) === 0) {
        continue;
      }
      const font = this.fonts.get(t.fontFamily);
      if (font === undefined || font.font === null) {
        continue;
      }
      this.syncDirection(id, t);
      if (t.stale === false && t.layout !== null && t.font === font) {
        continue;
      }
      if (cache.get(font.id, t) !== undefined) {
        continue;
      }
      cache.set(font.id, t, layoutText(t, font.font, this.baselineMode));
      made++;
    }
    return made;
  }

  /**
   * The layout of `t` in `font` from the cache, else laid out and cached.
   * By the record, not a name: a font loaded again under its name (a
   * failed load, retried) may lay text out differently.
   */
  private cached(font: FontRecord, sdf: SdfFont, t: TextState): TextLayout {
    const cache = this.cache;
    let layout = cache.get(font.id, t);
    if (layout === undefined) {
      layout = layoutText(t, sdf, this.baselineMode);
      cache.set(font.id, t, layout);
    }
    return layout;
  }

  /**
   * Before every walk: lay out the forceLoad nodes a layout is due for,
   * which the walk may not visit (a parent out of bounds or hidden), as
   * 1.10 laid them out whatever their parent's visibility. What the layout
   * raised is marked for their next visit, which composes them and derives
   * their renderability.
   */
  drainForced(): void {
    const s = this.nodes;
    const forced = this.forced;
    for (let i = 0; i < forced.length; i++) {
      const id = forced[i]!;
      const d = s.u32[id * I_STRIDE + I_DIRTY]!;
      if ((d & DIRTY_LAYOUT) === 0) {
        continue;
      }
      s.u32[id * I_STRIDE + I_DIRTY] = (d & ~DIRTY_LAYOUT) | DIRTY_RENDERABLE;
      const raised = this.layoutText(id);
      if (raised !== 0) {
        s.markDirty(id, raised);
      }
    }
  }

  /** forceLoad set or cleared on text node `id` (the setter). */
  force(id: number, on: boolean): void {
    const t = this.nodes.texts[id] as TextState;
    if (t.forced === on) {
      return;
    }
    t.forced = on;
    const forced = this.forced;
    if (on === true) {
      forced.push(id);
      return;
    }
    const i = forced.indexOf(id);
    forced[i] = forced[forced.length - 1]!;
    forced.pop();
  }

  /** RendererCore.releaseNode: a destroyed text node leaves its lists. */
  release(id: number): void {
    const t = this.nodes.texts[id] as TextState | null;
    if (t === null) {
      return;
    }
    if (t.waiting !== null) {
      this.unpark(id, t);
    }
    if (t.forced === true) {
      this.force(id, false);
    }
  }

  /** Idle maintenance: the layout cache back to its size. */
  trim(): void {
    this.cache.trim();
  }

  /**
   * The box the block is placed by (1.10 CoreTextNode.updateLocalTransform):
   * with `contain` on an axis and a max size there, mount and pivot use the
   * max size and the block aligns inside it by `textAlign`; a height above
   * the text's (`maxHeight`) places it by `verticalAlign`; `offsetY` moves
   * it down. Sets (or clears) ST_TEXT_CLIP when the layout's ink leaves the
   * box by more than a pixel. Returns DIRTY_LOCAL and/or DIRTY_CLIP when
   * either changed (NaN equal to NaN, so a NaN size settles), else 0.
   */
  private place(id: number, t: TextState, layout: TextLayout): number {
    const s = this.nodes;
    const w = s.f64[id * F_STRIDE + F_W]!;
    const h = s.f64[id * F_STRIDE + F_H]!;
    const contain = t.contain;
    const maxWidth = t.maxWidth;
    const maxHeight = t.maxHeight;
    const inWidth = (contain === 'width' || contain === 'both') && maxWidth > 0;
    const inHeight =
      (contain === 'height' || contain === 'both') && maxHeight > 0;
    const boxW = inWidth === true ? maxWidth : w;
    const boxH = inHeight === true ? maxHeight : h;
    let x = 0;
    if (inWidth === true) {
      const align = effectiveAlign(t.textAlign, t.rtl);
      if (align === 'right') {
        x = maxWidth - w;
      } else if (align === 'center') {
        x = (maxWidth - w) * 0.5;
      }
    }
    let y = 0;
    const slack = (maxHeight > 0 ? maxHeight : h) - layout.height;
    if (slack > 0) {
      if (t.verticalAlign === 'bottom') {
        y = slack;
      } else if (t.verticalAlign === 'middle') {
        y = slack * 0.5;
      }
    }
    y += t.offsetY;
    const boxed =
      same(boxW, w) === false ||
      same(boxH, h) === false ||
      same(x, 0) === false ||
      same(y, 0) === false;
    let state = s.u32[id * I_STRIDE + I_STATE]!;
    let raised = 0;
    if (
      boxed !== ((state & ST_TEXT_BOX) !== 0) ||
      (boxed === true &&
        (same(t.boxW, boxW) === false ||
          same(t.boxH, boxH) === false ||
          same(t.boxX, x) === false ||
          same(t.boxY, y) === false))
    ) {
      t.boxW = boxW;
      t.boxH = boxH;
      t.boxX = x;
      t.boxY = y;
      state =
        boxed === true ? state | ST_TEXT_BOX : state & ~ST_TEXT_BOX;
      s.u32[id * I_STRIDE + I_STATE] = state;
      raised = DIRTY_LOCAL;
    }
    // The ink rule: a glyph that paints past the box (its bitmap's padding or
    // an italic overhang, more than the pixel tolerance) is clipped to it.
    // Ordinary side bearings stay under the tolerance, so a text that fits
    // takes no clip record and no pass of its own.
    const overflows = inkExceedsBox(
      layout,
      t.boxX,
      t.boxY,
      t.boxW,
      t.boxH,
    );
    const clipped = (state & ST_TEXT_CLIP) !== 0;
    if (overflows !== clipped) {
      s.u32[id * I_STRIDE + I_STATE] =
        overflows === true
          ? state | ST_TEXT_CLIP
          : state & ~ST_TEXT_CLIP;
      raised |= DIRTY_CLIP;
    }
    return raised;
  }

  private park(id: number, t: TextState, name: string): void {
    if (t.waiting === name) {
      return;
    }
    let list = this.waiting.get(name);
    if (list === undefined) {
      list = [];
      this.waiting.set(name, list);
    }
    list.push(id);
    t.waiting = name;
  }

  private unpark(id: number, t: TextState): void {
    const name = t.waiting!;
    t.waiting = null;
    const list = this.waiting.get(name);
    if (list === undefined) {
      return;
    }
    const i = list.indexOf(id);
    if (i !== -1) {
      list[i] = list[list.length - 1]!;
      list.pop();
    }
    if (list.length === 0) {
      this.waiting.delete(name);
    }
  }

  /**
   * A font's description arrived: the nodes waiting on any of its names
   * lay out, and stay listed (`park` keeps them) until its atlas is up,
   * when they lay out again and leave the list. So a failure of the atlas
   * reaches every one of them, a node no walk visited since (out of bounds,
   * hidden) included. Its load failed for good: they hear `failed` and keep
   * waiting, for a later load of the name (1.10 kept them parked).
   */
  private fontChanged(font: FontRecord): void {
    const s = this.nodes;
    const error = font.error;
    const ready = font.ready;
    const names = font.names;
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      const list = this.waiting.get(name);
      if (list === undefined) {
        continue;
      }
      if (error !== null) {
        this.tellFailed(list, error, names);
        continue;
      }
      if (ready === true) {
        this.waiting.delete(name);
      }
      for (let j = 0; j < list.length; j++) {
        const id = list[j]!;
        if (ready === true) {
          (s.texts[id] as TextState).waiting = null;
        }
        s.markDirty(id, DIRTY_LAYOUT);
      }
    }
  }

  /**
   * `failed` for the waiting nodes listening to it, each of which asks for
   * a frame (markDirty with no bits, as setZIndex asks for one), whose
   * flush delivers it: the failure can arrive inside a flush (the atlas's
   * own `failed`), where an event queued waits for the next flush and
   * schedules none. A node whose family is none of the font's `names` is
   * skipped: it switched font since it was listed, and no walk visited it
   * to take it off the list.
   */
  private tellFailed(list: number[], error: Error, names: string[]): void {
    const s = this.nodes;
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      const node = s.handles[id] as EventEmitter;
      if (
        node.hasListener('failed') === false ||
        names.indexOf((s.texts[id] as TextState).fontFamily) === -1
      ) {
        continue;
      }
      this.events.queue(node, 'failed', { type: 'text', error });
      s.markDirty(id, 0);
    }
  }
}
