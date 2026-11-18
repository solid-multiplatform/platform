/**
 * The fonts of one SceneGraph renderer.
 *
 * An app registers each font file under a family, weight and style, with the
 * layout table the build made from the file (font-metrics.ts). Text naming a
 * registered family is laid out from that table at once: nothing is measured
 * on the device and nothing waits for the firmware to load the file. A family
 * nobody registered is drawn in the Roku system font, said once on the
 * console; that font has no table, so its text is measured on the device and
 * laid out when the firmware can measure it.
 *
 * Nothing here runs while a scene is idle. The only timers are the bounded
 * waits for a font to load or for the system font to become measurable, and
 * each ends with its poll cancelled.
 */
import { createElement, insertNode, setProp, tmTransaction } from '@roku-sdk/solid';
import { getFontMeasure, whenFontReady } from '@roku-sdk/rsg-ts/runtime';
import type { TmNodeRef } from '@roku-sdk/interfaces';
import { FontMetrics } from './font-metrics.js';
import type { LineMetrics, SizedFont } from './font-metrics.js';

/** A font file registered with a renderer. */
export interface FontDescription {
  family: string;
  /** 100 to 900, or `normal` / `bold`. Default 400. */
  weight?: number | string;
  /** `normal` (default), `italic` or `oblique`. */
  style?: string;
  /** The packaged file: what importing the font file gives, a path under `pkg:/fonts/`. */
  uri: string;
  /** The file's layout table, decoded or as the build packed it. */
  metrics: FontMetrics | string | Uint8Array;
}

/** How long a font may take to load before it is given up on, in ms. */
export const FONT_LOAD_TIMEOUT = 3000;
/** The size a font is loaded at to find out whether its file loads. */
const PROBE_SIZE = 32;
const SYSTEM_FONT = 'font:SystemFontFile';
const SYSTEM_BOLD_FONT = 'font:BoldSystemFontFile';

// ---- tables made at build time ----------------------------------------------

const tables = new Map<string, FontMetrics | string | Uint8Array>();

/**
 * The layout table of a packaged font file, by its URI. The Roku preset calls
 * this from the module an imported `.ttf`/`.otf` becomes, so the table is there
 * before the app runs; `loadFont` then finds it by the font's URI.
 */
export function registerFontMetrics(uri: string, metrics: FontMetrics | string | Uint8Array): void {
  tables.set(uri, metrics);
}

/** The table registered for `uri`, as it was registered: packed until a text node first draws with it. */
export function fontTable(uri: string): FontMetrics | string | Uint8Array | undefined {
  return tables.get(uri);
}

/** The table registered for `uri`, decoded. */
export function fontMetricsFor(uri: string): FontMetrics | undefined {
  const found = tables.get(uri);
  if (found === undefined || found instanceof FontMetrics) return found;
  const decoded = FontMetrics.decode(found);
  tables.set(uri, decoded);
  return decoded;
}

// ---- waiting on the firmware ------------------------------------------------

interface Wait {
  done: Promise<void>;
  cancel(): void;
}

/**
 * Resolves when the firmware can measure `font`, rejects after `ms`. Either
 * way the timer is cleared and the SDK's poll is stopped: the abort signal
 * given to `whenFontReady` has listeners, which is what makes the SDK drop
 * its poll at once instead of at its next tick.
 */
