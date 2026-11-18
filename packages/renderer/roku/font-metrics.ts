/**
 * A font's layout table on the device: advances, kerning and standard
 * ligatures by code point, packed at build time by font-file.ts from the
 * font file itself. With it text is measured synchronously, before the
 * firmware has loaded the font and without a native call per string.
 *
 * `measure` reproduces the device's own arithmetic, read off a Roku TV on
 * Roku OS 16: the firmware shapes text with kerning and ligatures at an
 * integer pixel size, scales in FreeType's fixed point, and drops the
 * fraction of every glyph's advance. A Label's first baseline is hhea's
 * ascender rounded up below its top, and its lines are one pixel further
 * apart than that plus hhea's descender rounded up.
 */

/** A font's line metrics in pixels at one size, as the WebGL backend's text layout takes them. */
export interface LineMetrics {
  ascender: number;
  /** Negative below the baseline. */
  descender: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
}

/** Line metrics in font design units: the `metrics` a font can be registered with, as on WebGL. */
export interface FontLineMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
  unitsPerEm: number;
  capHeight?: number;
  xHeight?: number;
}

/** What text layout asks of a font at one pixel size. */
export interface SizedFont {
  /** The width the device draws `text` at, with `spacing` after every glyph. */
  measure(text: string, spacing: number): number;
  readonly metrics: LineMetrics;
  /** From the top of a Label to its first baseline. */
  readonly labelAscent: number;
  /** From one line of a Label to the next when its lineSpacing is 0. */
  readonly labelLineHeight: number;
}

/** The format font-file.ts packs: its FONT_METRICS_VERSION. */
const VERSION = 1;
const CAP_HEIGHT_RATIO = 0.7;
const X_HEIGHT_RATIO = 0.5;

/** Characters that draw nothing and take no width (the WebGL backend's list). */
const invisible = (code: number) =>
  code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff || code === 0x00ad || code === 0x2060;

/** `size` pixels per em as FreeType's 16.16 scale. */
const scaleOf = (size: number, unitsPerEm: number) => Math.round((size * 64 * 65536) / unitsPerEm);
/** Font units in 26.6 pixels, rounded as FreeType's FT_MulFix rounds. */
const fixed = (units: number, scale: number) => Math.round((units * scale) / 65536);

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fromBase64(text: string): Uint8Array {
  let length = text.length;
  while (length > 0 && text[length - 1] === '=') length--;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let buffer = 0;
  let held = 0;
  let at = 0;
  for (let i = 0; i < length; i++) {
    buffer = (buffer << 6) | BASE64.indexOf(text[i]);
    held += 6;
    if (held >= 8) {
      held -= 8;
      bytes[at++] = (buffer >> held) & 255;
    }
  }
  return bytes;
}

export class FontMetrics {
  /** Line metrics for layout, in font units: the file's OS/2 typo metrics unless the font was registered with others. */
  ascender: number;
  descender: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;

  private constructor(
    readonly unitsPerEm: number,
    /** hhea's ascender and descender: where the device puts a Label's baseline and lines. */
    private readonly deviceAscender: number,
    private readonly deviceDescender: number,
    private readonly missing: number,
    private readonly starts: Uint32Array,
    private readonly firstSlots: Uint32Array,
    private readonly ascii: Int32Array,
    private readonly advances: Uint16Array,
    private readonly left: Uint16Array,
    private readonly right: Uint16Array,
    /** Per left class, where its pairs start in the two arrays after it (one more entry than classes). */
    private readonly pairStarts: Uint32Array,
    private readonly pairRights: Uint16Array,
    private readonly pairValues: Int16Array,
    /** By first code point: each ligature's other code points, then its slot. */
    private readonly ligatures: Map<number, number[][]> | null,
  ) {
    this.ascender = deviceAscender;
    this.descender = deviceDescender;
    this.lineGap = 0;
    this.capHeight = 0;
    this.xHeight = 0;
  }

