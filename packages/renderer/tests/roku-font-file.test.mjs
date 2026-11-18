// The build-time font reader (roku/font-file.ts) and the table it packs for
// the device (roku/font-metrics.ts), against real font files: the ones the
// device tests ship and the one a generated Roku app ships. Three sources of
// truth, none of them this code: values read with fontTools, the MSDF atlas of
// the same Lato made by msdf-bmfont (opentype.js), and what a Roku TV measured.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { parseFont, packFontMetrics, toBase64, fontMetricsBase64, FONT_METRICS_VERSION } = await import('../dist/roku/font-file.js');
const { FontMetrics } = await import('../dist/roku/font-metrics.js');

const platform = new URL('../../platform/', import.meta.url);
const bytes = (file) => new Uint8Array(readFileSync(fileURLToPath(new URL(file, platform))));
const FILES = {
  regular: 'tests/roku-device/fonts/Roboto-Regular.ttf',
  bold: 'tests/roku-device/fonts/Roboto-Bold.ttf',
  raleway: 'tests/roku-device/fonts/Raleway-ExtraBold.ttf',
  onest: 'tests/roku-device/fonts/Onest-Regular.ttf',
  lato: 'cli/templates/roku/fonts/Lato-Regular.ttf',
};
const parsed = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, parseFont(bytes(file))]));
const tables = Object.fromEntries(Object.entries(parsed).map(([key, font]) => [key, FontMetrics.decode(packFontMetrics(font))]));

/** The advance of a character, through the font's cmap. */
const advance = (font, char) => font.advances[font.glyphs[font.codes.indexOf(char.codePointAt(0))]];
const glyph = (font, char) => font.glyphs[font.codes.indexOf(char.codePointAt(0))];

// Read from the files with fontTools 4.68 (head, hhea, OS/2, hmtx through the best cmap).
const KNOWN = {
  regular: { upem: 2048, typo: [1536, -512, 102], hhea: [1900, -500], cap: 1456, x: 1082, codes: 896, adv: { A: 1336, ' ': 507, W: 1817, i: 497, '.': 539, 0: 1150, g: 1149, '€': 1150 } },
  bold: { upem: 2048, typo: [1536, -512, 102], hhea: [1900, -500], cap: 1456, x: 1082, codes: 927, adv: { A: 1376, ' ': 509, W: 1792, i: 542, '.': 594, 0: 1175, g: 1170, '€': 1175 } },
  raleway: { upem: 1000, typo: [940, -234, 0], hhea: [940, -234], cap: 710, x: 519, codes: 231, adv: { A: 670, ' ': 233, W: 1055, i: 270, '.': 239, 0: 614, g: 640, '€': 800 } },
  onest: { upem: 1000, typo: [970, -305, 0], hhea: [970, -305], cap: 707, x: 527, codes: 223, adv: { A: 670, ' ': 270, W: 983, i: 219, '.': 254, 0: 665, g: 604, '€': 679 } },
  lato: { upem: 2000, typo: [1610, -390, 400], hhea: [1974, -426], cap: 1433, x: 1013, codes: 263, adv: { A: 1360, ' ': 386, W: 2038, i: 512, '.': 424, 0: 1160, g: 1022, '€': 1160 } },
};

for (const [key, known] of Object.entries(KNOWN)) {
  test(`${FILES[key]}: head, OS/2, hhea, cmap and hmtx read as fontTools reads them`, () => {
    const font = parsed[key];
    assert.equal(font.unitsPerEm, known.upem);
    // Layout takes the OS/2 typo metrics (the MSDF generator's choice), the device model hhea's.
    assert.deepEqual([font.ascender, font.descender, font.lineGap], known.typo);
    assert.deepEqual([font.deviceAscender, font.deviceDescender], known.hhea);
    assert.deepEqual([font.capHeight, font.xHeight], [known.cap, known.x]);
    assert.equal(font.codes.length, known.codes);
    for (const [char, units] of Object.entries(known.adv)) assert.equal(advance(font, char), units, 'advance of ' + JSON.stringify(char));
    // Code points ascend, and none maps to the missing glyph.
    assert.ok(font.codes.every((code, i) => i === 0 || code > font.codes[i - 1]));
    assert.ok(font.glyphs.every((id) => id > 0));
  });
}