function waitMeasurable(font: TmNodeRef, ms: number): Wait {
  const listeners: (() => void)[] = [];
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    reason: new Error('not loaded after ' + ms + ' ms'),
    addEventListener(_type: 'abort', listener: () => void) {
      listeners.push(listener);
    },
    removeEventListener(_type: 'abort', listener: () => void) {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const cancel = () => {
    if (aborted) return;
    aborted = true;
    clearTimeout(timer);
    listeners.slice().forEach((listener) => listener());
  };
  const timer = setTimeout(cancel, ms);
  const done = whenFontReady(font, { signal }).then(
    () => {
      clearTimeout(timer);
      // Aborted in the tick the font became ready: still a timeout.
      if (aborted) throw signal.reason;
    },
    (error) => {
      clearTimeout(timer);
      throw error;
    },
  );
  return { done, cancel };
}

// ---- faces: a font at one size ----------------------------------------------

/** A font at one size: its measurements, its SceneGraph Font node, and how many text nodes use it. */
export interface Face {
  readonly key: string;
  /** The Font node a Label takes in its `font` field. */
  readonly node: any;
  readonly font: SizedFont;
  /** False for a system-font face the firmware cannot measure yet (or at all): its text has no layout. */
  readonly measurable: boolean;
  /** True once a system-font face has been given up on: its text is drawn unmeasured. */
  readonly failed: boolean;
  uses: number;
}

/** A registered font at one size. Its Font node is made when a Label first draws with it: measuring needs none. */
class TableFace implements Face {
  uses = 0;
  readonly measurable = true;
  readonly failed = false;
  /** The Font node, once made. */
  made: any = null;

  constructor(
    readonly key: string,
    readonly font: SizedFont,
    private readonly make: () => any,
  ) {}

  get node(): any {
    if (this.made === null) this.made = this.make();
    return this.made;
  }
}

/** The system font at one size, measured on the device once the firmware has it. */
class SystemFace implements Face, SizedFont {
  uses = 0;
  measurable = false;
  failed = false;
  metrics: LineMetrics = { ascender: 0, descender: 0, lineGap: 0, capHeight: 0, xHeight: 0 };
  labelAscent = 0;
  labelLineHeight = 0;
  private widths = new Map<string, number>();
  private wait: Wait | null = null;
  private attempts = 0;

  constructor(
    readonly key: string,
    readonly node: any,
    private readonly registry: FontRegistry,
  ) {
    this.watch();
  }

  get font(): SizedFont {
    return this;
  }

  /** Waits (bounded) for the firmware to be able to measure this face, then has its text laid out. */
  private watch() {
    if (this.wait !== null || this.failed) return;
    if (++this.attempts > 2) {
      this.failed = true;
      console.error('ROKU_FONT the system font cannot be measured at ' + this.key + ': its text is drawn unmeasured');
      this.registry.changed();
      return;
    }
    const wait = waitMeasurable(this.node.r, FONT_LOAD_TIMEOUT / 2);
    this.wait = wait;
    wait.done.then(
      () => {
        this.wait = null;
        try {
          const measure = getFontMeasure();
          const ascent = measure.getAscent(this.node.r);
          this.labelAscent = ascent;
          this.labelLineHeight = measure.getOneLineHeight(this.node.r);
          this.metrics = {
            ascender: ascent,
            descender: -measure.getDescent(this.node.r),
            lineGap: 0,
            capHeight: ascent * 0.7,
            xHeight: ascent * 0.5,
          };
          this.measurable = true;
          this.registry.changed();
        } catch (error) {
          this.watch();
        }
      },
      () => {
        if (this.wait !== wait) return; // released
        this.wait = null;
        this.watch();
      },
    );
  }

  measure(text: string, spacing: number): number {
    if (!this.measurable) return 0;
    if (spacing !== 0) {
      // Letter-spaced text is drawn a glyph at a time.
      let width = 0;
      for (const glyph of text) width += this.width(glyph) + spacing;
      return width;
    }
    return this.width(text);
  }

  private width(text: string): number {
    let width = this.widths.get(text);
    if (width !== undefined) return width;
    try {
      width = Number(getFontMeasure().getOneLineWidth(this.node.r, text, 100000)) || 0;
    } catch (error) {
      // The firmware dropped the font (it keeps only fonts a drawn Label uses): wait for it again.
      this.measurable = false;
      this.widths.clear();
      this.watch();
      return 0;
    }
    if (this.widths.size >= 2000) this.widths.clear();
    this.widths.set(text, width);
    return width;
  }

  release() {
    const wait = this.wait;
    this.wait = null;
    if (wait !== null) wait.cancel();
  }
}

interface RegisteredFont {
  family: string;
  weight: number;
  style: string;
  uri: string;
  metrics: FontMetrics | string | Uint8Array;
  /** The file did not load: text naming the family does not use this font. */
  failed: boolean;
}

const weightOf = (weight: number | string | undefined): number => {
  if (typeof weight === 'number') return Number.isFinite(weight) && weight > 0 ? weight : 400;
  if (weight === undefined || weight === null || weight === '') return 400;
  const parsed = Number(weight);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return /bold|black|heavy/i.test(weight) ? 700 : 400;
};

const styleOf = (style: string | undefined) => (style === 'italic' || style === 'oblique' ? 'italic' : 'normal');

/**
 * The family and weight a name stands for. The platform writes a weight into
 * the family (`Roboto700`), in a text node's props and in the fonts an app
 * loads alike, so a name ending in three digits is that family at that weight
 * unless a weight is given beside it.
 */
function named(family: string, weight: number | string | undefined): [string, number] {
  if (weight === undefined || weight === null || weight === '') {
    const suffix = /^(.+?)(\d{3})$/.exec(family);
    if (suffix !== null) return [suffix[1], Number(suffix[2])];
  }
  return [family, weightOf(weight)];
}

export class FontRegistry {
  /** Goes up whenever text may lay out differently: a font registered, failed, or the system font became measurable. */
  version = 0;
  private families = new Map<string, RegisteredFont[]>();
  private resolved = new Map<string, RegisteredFont | null>();
  private warned = new Set<string>();
  private faces = new Map<string, Face>();
  private decoded = new Map<string | Uint8Array, FontMetrics>();
  /** By URI: the load of a file in flight or finished, so a second `load` of it joins the first. */
  private loads = new Map<string, Promise<void>>();
  private waits = new Set<Wait>();
  private destroyed = false;

  /**
   * @param root the SceneGraph node Font nodes are attached under.
   * @param onChange called when `version` goes up: the renderer lays its text out again.
   */
  constructor(
    private readonly root: any,
    private readonly onChange: () => void,
  ) {}

  changed() {
    if (this.destroyed) return;
    this.version++;
    this.resolved.clear();
    this.onChange();
  }

  /** Registers a font file. Text naming its family lays out from its table from now on. */
  registerFont(font: FontDescription): void {
    this.add(font);
  }

  private add(font: FontDescription): RegisteredFont {
    const [family, weight] = named(font.family, font.weight);
    const style = styleOf(font.style);
    let faces = this.families.get(family);
    if (faces === undefined) {
      faces = [];
      this.families.set(family, faces);
    }
    let entry = faces.find((face) => face.weight === weight && face.style === style);
    if (entry !== undefined && entry.uri === font.uri && entry.metrics === font.metrics && !entry.failed) return entry;
    if (entry === undefined) {
      entry = { family, weight, style, uri: font.uri, metrics: font.metrics, failed: false };
      faces.push(entry);
    } else {
      entry.uri = font.uri;
      entry.metrics = font.metrics;
      entry.failed = false;
    }
    this.changed();
    return entry;
  }

  /**
   * Registers a font and loads its file. Resolves when the firmware has the
   * font; rejects when it has not within `timeout` ms (a missing or broken
   * file), after which text naming the family uses another weight of it or
   * the system font. Text is laid out from the table either way and does not
   * wait for this.
   */
  load(font: FontDescription, timeout: number = FONT_LOAD_TIMEOUT): Promise<void> {
    const uri = this.add(font).uri;
    let loading = this.loads.get(uri);
    if (loading === undefined) {
      loading = this.probe(uri, timeout).catch((error) => {
        if (this.destroyed) throw error;
        // A later `load` of the file tries again.
        this.loads.delete(uri);
        this.families.forEach((faces) => {
          for (const face of faces) if (face.uri === uri) face.failed = true;
        });
        console.error('ROKU_FONT ' + uri + ' did not load: ' + String(error?.message ?? error));
        this.changed();
        throw error;
      });
      this.loads.set(uri, loading);
    }
    return loading;
  }

  /**
   * Whether the firmware loads `uri`: a Font node is published and waited on.
   * A font that is not measurable half way through is tried once more on a
   * new node, because the firmware now and then never reports a good font.
   */
  private async probe(uri: string, timeout: number): Promise<void> {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.destroyed) break;
      const node = this.fontNode(uri, PROBE_SIZE);
      const wait = waitMeasurable(node.r, timeout / 2);
      this.waits.add(wait);
      try {
        await wait.done;
        return;
      } catch (error) {
        failure = error;
      } finally {
        this.waits.delete(wait);
        tmTransaction.removeNode(this.root, node);
      }
    }
    throw failure ?? new Error('the renderer was destroyed');
  }

  /** A published Font node. `size` is written before `uri`, or the firmware first loads the file at size 1. */
  private fontNode(uri: string, size: number): any {
    const node: any = createElement('font');
    setProp(node, 'preUpdate', true);
    setProp(node, 'size', size);
    setProp(node, 'uri', uri);
    insertNode(this.root, node);
    return node;
  }

  /**
   * The registered font for what a text node names: the family, then the
   * nearest weight of it in the wanted style. Null for a family that is not
   * registered (or whose files did not load), which is said once.
   */
  private resolve(name: string, weight: number | string | undefined, style: string): RegisteredFont | null {
    const key = name + '|' + weight + '|' + style;
    const cached = this.resolved.get(key);
    if (cached !== undefined) return cached;
    const [family, wanted] = named(name, weight);
    const faces = this.families.get(family);
    let best: RegisteredFont | null = null;
    let bestDistance = Infinity;
    if (faces !== undefined) {
      for (const face of faces) {
        if (face.failed) continue;
        // Between two equally near weights the lighter wins below 500, the heavier above.
        const delta = face.weight - wanted;
        const distance =
          Math.abs(delta) * 2 + (delta !== 0 && delta > 0 === wanted < 500 ? 1 : 0) + (face.style === style ? 0 : 2000);
        if (distance < bestDistance) {
          best = face;
          bestDistance = distance;
        }
      }
    }
    if (best === null && family !== '' && !this.warned.has(family)) {
      this.warned.add(family);
      console.warn(
        'ROKU_FONT family "' + family + '" ' + (faces !== undefined ? 'has no font that loaded' : 'is not registered') +
          ': its text uses the system font. Register it with loadFonts([{ fontFamily, fontUrl }]).',
      );
    }
    this.resolved.set(key, best);
    return best;
  }

  /**
   * The face a text node draws with, counted as one more use of it. Give it
   * back with `release` when the node names another font or size, or goes.
   */
  acquire(family: string, weight: number | string | undefined, style: string | undefined, size: number): Face {
    const wantedStyle = styleOf(style);
    let font = this.resolve(family, weight, wantedStyle);
    // The table is decoded when the font is first drawn with, not when it is registered.
    while (font !== null && !(font.metrics instanceof FontMetrics)) {
      try {
        // One decode per table, however many families name the file.
        let decoded = this.decoded.get(font.metrics);
        if (decoded === undefined) {
          decoded = FontMetrics.decode(font.metrics);
          this.decoded.set(font.metrics, decoded);
        }
        font.metrics = decoded;
      } catch (error) {
        font.failed = true;
        console.error('ROKU_FONT ' + font.family + ' ' + font.weight + ' (' + font.uri + '): ' + String((error as any)?.message ?? error));
        this.resolved.clear();
        font = this.resolve(family, weight, wantedStyle);
      }
    }
    const pixels = Math.max(1, Math.round(size));
    const uri = font !== null ? font.uri : named(family, weight)[1] >= 600 ? SYSTEM_BOLD_FONT : SYSTEM_FONT;
    const key = uri + '@' + pixels;
    let face = this.faces.get(key);
    if (face === undefined) {
      if (font === null) face = new SystemFace(key, this.fontNode(uri, pixels), this);
      else face = new TableFace(key, (font.metrics as FontMetrics).at(pixels), () => this.fontNode(uri, pixels));
      this.faces.set(key, face);
    }
    face.uses++;
    return face;
  }

  /** One use less of `face`; its Font node goes with the last. */
  release(face: Face) {
    if (--face.uses > 0 || this.faces.get(face.key) !== face) return;
    this.faces.delete(face.key);
    if (face instanceof SystemFace) {
      face.release();
      tmTransaction.removeNode(this.root, face.node);
    } else if ((face as TableFace).made !== null) tmTransaction.removeNode(this.root, (face as TableFace).made);
  }

  /** Ends every wait and forgets every font. Loads in flight reject. */
  destroy() {
    this.destroyed = true;
    this.waits.forEach((wait) => wait.cancel());
    this.waits.clear();
    this.faces.forEach((face) => {
      if (face instanceof SystemFace) face.release();
    });
    this.faces.clear();
    this.families.clear();
    this.resolved.clear();
    this.loads.clear();
    this.decoded.clear();
  }
}