  /** Reads a table packed by font-file.ts, as bytes or base64. */
  static decode(packed: string | Uint8Array): FontMetrics {
    const bytes = typeof packed === 'string' ? fromBase64(packed) : packed;
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const head = (i: number) => d.getUint16(i * 2, true);
    if (bytes.length < 40 || head(0) !== VERSION) throw new Error('font metrics: not a version ' + VERSION + ' table');
    const ranges = head(8);
    const codeSlots = head(9);
    const slots = head(10);
    const rows = head(11) - 1;
    const words = head(13) + head(14) * 65536;
    const wide = head(15);
    const pairs = head(16) + head(17) * 65536;
    let at = 40;

    const starts = new Uint32Array(ranges);
    // One past the last range, so a range's length is the next first slot less its own.
    const firstSlots = new Uint32Array(ranges + 1);
    const ascii = new Int32Array(128).fill(-1);
    for (let r = 0, slot = 0; r < ranges; r++, at += 6) {
      starts[r] = d.getUint32(at, true);
      firstSlots[r] = slot;
      const count = d.getUint16(at + 4, true);
      for (let code = starts[r]; code < 128 && code < starts[r] + count; code++) ascii[code] = slot + code - starts[r];
      slot += count;
    }
    firstSlots[ranges] = codeSlots;
    const advances = new Uint16Array(slots);
    for (let s = 0; s < slots; s++, at += 2) advances[s] = d.getUint16(at, true);
    const left = new Uint16Array(slots);
    const right = new Uint16Array(slots);
    for (const list of [left, right]) {
      for (let s = 0; s < slots; s++, at += wide) list[s] = wide === 2 ? d.getUint16(at, true) : d.getUint8(at);
    }
    const pairStarts = new Uint32Array(rows + 1);
    for (let r = 0; r < rows; r++, at += 2) pairStarts[r + 1] = pairStarts[r] + d.getUint16(at, true);
    const pairRights = new Uint16Array(pairs);
    const pairValues = new Int16Array(pairs);
    for (let p = 0; p < pairs; p++, at += 4) {
      pairRights[p] = d.getUint16(at, true);
      pairValues[p] = d.getInt16(at + 2, true);
    }
    let ligatures: Map<number, number[][]> | null = null;
    for (let w = 0; w < words; ) {
      const length = d.getUint32(at + w * 4, true);
      const entry: number[] = [];
      // The code points after the first, then the slot.
      for (let i = 2; i <= length + 1; i++) entry.push(d.getUint32(at + (w + i) * 4, true));
      const first = d.getUint32(at + (w + 1) * 4, true);
      if (ligatures === null) ligatures = new Map();
      const list = ligatures.get(first);
      if (list === undefined) ligatures.set(first, [entry]);
      else list.push(entry);
      w += length + 2;
    }

    const metrics = new FontMetrics(
      head(1), d.getInt16(36, true), d.getInt16(38, true), head(7),
      starts, firstSlots, ascii, advances, left, right, pairStarts, pairRights, pairValues, ligatures,
    );
    metrics.ascender = d.getInt16(4, true);
    metrics.descender = d.getInt16(6, true);
    metrics.lineGap = d.getInt16(8, true);
    metrics.capHeight = d.getInt16(10, true);
    metrics.xHeight = d.getInt16(12, true);
    return metrics;
  }

  /**
   * The same glyph data with other line metrics: what an app that tuned its
   * font's metrics for the WebGL backend passes here too. Where the device
   * draws the glyphs does not change, only the lines laid out around them.
   */
  withLineMetrics(lines: FontLineMetrics): FontMetrics {
    const copy = new FontMetrics(
      this.unitsPerEm, this.deviceAscender, this.deviceDescender, this.missing, this.starts, this.firstSlots,
      this.ascii, this.advances, this.left, this.right, this.pairStarts, this.pairRights, this.pairValues, this.ligatures,
    );
    const scale = this.unitsPerEm / lines.unitsPerEm;
    copy.ascender = lines.ascender * scale;
    copy.descender = lines.descender * scale;
    copy.lineGap = lines.lineGap * scale;
    copy.capHeight = (lines.capHeight ?? 0) * scale;
    copy.xHeight = (lines.xHeight ?? 0) * scale;
    return copy;
  }

