/**
 * Text selection geometry, independent of the renderer.
 *
 * A backend reports the lines it laid out — each line's text, its box in the
 * text block, and the x of every character boundary — as a
 * {@link SelectionLayout}. Everything here works on that report: turning a
 * pointer into a character index, expanding to words, and turning a range
 * into the line segments a highlight draws. The functions allocate only the
 * result; a selection change is a user gesture, never a frame.
 */

/** A laid-out line of selectable text. */
export interface SelectionLine {
  /** The text of the line, without its line separator. */
  text: string;
  /** The index of `text[0]` in `SelectionLayout.text`. */
  start: number;
  /** The line box's left edge, local to the text block. */
  x: number;
  /** The line box's top, local to the text block. */
  y: number;
  /** The line's advance width, in pixels. */
  width: number;
  /** The line box's height, in pixels. */
  height: number;
  /** The line's baseline, local to the text block. */
  baseline: number;
  /**
   * The x of each character boundary, relative to `x`: `charX[0]` is 0 and
   * `charX[text.length]` is the line's advance. Length `text.length + 1`.
   */
  charX: number[];
}

/** What a text backend reports for selection. */
export interface SelectionLayout {
  /** The lines joined by `\n`, the string a selection copies. */
  text: string;
  lines: SelectionLine[];
}

/** A highlight rectangle, local to the text block. */
export interface SelectionSegment {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An anchor and a moving end; either may be before the other. */
export interface SelectionRange {
  anchor: number;
  focus: number;
}

/** The range's start and end, ordered and clamped to `layout.text`. */
export function rangeBounds(
  layout: SelectionLayout,
  range: SelectionRange,
): [number, number] {
  const length = layout.text.length;
  const a = Math.max(0, Math.min(length, range.anchor));
  const b = Math.max(0, Math.min(length, range.focus));
  return a <= b ? [a, b] : [b, a];
}

/**
 * The character index nearest `(x, y)` in the text block. Points outside the
 * block snap to the nearest line and the nearest end, as a drag that leaves
 * the box extends to it.
 */
export function charIndexAt(
  layout: SelectionLayout,
  x: number,
  y: number,
): number {
  const lines = layout.lines;
  if (lines.length === 0) {
    return 0;
  }
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  // Outside the block above or below: the nearest end, as a drag that
  // leaves the box extends to it.
  if (y < first.y) {
    return first.start;
  }
  if (y >= last.y + last.height) {
    return last.start + last.text.length;
  }
  let line = first;
  for (let i = 0; i < lines.length; i++) {
    const candidate = lines[i]!;
    line = candidate;
    if (y < candidate.y + candidate.height) {
      break;
    }
  }
  const localX = x - line.x;
  if (localX <= 0) {
    return line.start;
  }
  const charX = line.charX;
  const lineLength = line.text.length;
  if (localX >= charX[lineLength]!) {
    return line.start + lineLength;
  }
  // charX is non-decreasing: find the last boundary at or before the point.
  let low = 0;
  let high = lineLength;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (charX[mid]! <= localX) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return line.start + low;
}

/**
 * The word around `index`: the run of non-whitespace characters. A point on
 * whitespace selects the word before it (the line start when there is none).
 */
export function wordRangeAt(
  layout: SelectionLayout,
  index: number,
): SelectionRange {
  const text = layout.text;
  const length = text.length;
  let i = Math.max(0, Math.min(length, index));
  if (i === length) {
    i = length - 1;
  }
  if (i < 0) {
    return { anchor: 0, focus: 0 };
  }
  const isWord = (at: number): boolean => !/\s/.test(text.charAt(at));
  while (i > 0 && !isWord(i)) {
    i--;
  }
  let start = i;
  let end = i;
  while (start > 0 && isWord(start - 1)) {
    start--;
  }
  if (end < length && isWord(end)) {
    while (end < length && isWord(end)) {
      end++;
    }
  } else {
    // Whitespace with no word before it: select the run itself.
    start = end;
    while (end < length && !isWord(end)) {
      end++;
    }
  }
  return { anchor: start, focus: end };
}

/**
 * The next word boundary from `index` in `direction` (-1 or 1): character
 * steps skip one character, word steps skip the whitespace then the word.
 */
export function nextWordBoundary(
  text: string,
  index: number,
  direction: -1 | 1,
): number {
  const length = text.length;
  let i = Math.max(0, Math.min(length, index));
  if (direction < 0) {
    while (i > 0 && /\s/.test(text.charAt(i - 1))) i--;
    while (i > 0 && !/\s/.test(text.charAt(i - 1))) i--;
    return i;
  }
  while (i < length && /\s/.test(text.charAt(i))) i++;
  while (i < length && !/\s/.test(text.charAt(i))) i++;
  return i;
}

/**
 * One rectangle per line the range touches. A range that starts or ends in a
 * line separator draws nothing for that separator, so a selection spanning
 * lines is one quad per line, not one per glyph.
 */
export function rangeSegments(
  layout: SelectionLayout,
  range: SelectionRange,
): SelectionSegment[] {
  const [from, to] = rangeBounds(layout, range);
  if (from === to) {
    return [];
  }
  const segments: SelectionSegment[] = [];
  const lines = layout.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineEnd = line.start + line.text.length;
    const start = Math.max(from, line.start);
    const end = Math.min(to, lineEnd);
    if (end <= start) {
      continue;
    }
    const x1 = line.charX[start - line.start]!;
    const x2 = line.charX[end - line.start]!;
    if (x2 > x1) {
      segments.push({
        x: line.x + x1,
        y: line.y,
        width: x2 - x1,
        height: line.height,
      });
    }
  }
  return segments;
}

/** The text a range covers. */
export function selectedText(
  layout: SelectionLayout,
  range: SelectionRange,
): string {
  const [from, to] = rangeBounds(layout, range);
  return layout.text.slice(from, to);
}
