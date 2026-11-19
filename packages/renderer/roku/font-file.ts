/**
 * Reads a TrueType/OpenType font file and packs what text layout needs into
 * the table font-metrics.ts reads on the device. This runs at BUILD time (the
 * platform's Roku preset calls it for every imported `.ttf`/`.otf`); nothing
 * on the device imports it.
 *
 * Roku shapes text with the font's own tables: glyph advances from `hmtx`,
 * pair kerning from GPOS (`kern` feature) or the legacy `kern` table, and the
 * standard ligatures of GSUB (`liga`). Those three are read here. Anything
 * else a font can do (contextual alternates, mark positioning, complex
 * scripts) is not, and such text measures by advances alone.
 */

/** A font file's layout data, in font design units and glyph ids. */
export interface ParsedFont {
  unitsPerEm: number;
  /**
   * The line metrics text is laid out with: the OS/2 typographic ascender,
   * descender (negative) and line gap, which is what the MSDF generator
   * writes into an atlas for the WebGL backend, so a font's lines are as
   * tall on both. hhea's when the font has no OS/2 typo metrics.
   */
  ascender: number;
  descender: number;
  lineGap: number;
  /**
   * hhea's ascender and descender: what the device itself places glyphs by
   * (measured on Roku OS 16, also for a font that sets USE_TYPO_METRICS).
   */
  deviceAscender: number;
  deviceDescender: number;
  /** OS/2 sCapHeight and sxHeight; 0 when the font has none. */
  capHeight: number;
  xHeight: number;
  /** Code points in ascending order and the glyph each maps to. */
  codes: number[];
  glyphs: number[];
  /** Advance width per glyph id. */
  advances: Uint16Array;
  /** The kerning between two glyphs. */
  kern(left: number, right: number): number;
  /** Whether `left` kerns with anything: most glyphs of a large font do not. */
  kerns(left: number): boolean;
  /** Standard ligatures: the glyphs replaced and the glyph that replaces them, in the font's order. */
  ligatures: { components: number[]; glyph: number }[];
}

const tag = (d: DataView, at: number) =>
  String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));

/** The font's tables by tag: each a view of its bytes. */
function tables(bytes: Uint8Array): Map<string, DataView> {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = tag(d, 0);
  if (version === 'ttcf') throw new Error('font collections (.ttc) are not supported: use a single-font file');
  if (version !== '\u0000\u0001\u0000\u0000' && version !== 'OTTO' && version !== 'true')
    throw new Error('not a TrueType or OpenType font file');
  const found = new Map<string, DataView>();
  const count = d.getUint16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    found.set(tag(d, at), new DataView(bytes.buffer, bytes.byteOffset + d.getUint32(at + 8), d.getUint32(at + 12)));
  }
  return found;
}

/** The Unicode character map: format 12 when the font has one, else format 4. */
function readCmap(d: DataView): Map<number, number> {
  let best = -1;
  let bestRank = 0;
  for (let i = 0; i < d.getUint16(2); i++) {
    const platform = d.getUint16(4 + i * 8);
    const encoding = d.getUint16(6 + i * 8);
    const at = d.getUint32(8 + i * 8);
    const format = d.getUint16(at);
    let rank = 0;
    if (format === 12 && ((platform === 3 && encoding === 10) || platform === 0)) rank = platform === 3 ? 4 : 3;
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) rank = platform === 3 ? 2 : 1;
    if (rank > bestRank) {
      bestRank = rank;
      best = at;
    }
  }
  if (best < 0) throw new Error('the font has no Unicode cmap (format 4 or 12)');
  const map = new Map<number, number>();
  if (d.getUint16(best) === 12) {
    const groups = d.getUint32(best + 12);
    for (let g = 0; g < groups; g++) {
      const at = best + 16 + g * 12;
      const first = d.getUint32(at);
      const last = d.getUint32(at + 4);
      const glyph = d.getUint32(at + 8);
      for (let code = first; code <= last; code++) if (glyph + code - first !== 0) map.set(code, glyph + code - first);
    }
    return map;
  }
  const segments = d.getUint16(best + 6) / 2;
  const ends = best + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const offsets = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const first = d.getUint16(starts + s * 2);
    const last = d.getUint16(ends + s * 2);
    const delta = d.getUint16(deltas + s * 2);
    const offset = d.getUint16(offsets + s * 2);
    for (let code = first; code <= last && code !== 0xffff; code++) {
      let glyph: number;
      if (offset === 0) glyph = (code + delta) & 0xffff;
      else {
        glyph = d.getUint16(offsets + s * 2 + offset + (code - first) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(code, glyph);
    }
  }
  return map;
}

