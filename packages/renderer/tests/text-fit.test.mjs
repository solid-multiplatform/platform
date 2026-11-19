// The text-fit invariant in the renderers, independent of a device: a text's
// box is the bound it is laid out in, and the painted ink may not leave it.
// `inkExceedsBox` is what the WebGL backend uses to ask for a clip when a
// glyph's bitmap overhangs its advance by more than a pixel; the Roku layout
// cuts the lines to `maxWidth`/`maxHeight` before they reach a Label, so the
// firmware is never asked to draw outside the box.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { inkExceedsBox } = await import('../dist/webgl/src/core/text/TextLayout.js');
const { layoutText } = await import('../dist/roku/text-layout.js');

const layoutOf = (ink) => ({
  glyphCount: 1,
  inkLeft: 0,
  inkTop: 0,
  inkRight: 0,
  inkBottom: 0,
  ...ink,
});

test('ink inside the box needs no clip', () => {
  // An ordinary side bearing: a fraction of a pixel past the advance.
  assert.equal(inkExceedsBox(layoutOf({ inkRight: 100.76 }), 0, 0, 100, 20), false);
  assert.equal(inkExceedsBox(layoutOf({ inkRight: 101 }), 0, 0, 100, 20), false);
  assert.equal(inkExceedsBox(layoutOf({ inkLeft: -1 }), 0, 0, 100, 20), false);
});

test('ink past the box asks for a clip', () => {
  assert.equal(inkExceedsBox(layoutOf({ inkRight: 102 }), 0, 0, 100, 20), true);
  assert.equal(inkExceedsBox(layoutOf({ inkLeft: -2 }), 0, 0, 100, 20), true);
  assert.equal(inkExceedsBox(layoutOf({ inkBottom: 22 }), 0, 0, 100, 20), true);
  assert.equal(inkExceedsBox(layoutOf({ inkTop: -2 }), 0, 0, 100, 20), true);
  // The block's offset in a contained box counts: a centered block sits at
  // boxX, so its ink is measured from there.
  assert.equal(inkExceedsBox(layoutOf({ inkRight: 100 }), 50, 0, 100, 20), true);
  assert.equal(inkExceedsBox(layoutOf({ inkRight: 50 }), 50, 0, 100, 20), false);
});

test('empty text never asks for a clip', () => {
  assert.equal(
    inkExceedsBox({ glyphCount: 0, inkLeft: 0, inkTop: 0, inkRight: 999, inkBottom: 999 }, 0, 0, 10, 10),
    false,
  );
});

/** A 10 px per character font, one 10 px line, for the Roku layout. */
const font = {
  measure: (text, spacing) => text.length * (10 + spacing),
  metrics: { ascender: 8, descender: -2, lineGap: 0, capHeight: 7, xHeight: 5 },
  labelAscent: 8,
  labelLineHeight: 10,
};

const input = (over) => ({
  text: 'The quick brown fox jumps over the lazy dog',
  font,
  lineHeight: 1,
  maxWidth: 0,
  maxHeight: 0,
  maxLines: 0,
  textAlign: 'left',
  verticalAlign: 'top',
  contain: 'none',
  wordBreak: 'break-word',
  overflowSuffix: '...',
  letterSpacing: 0,
  offsetY: 0,
  rtl: false,
  ...over,
});

test('the Roku layout cuts a long text to maxWidth and maxHeight', () => {
  const unbounded = layoutText(input({}));
  assert.ok(unbounded.width > 100);

  const bounded = layoutText(input({ maxWidth: 100, maxHeight: 20 }));
  assert.equal(bounded.width <= 100, true);
  assert.equal(bounded.height <= 20, true);
  for (const line of bounded.lines) {
    assert.equal(line.width <= 100, true, `line ${JSON.stringify(line.text)} is ${line.width} wide`);
  }
});

test('the Roku layout with maxLines and a suffix stays inside its width', () => {
  const cut = layoutText(input({ maxWidth: 90, maxLines: 1 }));
  assert.equal(cut.lines.length, 1);
  assert.equal(cut.width <= 90, true);
  assert.equal(cut.lines[0].text.endsWith('...'), true);
});

test('a word wider than the box is split, and every line fits', () => {
  const cut = layoutText(
    input({ text: 'Supercalifragilisticexpialidocious', maxWidth: 50 }),
  );
  assert.ok(cut.lines.length > 1);
  for (const line of cut.lines) {
    assert.equal(line.width <= 50, true, `line ${JSON.stringify(line.text)} is ${line.width} wide`);
  }
});