test('Lato: every advance and every kerning pair equals the MSDF atlas of the same font', () => {
  // The atlas the WebGL tests and generated apps load (msdf-bmfont, through opentype.js): an independent reader of this font.
  const atlas = JSON.parse(readFileSync(fileURLToPath(new URL('tests/webgl/fonts/Lato-Regular.msdf.json', platform)), 'utf8'));
  const font = parsed.lato;
  const units = (value) => (value * font.unitsPerEm) / atlas.info.size;
  assert.deepEqual(atlas.lightningMetrics, { ascender: font.ascender, descender: font.descender, lineGap: font.lineGap, unitsPerEm: font.unitsPerEm });
  for (const char of atlas.chars) {
    const at = font.codes.indexOf(char.id);
    assert.ok(at >= 0, 'the font maps U+' + char.id.toString(16));
    assert.ok(Math.abs(units(char.xadvance) - font.advances[font.glyphs[at]]) < 0.01, 'advance of U+' + char.id.toString(16));
  }
  assert.equal(atlas.kernings.length, 1427);
  const listed = new Set();
  for (const pair of atlas.kernings) {
    listed.add(pair.first + ',' + pair.second);
    const got = font.kern(font.glyphs[font.codes.indexOf(pair.first)], font.glyphs[font.codes.indexOf(pair.second)]);
    assert.ok(Math.abs(units(pair.amount) - got) < 0.01, `kerning of U+${pair.first.toString(16)} U+${pair.second.toString(16)}`);
  }
  // And no pair of the atlas's characters kerns here that the atlas does not list.
  for (const a of atlas.chars) {
    for (const b of atlas.chars) {
      if (listed.has(a.id + ',' + b.id)) continue;
      assert.equal(font.kern(font.glyphs[font.codes.indexOf(a.id)], font.glyphs[font.codes.indexOf(b.id)]), 0);
    }
  }
});

test('kerning comes from GPOS and ligatures from GSUB', () => {
  const { regular, raleway, onest } = parsed;
  // Roboto kerns T against o, and not H against H.
  assert.ok(regular.kern(glyph(regular, 'T'), glyph(regular, 'o')) < -50);
  assert.equal(regular.kern(glyph(regular, 'H'), glyph(regular, 'H')), 0);
  assert.equal(regular.kerns(glyph(regular, 'T')), true);
  // fi, fl, ffi and ffl in Roboto; Raleway adds ff.
  const names = (font) => font.ligatures.map((l) => l.components.map((id) => String.fromCodePoint(font.codes[font.glyphs.indexOf(id)])).join(''));
  assert.deepEqual(names(regular).sort(), ['ffi', 'ffl', 'fi', 'fl']);
  assert.deepEqual(names(raleway).sort(), ['ff', 'ffi', 'ffl', 'fi', 'fl']);
  assert.deepEqual(names(onest), []);
});

test('the packed table is small and reads back to the same widths', () => {
  for (const [key, font] of Object.entries(parsed)) {
    const packed = packFontMetrics(font);
    assert.equal(new DataView(packed.buffer).getUint16(0, true), FONT_METRICS_VERSION);
    // A few kilobytes per font: ranges and class kerning, not an entry per glyph pair.
    assert.ok(packed.length < 12 * 1024, `${key} packs to ${packed.length} bytes`);
    const fromBytes = FontMetrics.decode(packed);
    const fromText = FontMetrics.decode(toBase64(packed));
    for (const text of ['Hello World', 'AVATAR To WAVE', 'office fi fl ffi', 'éüñ €']) {
      assert.equal(fromBytes.measure(text, 32, 0), fromText.measure(text, 32, 0));
      // Without kerning or ligatures (a 1000 px spacing taken off again) the width is the sum of the floored advances.
      let alone = 0;
      for (const char of text) alone += Math.floor((advance(font, char) * 32) / font.unitsPerEm);
      assert.equal(fromBytes.measure(text, 32, 1000) - [...text].length * 1000, alone, key + ' ' + text);
    }
  }
  assert.equal(fontMetricsBase64(bytes(FILES.lato)), toBase64(packFontMetrics(parsed.lato)));
});