/**
 * The lookups a feature uses for text without a language: those of the
 * feature in each script's default language system, in lookup order. A font
 * whose scripts kern differently gets the union, which is right as long as
 * their lookups cover different glyphs (the usual case).
 */
function featureLookups(d: DataView, feature: string): number[] {
  const scripts = d.getUint16(4);
  const features = d.getUint16(6);
  const used = new Set<number>();
  const take = (index: number) => {
    if (index === 0xffff || tag(d, features + 2 + index * 6) !== feature) return;
    const at = features + d.getUint16(features + 6 + index * 6);
    for (let i = 0; i < d.getUint16(at + 2); i++) used.add(d.getUint16(at + 4 + i * 2));
  };
  for (let s = 0; s < d.getUint16(scripts); s++) {
    const script = scripts + d.getUint16(scripts + 6 + s * 6);
    const fallback = d.getUint16(script);
    if (fallback === 0) continue;
    const system = script + fallback;
    take(d.getUint16(system + 2));
    for (let i = 0; i < d.getUint16(system + 4); i++) take(d.getUint16(system + 6 + i * 2));
  }
  return Array.from(used).sort((a, b) => a - b);
}

/** A lookup's subtables as [type, offset], with extension subtables resolved. */
function subtables(d: DataView, lookup: number, extension: number): [number, number][] {
  const list = d.getUint16(8);
  const at = list + d.getUint16(list + 2 + lookup * 2);
  const type = d.getUint16(at);
  const found: [number, number][] = [];
  for (let i = 0; i < d.getUint16(at + 4); i++) {
    const sub = at + d.getUint16(at + 6 + i * 2);
    if (type === extension) found.push([d.getUint16(sub + 2), sub + d.getUint32(sub + 4)]);
    else found.push([type, sub]);
  }
  return found;
}

/** A Coverage table: the glyphs covered, in coverage order. */
function coverage(d: DataView, at: number): number[] {
  const glyphs: number[] = [];
  const count = d.getUint16(at + 2);
  if (d.getUint16(at) === 1) {
    for (let i = 0; i < count; i++) glyphs.push(d.getUint16(at + 4 + i * 2));
  } else {
    for (let i = 0; i < count; i++) {
      const last = d.getUint16(at + 6 + i * 6);
      for (let glyph = d.getUint16(at + 4 + i * 6); glyph <= last; glyph++) glyphs.push(glyph);
    }
  }
  return glyphs;
}

/** A ClassDef table: glyph to class, class 0 for a glyph that is not listed. */
function classes(d: DataView, at: number): Map<number, number> {
  const map = new Map<number, number>();
  if (d.getUint16(at) === 1) {
    const first = d.getUint16(at + 2);
    for (let i = 0; i < d.getUint16(at + 4); i++) map.set(first + i, d.getUint16(at + 6 + i * 2));
  } else {
    for (let i = 0; i < d.getUint16(at + 2); i++) {
      const last = d.getUint16(at + 6 + i * 6);
      const value = d.getUint16(at + 8 + i * 6);
      for (let glyph = d.getUint16(at + 4 + i * 6); glyph <= last; glyph++) map.set(glyph, value);
    }
  }
  return map;
}

const bits = (n: number) => {
  let count = 0;
  for (let v = n & 0xff; v !== 0; v >>= 1) count += v & 1;
  return count;
};

/** One PairPos subtable: the first glyphs it covers and its adjustment for a pair, undefined when it has none. */
interface PairTable {
  covers: Set<number>;
  value(left: number, right: number): number | undefined;
}

