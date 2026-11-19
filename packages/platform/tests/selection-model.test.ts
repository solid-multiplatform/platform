/**
 * The selection model's pure functions: pointer → character index, word
 * snapping, range → one highlight segment per line, and the copied text.
 * No renderer is involved; the layout below is what a backend reports.
 */
import { describe, expect, it } from 'vitest';
import {
  charIndexAt,
  nextWordBoundary,
  rangeBounds,
  rangeSegments,
  selectedText,
  wordRangeAt,
  type SelectionLayout,
} from '../src/primitives/selectionModel.js';

/** One line of 10 px characters at x 10, y 5, with a 2 px line gap. */
function oneLine(text: string): SelectionLayout {
  const charX = Array.from({ length: text.length + 1 }, (_, i) => i * 10);
  return {
    text,
    lines: [
      {
        text,
        start: 0,
        x: 10,
        y: 5,
        width: text.length * 10,
        height: 24,
        baseline: 24,
        charX,
      },
    ],
  };
}

/** Two 10 px-character lines joined by '\n'. */
function twoLines(first: string, second: string): SelectionLayout {
  const make = (text: string, start: number, y: number) => ({
    text,
    start,
    x: 0,
    y,
    width: text.length * 10,
    height: 20,
    baseline: y + 15,
    charX: Array.from({ length: text.length + 1 }, (_, i) => i * 10),
  });
  return {
    text: `${first}\n${second}`,
    lines: [make(first, 0, 0), make(second, first.length + 1, 20)],
  };
}

describe('selection model: hit testing', () => {
  it('maps a point inside a character to that character', () => {
    const layout = oneLine('Hello world');
    expect(charIndexAt(layout, 10, 5)).toBe(0);
    expect(charIndexAt(layout, 15, 5)).toBe(0); // char 0 spans [10, 20)
    expect(charIndexAt(layout, 25, 5)).toBe(1); // char 1 spans [20, 30)
    expect(charIndexAt(layout, 119, 5)).toBe(10);
  });

  it('clamps a point left of, right of and below the text', () => {
    const layout = oneLine('Hello world');
    expect(charIndexAt(layout, -100, 5)).toBe(0);
    expect(charIndexAt(layout, 500, 5)).toBe(11);
    expect(charIndexAt(layout, 50, 500)).toBe(11);
    expect(charIndexAt(layout, 50, -500)).toBe(0);
  });

  it('uses the second line when the point is in it', () => {
    const layout = twoLines('abc', 'defgh');
    expect(charIndexAt(layout, 5, 10)).toBe(0);
    expect(charIndexAt(layout, 5, 25)).toBe(4); // line 2 starts at index 4
    expect(charIndexAt(layout, 25, 25)).toBe(6);
  });
});

describe('selection model: ranges', () => {
  it('orders and clamps the anchor and focus', () => {
    const layout = oneLine('Hello');
    expect(rangeBounds(layout, { anchor: 4, focus: 1 })).toEqual([1, 4]);
    expect(rangeBounds(layout, { anchor: -3, focus: 99 })).toEqual([0, 5]);
  });

  it('turns a range into one segment per line it touches', () => {
    const layout = twoLines('abc', 'defgh');
    // Indices 1 to 7: "bc\ndefg" — one quad per line, none for the newline.
    const segments = rangeSegments(layout, { anchor: 1, focus: 7 });
    expect(segments).toEqual([
      { x: 10, y: 0, width: 20, height: 20 },
      { x: 0, y: 20, width: 30, height: 20 },
    ]);
  });

  it('draws nothing for an empty range', () => {
    expect(rangeSegments(oneLine('Hello'), { anchor: 2, focus: 2 })).toEqual(
      [],
    );
  });

  it('copies the selected characters, with newlines between lines', () => {
    const layout = twoLines('abc', 'defgh');
    expect(selectedText(layout, { anchor: 1, focus: 7 })).toBe('bc\ndef');
    expect(selectedText(layout, { anchor: 7, focus: 1 })).toBe('bc\ndef');
  });
});

describe('selection model: words', () => {
  it('snaps a double click to the word around the character', () => {
    const layout = oneLine('Hello world');
    expect(wordRangeAt(layout, 0)).toEqual({ anchor: 0, focus: 5 });
    expect(wordRangeAt(layout, 7)).toEqual({ anchor: 6, focus: 11 });
    // A point on the space selects the word before it.
    expect(wordRangeAt(layout, 5)).toEqual({ anchor: 0, focus: 5 });
  });

  it('steps to word boundaries by whitespace', () => {
    const text = 'one two three';
    expect(nextWordBoundary(text, 0, 1)).toBe(3);
    expect(nextWordBoundary(text, 0, -1)).toBe(0);
    expect(nextWordBoundary(text, 5, 1)).toBe(7);
    expect(nextWordBoundary(text, 5, -1)).toBe(4);
    expect(nextWordBoundary(text, 13, 1)).toBe(13);
  });
});