test('line metrics at a size: the scene\'s from OS/2 typo, the Label\'s from hhea', () => {
  const at = tables.regular.at(32);
  // 1536, -512 and 102 of 2048 at 32 px; cap and x heights from OS/2.
  assert.deepEqual(at.metrics, { ascender: 24, descender: -8, lineGap: 1.59375, capHeight: 22.75, xHeight: 16.90625 });
  // hhea 1900 and -500: ceil(29.69) and ceil(7.81), and one more pixel between lines.
  assert.deepEqual([at.labelAscent, at.labelLineHeight], [30, 39]);
  // An app's own line metrics (as for the WebGL backend) change the layout's lines, not the Label's.
  const tuned = tables.regular.withLineMetrics({ ascender: 1000, descender: -100, lineGap: 0, unitsPerEm: 1000 }).at(32);
  assert.deepEqual([tuned.metrics.ascender, tuned.metrics.descender, tuned.metrics.lineGap], [32, -3.2, 0]);
  // No cap or x height given: the WebGL backend's ratios of the ascender.
  assert.deepEqual([tuned.metrics.capHeight, tuned.metrics.xHeight], [32 * 0.7, 32 * 0.5]);
  assert.deepEqual([tuned.labelAscent, tuned.labelLineHeight], [30, 39]);
  assert.equal(tuned.measure('Hello', 0), at.measure('Hello', 0));
});

test('widths equal what a Roku TV measures with getFontMeasure()', () => {
  // Recorded on a Roku TV (Roku OS 16.0.4) by tests/roku-device/run-text.mjs.
  const tv = JSON.parse(readFileSync(new URL('./fixtures/roku-tv-measurements.json', import.meta.url), 'utf8'));
  let count = 0;
  let exact = 0;
  for (const [key, sizes] of Object.entries(tv.fonts)) {
    for (const [size, got] of Object.entries(sizes)) {
      const at = tables[key].at(Number(size));
      assert.deepEqual([at.labelAscent, at.labelLineHeight], [got.ascent, got.lineHeight], `${key} ${size}: ascent and line height`);
      tv.strings.forEach((text, i) => {
        const width = at.measure(text, 0);
        count++;
        if (width === got.widths[i]) exact++;
        assert.ok(Math.abs(width - got.widths[i]) <= 1, `${key} ${size} ${JSON.stringify(text)}: ${width}, the TV says ${got.widths[i]}`);
      });
    }
  }
  assert.equal(count, 225);
  // One string of the 225 is a pixel off (a kerning pair the firmware rounds the other way).
  assert.ok(exact >= 224, `${exact} of ${count} widths are exact`);
});

test('characters the font lacks, invisible characters and surrogate pairs', () => {
  const table = tables.regular;
  const missing = Math.floor((908 * 32) / 2048); // the .notdef advance
  // CJK is not in Roboto: each character takes the missing glyph's advance.
  assert.equal(table.measure('中文', 32, 0), missing * 2);
  // One code point outside the BMP is one glyph, not two.
  assert.equal(table.measure('😀', 32, 0), missing);
  // Zero-width space and joiners, soft hyphen, BOM, word joiner: no width.
  assert.equal(table.measure('a​‌‍­﻿⁠b', 32, 0), table.measure('ab', 32, 0));
  assert.equal(table.measure('', 32, 0), 0);
});

test('files that are not single fonts are refused with a reason', () => {
  assert.throws(() => parseFont(new TextEncoder().encode('ttcf' + '\0'.repeat(64))), /collections/);
  assert.throws(() => parseFont(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), /not a TrueType or OpenType font/);
  assert.throws(() => FontMetrics.decode(new Uint8Array(64)), /font metrics/);
});