/** The GPOS pair adjustments of the `kern` feature, as one list of subtables per lookup. */
function gposKerning(d: DataView): PairTable[][] {
  const lookups: PairTable[][] = [];
  for (const lookup of featureLookups(d, 'kern')) {
    const pairs: PairTable[] = [];
    for (const [type, at] of subtables(d, lookup, 9)) {
      if (type !== 2) continue;
      const covered = coverage(d, at + d.getUint16(at + 2));
      const format1 = d.getUint16(at + 4);
      const format2 = d.getUint16(at + 6);
      const size1 = bits(format1) * 2;
      const size = size1 + bits(format2) * 2;
      // The x advance of each value record, when it has one.
      const advance = (record: number) =>
        (format1 & 4 ? d.getInt16(record + bits(format1 & 3) * 2) : 0) +
        (format2 & 4 ? d.getInt16(record + size1 + bits(format2 & 3) * 2) : 0);
      if (d.getUint16(at) === 1) {
        const sets = new Map<number, Map<number, number>>();
        covered.forEach((glyph, i) => {
          const set = at + d.getUint16(at + 10 + i * 2);
          const seconds = new Map<number, number>();
          for (let p = 0; p < d.getUint16(set); p++) {
            const record = set + 2 + p * (2 + size);
            seconds.set(d.getUint16(record), advance(record + 2));
          }
          sets.set(glyph, seconds);
        });
        pairs.push({ covers: new Set(covered), value: (left, right) => sets.get(left)?.get(right) });
      } else {
        const first = classes(d, at + d.getUint16(at + 8));
        const second = classes(d, at + d.getUint16(at + 10));
        const count2 = d.getUint16(at + 14);
        // Once the first glyph is covered this subtable ends the lookup, with 0 for a pair it does not move.
        pairs.push({
          covers: new Set(covered),
          value: (left, right) => advance(at + 16 + ((first.get(left) ?? 0) * count2 + (second.get(right) ?? 0)) * size),
        });
      }
    }
    if (pairs.length > 0) lookups.push(pairs);
  }
  return lookups;
}

/** The pairs of the legacy `kern` table (format 0, horizontal), keyed left * 65536 + right. */
function kernTable(d: DataView): Map<number, number> {
  const pairs = new Map<number, number>();
  if (d.getUint16(0) !== 0) return pairs;
  let at = 4;
  for (let t = 0; t < d.getUint16(2); t++) {
    const coverageBits = d.getUint16(at + 4);
    const count = d.getUint16(at + 6);
    // Horizontal kerning values only: not minimums, not cross-stream.
    if (coverageBits >> 8 === 0 && (coverageBits & 7) === 1) {
      for (let p = 0; p < count; p++) {
        const record = at + 14 + p * 6;
        const key = d.getUint16(record) * 65536 + d.getUint16(record + 2);
        pairs.set(key, (pairs.get(key) ?? 0) + d.getInt16(record + 4));
      }
    }
    // A format 0 subtable can outgrow its 16-bit length field: step by its pairs.
    at += coverageBits >> 8 === 0 ? 14 + count * 6 : d.getUint16(at + 2);
  }
  return pairs;
}

/** The ligature substitutions of GSUB's `liga` feature. */
function gsubLigatures(d: DataView): { components: number[]; glyph: number }[] {
  const found: { components: number[]; glyph: number }[] = [];
  for (const lookup of featureLookups(d, 'liga')) {
    for (const [type, at] of subtables(d, lookup, 7)) {
      if (type !== 4 || d.getUint16(at) !== 1) continue;
      coverage(d, at + d.getUint16(at + 2)).forEach((first, i) => {
        const set = at + d.getUint16(at + 6 + i * 2);
        for (let l = 0; l < d.getUint16(set); l++) {
          const ligature = set + d.getUint16(set + 2 + l * 2);
          const components = [first];
          for (let c = 1; c < d.getUint16(ligature + 2); c++) components.push(d.getUint16(ligature + 2 + c * 2));
          found.push({ components, glyph: d.getUint16(ligature) });
        }
      });
    }
  }
  return found;
}