  /** The slot of a code point, -1 when the font does not map it. */
  private slot(code: number): number {
    if (code < 128) return this.ascii[code];
    const starts = this.starts;
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] > code) high = mid - 1;
      else low = mid + 1;
    }
    if (high < 0) return -1;
    const slot = this.firstSlots[high] + code - starts[high];
    return slot < this.firstSlots[high + 1] ? slot : -1;
  }

  /** The kerning between a left and a right class, in font units. */
  private kern(left: number, right: number): number {
    if (left === 0 || right === 0) return 0;
    const rights = this.pairRights;
    let low = this.pairStarts[left - 1];
    let high = this.pairStarts[left] - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const found = rights[mid];
      if (found === right) return this.pairValues[mid];
      if (found < right) low = mid + 1;
      else high = mid - 1;
    }
    return 0;
  }

  /**
   * The pixel width the device draws `text` at `size`: each glyph's advance
   * with its kerning against the next, floored to a pixel. With `spacing`
   * every glyph is drawn on its own (the backend draws letter-spaced text a
   * glyph at a time), so there is no kerning and no ligature, and `spacing`
   * follows every glyph, as in the WebGL backend's measurement.
   */
  measure(text: string, size: number, spacing: number): number {
    const scale = scaleOf(size, this.unitsPerEm);
    const advances = this.advances;
    const ligatures = spacing === 0 ? this.ligatures : null;
    const end = text.length;
    let width = 0;
    // The glyph before: its slot (-1 when the font lacks it) and advance; -2 for none.
    let before = -2;
    let beforeUnits = 0;
    for (let i = 0; i < end; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < end) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
          i++;
        }
      }
      if (code >= 0xad && invisible(code)) continue;
      let slot = this.slot(code);
      if (ligatures !== null) {
        const candidates = ligatures.get(code);
        if (candidates !== undefined) {
          // The font's order: the first ligature whose code points all follow.
          for (let c = 0; c < candidates.length; c++) {
            const rest = candidates[c];
            const last = rest.length - 1;
            let match = i + last < end;
            for (let k = 0; match && k < last; k++) match = text.charCodeAt(i + 1 + k) === rest[k];
            if (match) {
              slot = rest[last];
              i += last;
              break;
            }
          }
        }
      }
      const units = slot < 0 ? this.missing : advances[slot];
      if (spacing !== 0) {
        width += Math.floor(fixed(units, scale) / 64) + spacing;
        continue;
      }
      if (before !== -2) {
        const kern = before >= 0 && slot >= 0 ? this.kern(this.left[before], this.right[slot]) : 0;
        width += Math.floor(fixed(beforeUnits + kern, scale) / 64);
      }
      before = slot;
      beforeUnits = units;
    }
    if (before !== -2) width += Math.floor(fixed(beforeUnits, scale) / 64);
    return width;
  }

  /** This font at `size` pixels, for text layout. */
  at(size: number): SizedFont {
    const scale = scaleOf(size, this.unitsPerEm);
    const px = size / this.unitsPerEm;
    const labelAscent = Math.ceil(fixed(this.deviceAscender, scale) / 64);
    return {
      measure: (text, spacing) => this.measure(text, size, spacing),
      metrics: {
        ascender: this.ascender * px,
        descender: this.descender * px,
        lineGap: this.lineGap * px,
        capHeight: (this.capHeight > 0 ? this.capHeight : this.ascender * CAP_HEIGHT_RATIO) * px,
        xHeight: (this.xHeight > 0 ? this.xHeight : this.ascender * X_HEIGHT_RATIO) * px,
      },
      labelAscent,
      labelLineHeight: labelAscent + Math.ceil(fixed(-this.deviceDescender, scale) / 64) + 1,
    };
  }
}