export function parseFont(bytes: Uint8Array): ParsedFont {
  const table = tables(bytes);
  const need = (name: string) => {
    const found = table.get(name);
    if (!found) throw new Error('the font has no ' + name + ' table');
    return found;
  };
  const head = need('head');
  const hhea = need('hhea');
  const hmtx = need('hmtx');
  const os2 = table.get('OS/2');
  const glyphCount = need('maxp').getUint16(4);

  const typo = os2 !== undefined && os2.byteLength >= 78 && (os2.getInt16(68) !== 0 || os2.getInt16(70) !== 0);
  let deviceAscender = hhea.getInt16(4);
  let deviceDescender = hhea.getInt16(6);
  // A font whose hhea is empty: FreeType takes OS/2's typo metrics, then its win metrics.
  if (deviceAscender === 0 && deviceDescender === 0 && os2 && os2.byteLength >= 78) {
    deviceAscender = typo ? os2.getInt16(68) : os2.getUint16(74);
    deviceDescender = typo ? os2.getInt16(70) : -os2.getUint16(76);
  }
  const ascender = typo ? os2!.getInt16(68) : deviceAscender;
  const descender = typo ? os2!.getInt16(70) : deviceDescender;
  const lineGap = typo ? os2!.getInt16(72) : hhea.getInt16(8);
  const tall = os2 !== undefined && os2.getUint16(0) >= 2 && os2.byteLength >= 90;

  const advances = new Uint16Array(glyphCount);
  const measured = hhea.getUint16(34);
  for (let glyph = 0; glyph < glyphCount; glyph++) advances[glyph] = hmtx.getUint16(Math.min(glyph, measured - 1) * 4);

  const map = readCmap(need('cmap'));
  const codes = Array.from(map.keys()).sort((a, b) => a - b);

  const gpos = table.get('GPOS');
  const lookups = gpos ? gposKerning(gpos) : [];
  const kern = table.get('kern');
  const legacy = lookups.length === 0 && kern ? kernTable(kern) : null;
  const firsts = new Set<number>();
  if (legacy) legacy.forEach((_value, pair) => firsts.add(Math.floor(pair / 65536)));
  const gsub = table.get('GSUB');

  return {
    unitsPerEm: head.getUint16(18),
    ascender,
    descender,
    lineGap,
    deviceAscender,
    deviceDescender,
    capHeight: tall ? os2.getInt16(88) : 0,
    xHeight: tall ? os2.getInt16(86) : 0,
    codes,
    glyphs: codes.map((code) => map.get(code)!),
    advances,
    kern(left, right) {
      if (legacy) return legacy.get(left * 65536 + right) ?? 0;
      let total = 0;
      for (const lookup of lookups) {
        for (const pairs of lookup) {
          if (!pairs.covers.has(left)) continue;
          const value = pairs.value(left, right);
          if (value === undefined) continue;
          total += value;
          break;
        }
      }
      return total;
    },
    kerns: (left) => (legacy ? firsts.has(left) : lookups.some((lookup) => lookup.some((pairs) => pairs.covers.has(left)))),
    ligatures: gsub ? gsubLigatures(gsub) : [],
  };
}

/** Format version of {@link packFontMetrics}; font-metrics.ts reads the same number. */
export const FONT_METRICS_VERSION = 1;

/**
 * Packs a font for the device (little-endian), keyed by code point so the
 * device needs no glyph ids:
 *
 *   u16 x 20   version, unitsPerEm, ascender, descender, lineGap, capHeight,
 *              xHeight, missing-glyph advance, range count, code slots,
 *              slots, left classes, right classes, ligature words (2 x u16),
 *              class width in bytes, kerning pairs (2 x u16), the device's
 *              ascender and descender
 *   ranges     u32 first code point + u16 count, per run of consecutive codes
 *   advances   u16 per slot: one slot per mapped code point, in code order,
 *              then one per ligature glyph
 *   classes    left class then right class per slot (u8, or u16 above 255);
 *              class 0 kerns with nothing
 *   kerning    u16 pair count per left class (1 and up), then the pairs in
 *              that order: u16 right class + i16 value, right class ascending
 *   ligatures  u32 words: length n, n code points, slot of the ligature glyph
 *
 * Kerning is stored by class: glyphs that kern alike on the left share a
 * row, on the right a column, and only pairs that move are listed. That is
 * how fonts store it too, so the table stays near the size of the font's own
 * kerning instead of one entry per glyph pair.
 */
export function packFontMetrics(font: ParsedFont): Uint8Array {
  const codeSlots = font.codes.length;
  // The lowest code point of each glyph, to name a ligature's components.
  const codeOf = new Map<number, number>();
  for (let i = codeSlots - 1; i >= 0; i--) codeOf.set(font.glyphs[i], font.codes[i]);

  const slotGlyphs = font.glyphs.slice();
  const ligatureSlot = new Map<number, number>();
  const ligatureWords: number[] = [];
  for (const ligature of font.ligatures) {
    if (!ligature.components.every((glyph) => codeOf.has(glyph))) continue;
    let slot = ligatureSlot.get(ligature.glyph);
    if (slot === undefined) {
      slot = slotGlyphs.length;
      slotGlyphs.push(ligature.glyph);
      ligatureSlot.set(ligature.glyph, slot);
    }
    ligatureWords.push(ligature.components.length, ...ligature.components.map((glyph) => codeOf.get(glyph)!), slot);
  }
  const slots = slotGlyphs.length;
  if (slots > 0xffff) throw new Error('the font maps more than 65535 glyphs');

  // Rows that are equal become one left class, then columns one right class.
  const key = (values: Int16Array) => String.fromCharCode(...new Uint16Array(values.buffer));
  const rowClass = new Map<string, number>();
  const rows: Int16Array[] = [];
  const left = new Uint16Array(slots);
  const row = new Int16Array(slots);
  for (let l = 0; l < slots; l++) {
    if (!font.kerns(slotGlyphs[l])) continue;
    let any = false;
    for (let r = 0; r < slots; r++) {
      row[r] = font.kern(slotGlyphs[l], slotGlyphs[r]);
      if (row[r] !== 0) any = true;
    }
    if (!any) continue;
    const k = key(row);
    let found = rowClass.get(k);
    if (found === undefined) {
      rows.push(row.slice());
      found = rows.length;
      rowClass.set(k, found);
    }
    left[l] = found;
  }
  const columnClass = new Map<string, number>();
  const columns: Int16Array[] = [];
  const right = new Uint16Array(slots);
  const column = new Int16Array(rows.length);
  for (let r = 0; r < slots; r++) {
    let any = false;
    for (let l = 0; l < rows.length; l++) {
      column[l] = rows[l][r];
      if (column[l] !== 0) any = true;
    }
    if (!any) continue;
    const k = key(column);
    let found = columnClass.get(k);
    if (found === undefined) {
      columns.push(column.slice());
      found = columns.length;
      columnClass.set(k, found);
    }
    right[r] = found;
  }

  const ranges: [number, number][] = [];
  for (let i = 0; i < codeSlots; i++) {
    const last = ranges[ranges.length - 1];
    if (last && last[0] + last[1] === font.codes[i] && last[1] < 0xffff) last[1]++;
    else ranges.push([font.codes[i], 1]);
  }

  // Per left class, the right classes it kerns with and by how much.
  const pairs: number[][] = rows.map((_row, l) => {
    const list: number[] = [];
    columns.forEach((values, r) => {
      if (values[l] !== 0) list.push(r + 1, values[l]);
    });
    return list;
  });
  const pairCount = pairs.reduce((sum, list) => sum + list.length / 2, 0);

  const wide = rows.length + 1 > 255 || columns.length + 1 > 255 ? 2 : 1;
  const size =
    40 + ranges.length * 6 + slots * 2 + slots * wide * 2 + rows.length * 2 + pairCount * 4 + ligatureWords.length * 4;
  const out = new DataView(new ArrayBuffer(size));
  [
    FONT_METRICS_VERSION,
    font.unitsPerEm,
    font.ascender,
    font.descender,
    font.lineGap,
    font.capHeight,
    font.xHeight,
    font.advances[0] ?? 0,
    ranges.length,
    codeSlots,
    slots,
    rows.length + 1,
    columns.length + 1,
    ligatureWords.length & 0xffff,
    ligatureWords.length >>> 16,
    wide,
    pairCount & 0xffff,
    pairCount >>> 16,
    font.deviceAscender,
    font.deviceDescender,
  ].forEach((value, i) => out.setUint16(i * 2, value & 0xffff, true));
  let at = 40;
  for (const [first, count] of ranges) {
    out.setUint32(at, first, true);
    out.setUint16(at + 4, count, true);
    at += 6;
  }
  for (let s = 0; s < slots; s++, at += 2) out.setUint16(at, font.advances[slotGlyphs[s]], true);
  for (const list of [left, right]) {
    for (let s = 0; s < slots; s++, at += wide) {
      if (wide === 2) out.setUint16(at, list[s], true);
      else out.setUint8(at, list[s]);
    }
  }
  for (const list of pairs) {
    out.setUint16(at, list.length / 2, true);
    at += 2;
  }
  for (const list of pairs) {
    for (let i = 0; i < list.length; i += 2, at += 4) {
      out.setUint16(at, list[i], true);
      out.setInt16(at + 2, list[i + 1], true);
    }
  }
  for (const word of ligatureWords) {
    out.setUint32(at, word, true);
    at += 4;
  }
  return new Uint8Array(out.buffer);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 text of `bytes`: how the packed table travels inside the app's JavaScript. */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    text += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)];
    text += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=';
    text += i + 2 < bytes.length ? BASE64[c & 63] : '=';
  }
  return text;
}

/** The packed, base64 metrics of a font file: what the Roku preset ships beside its `pkg:/fonts/...` URI. */
export function fontMetricsBase64(bytes: Uint8Array): string {
  return toBase64(packFontMetrics(parseFont(bytes)));
}
