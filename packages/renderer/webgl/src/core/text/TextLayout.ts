import {
  astralOf,
  isInvisible,
  measureRange,
  measureText,
  metricsAt,
  type GlyphRecord,
  type NormalizedFontMetrics,
  type SdfFont,
} from './sdfFont.js';

/**
 * The renderer-wide baseline anchor (the `textBaselineMode` setting, 1.10's
 * engine-wide value): which height a line's mid-line centres. 'optical'
 * (the default) centres the mean of the cap and x heights, 'cap' the cap
 * height, 'x' the x height, 'linebox' the ascender to descender box.
 */
export type TextBaselineMode = 'optical' | 'cap' | 'x' | 'linebox';

/**
 * Slack on the line breaker's width limit, in design units. A reported
 * width goes through the font scale and back, which can leave it a ulp
 * short of itself: a maxWidth equal to it would then cut its own text.
 */
export const WIDTH_TOLERANCE = 1e-6;

/**
 * The line breaker of 1.10's TextLayoutEngine, ported with its semantics
 * (the text snapshots pin them): lines of strings first (word wrap by
 * `maxWidth`, `maxLines` and `maxHeight`, `overflowSuffix`, the three
 * `wordBreak` strategies, letter spacing, line height multipliers at or
 * below 3, `textAlign`, the baseline anchor), then glyph runs. `measure`
 * is the font's width function and `font` the value it reads, so the
 * breaker can be tested with any font stand-in.
 */
export type MeasureTextFn<F> = (
  text: string,
  font: F,
  letterSpacing: number,
) => number;

/**
 * The MeasureTextFn width of `text.substring(start, end)`: the breaker
 * measures words and separators where they are in the text, so it makes
 * no string for one that fits on its line (layoutText passes the font's
 * measureRange).
 */
type MeasureRangeFn<F> = (
  text: string,
  start: number,
  end: number,
  font: F,
  letterSpacing: number,
) => number;

/** A MeasureRangeFn that measures the substring with `measureText`. */
const rangeOf =
  <F>(measureText: MeasureTextFn<F>): MeasureRangeFn<F> =>
  (text, start, end, font, letterSpacing) =>
    measureText(
      start === 0 && end === text.length ? text : text.substring(start, end),
      font,
      letterSpacing,
    );

/** A line: text, width, truncated, x offset, baseline y (1.10 TextLineStruct). */
export type TextLineStruct = [string, number, boolean, number, number];

/** Lines, lines left, text left (1.10 WrappedLinesStruct). */
export type WrappedLinesStruct = [TextLineStruct[], number, boolean];

/**
 * Lines, lines left, text left, bare line height, line height, width,
 * height (1.10 TextLayoutStruct).
 */
export type TextLayoutStruct = [
  TextLineStruct[],
  number,
  boolean,
  number,
  number,
  number,
  number,
];

type WrapStrategyFn<F> = (
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  font: F,
  letterSpacing: number,
  wrappedLines: TextLineStruct[],
  currentLine: string,
  currentLineWidth: number,
  remainingLines: number,
  remainingWord: string,
  maxWidth: number,
  space: string,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
) => [string, number, string];

/**
 * Lay `text` out in lines (1.10 mapTextLayout). Widths are in the units
 * `measureText` returns; `lineHeight` at or below 3 multiplies the font's
 * line height (ascender, descender and line gap); `baselineMode` anchors
 * each line's baseline (1.10's engine-wide `textBaselineMode`, per
 * renderer here).
 */
export function mapTextLayout<F>(
  measureText: MeasureTextFn<F>,
  metrics: NormalizedFontMetrics,
  text: string,
  textAlign: string,
  font: F,
  lineHeight: number,
  overflowSuffix: string,
  wordBreak: string,
  letterSpacing: number,
  maxLines: number,
  maxWidth: number,
  maxHeight: number,
  baselineMode: TextBaselineMode,
): TextLayoutStruct {
  return layoutLines(
    measureText,
    rangeOf(measureText),
    metrics,
    text,
    textAlign,
    font,
    lineHeight,
    overflowSuffix,
    wordBreak,
    letterSpacing,
    maxLines,
    maxWidth,
    maxHeight,
    baselineMode,
  );
}

/** mapTextLayout, words and separators measured with `measureRange`. */
function layoutLines<F>(
  measureText: MeasureTextFn<F>,
  measureRange: MeasureRangeFn<F>,
  metrics: NormalizedFontMetrics,
  text: string,
  textAlign: string,
  font: F,
  lineHeight: number,
  overflowSuffix: string,
  wordBreak: string,
  letterSpacing: number,
  maxLines: number,
  maxWidth: number,
  maxHeight: number,
  baselineMode: TextBaselineMode,
): TextLayoutStruct {
  // CSS 'normal': ascender + line gap - descender (negative below the baseline).
  const bareLineHeight = metrics.ascender - metrics.descender + metrics.lineGap;
  const lineHeightPx =
    lineHeight <= 3 ? lineHeight * bareLineHeight : lineHeight;

  let effectiveMaxLines = maxLines;
  if (maxHeight > 0) {
    let maxFromHeight = Math.floor(maxHeight / lineHeightPx);
    // At least one line.
    if (maxFromHeight < 1) {
      maxFromHeight = 1;
    }
    if (effectiveMaxLines === 0 || maxFromHeight < effectiveMaxLines) {
      effectiveMaxLines = maxFromHeight;
    }
  }

  // Letter spacing is measured after every glyph, the last one too, but the
  // reported width leaves that one out (below): `maxWidth` bounds the visible
  // text, so a line fits when its width less the trailing spacing does. A
  // maxWidth equal to a reported width then lays the same text out again.
  const wrapWidth =
    (letterSpacing > 0 ? maxWidth + letterSpacing : maxWidth) + WIDTH_TOLERANCE;
  const wrapped =
    maxWidth > 0
      ? wrapLines(
          measureText,
          measureRange,
          text,
          font,
          wrapWidth,
          letterSpacing,
          overflowSuffix,
          wordBreak,
          effectiveMaxLines,
        )
      : measureLines(
          measureText,
          text.split('\n'),
          font,
          letterSpacing,
          effectiveMaxLines,
        );
  const lines = wrapped[0];

  const effectiveLineAmount = lines.length;
  let effectiveMaxWidth = 0;

  // Letter spacing goes between characters: each measured line carries one
  // trailing spacing, trimmed here for alignment and the reported width (the
  // break decisions above leave it out of the fit too, by a wider limit). A
  // line that measured no glyph (only zero-width characters) carries none:
  // 1.10 trimmed one from any non-empty line, making that width negative.
  // A width of 0 alone does not say so (a spacing can cancel the advances):
  // such a line is measured again without the spacing.
  if (letterSpacing !== 0) {
    for (let i = 0; i < effectiveLineAmount; i++) {
      const line = lines[i]!;
      if (line[1] !== 0 || measureText(line[0], font, 0) !== 0) {
        line[1] -= letterSpacing;
      }
    }
  }

  if (effectiveLineAmount > 0) {
    effectiveMaxWidth = lines[0]![1];
    for (let i = 1; i < effectiveLineAmount; i++) {
      effectiveMaxWidth = Math.max(effectiveMaxWidth, lines[i]![1]);
    }
  }

  if (textAlign !== 'left') {
    for (let i = 0; i < effectiveLineAmount; i++) {
      const line = lines[i]!;
      const w = line[1];
      line[3] =
        textAlign === 'right'
          ? effectiveMaxWidth - w
          : (effectiveMaxWidth - w) / 2;
    }
  }

  const effectiveMaxHeight = effectiveLineAmount * lineHeightPx;

  // line[4]: each line's alphabetic baseline in px. 'optical' (the default)
  // centres the mean of the cap and x heights on the line's mid-line, 'cap'
  // the cap height, 'x' the x height; 'linebox' centres the ascender to
  // descender box with its leading (1.10).
  let firstBaselineY: number;
  if (baselineMode === 'cap') {
    firstBaselineY = (lineHeightPx + metrics.capHeight) * 0.5;
  } else if (baselineMode === 'x') {
    firstBaselineY = (lineHeightPx + metrics.xHeight) * 0.5;
  } else if (baselineMode === 'linebox') {
    const halfLeading = (lineHeightPx - bareLineHeight) * 0.5;
    firstBaselineY = halfLeading + metrics.ascender;
  } else {
    const opticalAnchor = (metrics.capHeight + metrics.xHeight) * 0.5;
    firstBaselineY = (lineHeightPx + opticalAnchor) * 0.5;
  }
  for (let i = 0; i < effectiveLineAmount; i++) {
    lines[i]![4] = firstBaselineY + lineHeightPx * i;
  }

  return [
    lines,
    wrapped[1],
    wrapped[2],
    bareLineHeight,
    lineHeightPx,
    effectiveMaxWidth,
    effectiveMaxHeight,
  ];
}

/**
 * Lines without wrapping, up to `maxLines` (1.10 measureLines). The loop
 * ends at the last line too: `maxLines` is Infinity when given so, or when
 * maxHeight meets a line height of 0 (or is Infinity), and 1.10, counting
 * off the missing lines past the last, then never returned.
 */
export function measureLines<F>(
  measureText: MeasureTextFn<F>,
  lines: string[],
  font: F,
  letterSpacing: number,
  maxLines: number,
): WrappedLinesStruct {
  const measuredLines: TextLineStruct[] = [];
  let remainingLines = maxLines > 0 ? maxLines : lines.length;
  let i = 0;
  while (remainingLines > 0 && i < lines.length) {
    const line = lines[i];
    i++;
    remainingLines--;
    if (line === undefined) {
      continue;
    }
    const width = measureText(line, font, letterSpacing);
    measuredLines.push([line, width, false, 0, 0]);
  }
  return [
    measuredLines,
    remainingLines,
    maxLines > 0 ? lines.length - measuredLines.length > 0 : false,
  ];
}

/** Wrap every `\n` line at `maxWidth` (1.10 wrapText). */
export function wrapText<F>(
  measureText: MeasureTextFn<F>,
  text: string,
  font: F,
  maxWidth: number,
  letterSpacing: number,
  overflowSuffix: string,
  wordBreak: string,
  maxLines: number,
): WrappedLinesStruct {
  return wrapLines(
    measureText,
    rangeOf(measureText),
    text,
    font,
    maxWidth,
    letterSpacing,
    overflowSuffix,
    wordBreak,
    maxLines,
  );
}

/**
 * wrapText, each `\n` line wrapped where it is in `text` (the lines
 * text.split('\n') gives, without making them).
 */
function wrapLines<F>(
  measureText: MeasureTextFn<F>,
  measureRange: MeasureRangeFn<F>,
  text: string,
  font: F,
  maxWidth: number,
  letterSpacing: number,
  overflowSuffix: string,
  wordBreak: string,
  maxLines: number,
): WrappedLinesStruct {
  const wrappedLines: TextLineStruct[] = [];
  const spaceWidth = measureText(' ', font, letterSpacing);
  const overflowWidth = measureText(overflowSuffix, font, letterSpacing);

  let remainingLines = maxLines > 0 ? maxLines : 1000;
  let hasRemainingText = true;
  const hasMaxLines = maxLines > 0;

  let start = 0;
  for (;;) {
    let end = text.indexOf('\n', start);
    const isLast = end === -1;
    if (isLast === true) {
      end = text.length;
    }
    if (end > start) {
      remainingLines = wrapRange(
        measureText,
        measureRange,
        text,
        start,
        end,
        font,
        maxWidth,
        letterSpacing,
        spaceWidth,
        overflowSuffix,
        overflowWidth,
        wordBreak,
        remainingLines,
        wrappedLines,
      );
      hasRemainingText = true;
    } else {
      wrappedLines.push(['', 0, false, 0, 0]);
      hasRemainingText = isLast === false;
    }
    remainingLines--;

    if (hasMaxLines === true && remainingLines <= 0) {
      // Undefined when the last line allowed laid out nothing: 1.10 threw
      // then, when text followed, and so does this.
      const lastLine = wrappedLines[wrappedLines.length - 1]!;
      // Text follows the last line allowed: it ends with the suffix.
      if (isLast === false && lastLine[2] === false) {
        const truncated = truncateLineEnd(
          measureText,
          font,
          letterSpacing,
          lastLine[0],
          lastLine[1],
          '',
          maxWidth,
          overflowSuffix,
          overflowWidth,
        );
        lastLine[0] = truncated[0];
        lastLine[1] = truncated[1];
        lastLine[2] = true;
      }
      break;
    }
    if (isLast === true) {
      break;
    }
    start = end + 1;
  }
  return [wrappedLines, remainingLines, hasRemainingText];
}

/** Wrap one line at `maxWidth` (1.10 wrapLine). */
export function wrapLine<F>(
  measureText: MeasureTextFn<F>,
  line: string,
  font: F,
  maxWidth: number,
  letterSpacing: number,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
  wordBreak: string,
  remainingLines: number,
): WrappedLinesStruct {
  const wrappedLines: TextLineStruct[] = [];
  const left = wrapRange(
    measureText,
    rangeOf(measureText),
    line,
    0,
    line.length,
    font,
    maxWidth,
    letterSpacing,
    spaceWidth,
    overflowSuffix,
    overflowWidth,
    wordBreak,
    remainingLines,
    wrappedLines,
  );
  return [wrappedLines, left, true];
}

/**
 * The separator runs found in the line wrapRange is wrapping, each a
 * [start, end) pair, in order: scratch, reused by every line.
 */
const separators: number[] = [];

/**
 * Wrap `text[lineStart, lineEnd)` at `maxWidth` into `wrappedLines`, and
 * return the lines left (1.10 wrapLine, which returned the lines and
 * true). Words are runs between separators (1.10 split the line on
 * /[ \u200B]+/, so a zero width space is a break), scanned and measured
 * in place; a leading separator run belongs to the first word. A line
 * stays a range of the text while words join it with the separator
 * before them, and is cut out once when it ends; a string is made for a
 * word only when it starts a line it does not fit, or breaks a line.
 *
 * As in 1.10, a word joins the line with the next separator in order of
 * those not yet used, not the one before it: the separator before a word
 * that started its line is used by the word after it.
 */
function wrapRange<F>(
  measureText: MeasureTextFn<F>,
  measureRange: MeasureRangeFn<F>,
  text: string,
  lineStart: number,
  lineEnd: number,
  font: F,
  maxWidth: number,
  letterSpacing: number,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
  wordBreak: string,
  remainingLines: number,
  wrappedLines: TextLineStruct[],
): number {
  const wrapFn = getWrapStrategy<F>(wordBreak);
  // The next word starts at `next` (-1 when none is left) and its
  // characters at `scan`: past the leading separators for the first.
  let next = lineStart;
  let scan = lineStart;
  while (scan < lineEnd) {
    const c = text.charCodeAt(scan);
    if (c !== 32 && c !== 0x200b) {
      break;
    }
    scan++;
  }
  // Separator runs found, and used.
  let found = 0;
  let used = 0;
  // The line so far: text[lineFrom, lineTo) while lineText is null, else
  // lineText (once it is not a range of the text).
  let lineFrom = lineStart;
  let lineTo = lineStart;
  let lineText: string | null = null;
  let currentLineWidth = 0;
  // The rest of a word still to lay out, text[pendingFrom, pendingTo)
  // (pendingFrom -1 when there is none), and its width when known.
  let pendingFrom = -1;
  let pendingTo = 0;
  let pendingWidth = 0;
  let pendingMeasured = false;

  while ((pendingFrom !== -1 || next !== -1) && remainingLines > 0) {
    let wordFrom: number;
    let wordTo: number;
    let wordWidth: number;
    if (pendingFrom !== -1) {
      wordFrom = pendingFrom;
      wordTo = pendingTo;
      pendingFrom = -1;
      wordWidth =
        pendingMeasured === true
          ? pendingWidth
          : measureRange(text, wordFrom, wordTo, font, letterSpacing);
    } else {
      wordFrom = next;
      wordTo = scan;
      while (wordTo < lineEnd) {
        const c = text.charCodeAt(wordTo);
        if (c === 32 || c === 0x200b) {
          break;
        }
        wordTo++;
      }
      if (wordTo === lineEnd) {
        next = -1;
      } else {
        let sepTo = wordTo + 1;
        while (sepTo < lineEnd) {
          const c = text.charCodeAt(sepTo);
          if (c !== 32 && c !== 0x200b) {
            break;
          }
          sepTo++;
        }
        separators[found * 2] = wordTo;
        separators[found * 2 + 1] = sepTo;
        found++;
        next = sepTo;
        scan = sepTo;
      }
      wordWidth = measureRange(text, wordFrom, wordTo, font, letterSpacing);
    }

    // The first word of a line (or after a line of no width, which it
    // replaces, as in 1.10).
    if (currentLineWidth === 0) {
      // It fits (a NaN width too, as in 1.10, which tested `>`).
      if (wordWidth > maxWidth === false) {
        if (wordWidth + spaceWidth >= maxWidth) {
          // It fits, but a space after it would not: a line of its own.
          remainingLines--;
          wrappedLines.push([
            text.substring(wordFrom, wordTo),
            wordWidth,
            false,
            0,
            0,
          ]);
        } else {
          lineFrom = wordFrom;
          lineTo = wordTo;
          lineText = null;
          currentLineWidth = wordWidth;
        }
        continue;
      }
      // It does not fit on an empty line: split it, or on the last line
      // truncate it.
      remainingLines--;
      const isLastLine = remainingLines === 0;
      const word = text.substring(wordFrom, wordTo);
      const cut =
        isLastLine === true
          ? truncateWord(
              measureText,
              word,
              wordWidth,
              maxWidth,
              font,
              letterSpacing,
              overflowSuffix,
              overflowWidth,
            )
          : splitWord(
              measureText,
              word,
              wordWidth,
              maxWidth,
              font,
              letterSpacing,
            );
      let head = cut[0];
      let headWidth = cut[2];
      let truncated = isLastLine;
      const rest = cut[1].length;
      if (rest > 0 && head.length > 0) {
        // Its end starts the next line.
        pendingFrom = wordTo - rest;
        pendingTo = wordTo;
        pendingMeasured = false;
      } else if (rest > 0) {
        // Nothing of it fits: the text ends with the suffix, or without
        // one with its first character.
        remainingLines = 0;
        truncated = true;
        head = overflowSuffix.length > 0 ? overflowSuffix : cut[1].charAt(0);
        headWidth =
          overflowSuffix.length > 0
            ? overflowWidth
            : measureText(head, font, letterSpacing);
      }
      wrappedLines.push([head, headWidth, truncated, 0, 0]);
      continue;
    }
    // The next separator not yet used, or none.
    let sepFrom = 0;
    let sepTo = 0;
    if (used < found) {
      sepFrom = separators[used * 2]!;
      sepTo = separators[used * 2 + 1]!;
    }
    used++;
    // A single ' ' is the common separator: reuse its width. A run of
    // spaces or ZWSPs is one separator, measured for real.
    const isSpace = sepTo - sepFrom === 1 && text.charCodeAt(sepFrom) === 32;
    const effectiveSpaceWidth =
      isSpace === true
        ? spaceWidth
        : sepTo > sepFrom
        ? measureRange(text, sepFrom, sepTo, font, letterSpacing)
        : 0;
    const totalWidth = currentLineWidth + effectiveSpaceWidth + wordWidth;

    if (totalWidth <= maxWidth) {
      // The word joins the line, after the separator unless it takes no
      // width: still a range when both follow the line in the text.
      if (
        lineText === null &&
        effectiveSpaceWidth > 0 &&
        sepFrom === lineTo &&
        sepTo === wordFrom
      ) {
        lineTo = wordTo;
      } else {
        lineText =
          (lineText === null ? text.substring(lineFrom, lineTo) : lineText) +
          (effectiveSpaceWidth > 0 ? text.substring(sepFrom, sepTo) : '') +
          text.substring(wordFrom, wordTo);
      }
      currentLineWidth = totalWidth;
      if (totalWidth < maxWidth) {
        continue;
      }
      // Exactly full: the line ends here.
      remainingLines--;
      wrappedLines.push([
        lineText === null ? text.substring(lineFrom, lineTo) : lineText,
        currentLineWidth,
        false,
        0,
        0,
      ]);
      lineText = '';
      currentLineWidth = 0;
      continue;
    }
    // The line ends here.
    remainingLines--;

    const wrapped = wrapFn(
      measureText,
      text.substring(wordFrom, wordTo),
      wordWidth,
      font,
      letterSpacing,
      wrappedLines,
      lineText === null ? text.substring(lineFrom, lineTo) : lineText,
      currentLineWidth,
      remainingLines,
      '',
      maxWidth,
      isSpace === true ? ' ' : text.substring(sepFrom, sepTo),
      spaceWidth,
      overflowSuffix,
      overflowWidth,
    );
    lineText = wrapped[0];
    currentLineWidth = wrapped[1];
    // What is left of the word starts the next line: all of it, or its
    // end. (On the last line allowed nothing is laid out after it.)
    const rest = wrapped[2].length;
    if (rest > 0 && remainingLines > 0) {
      pendingFrom = wordTo - rest;
      pendingTo = wordTo;
      pendingMeasured = rest === wordTo - wordFrom;
      pendingWidth = wordWidth;
    }
  }

  if (currentLineWidth > 0 && remainingLines > 0) {
    wrappedLines.push([
      lineText === null ? text.substring(lineFrom, lineTo) : lineText,
      currentLineWidth,
      false,
      0,
      0,
    ]);
  }

  return remainingLines;
}

function getWrapStrategy<F>(wordBreak: string): WrapStrategyFn<F> {
  if (wordBreak === 'break-all') {
    return breakAll;
  }
  if (wordBreak === 'overflow') {
    return overflow;
  }
  // 'break-word', the default, and any other value.
  return breakWord;
}

/**
 * 'overflow' (1.10): the word joins the line past `maxWidth`, which ends
 * there, with the suffix on the last line allowed.
 */
export function overflow<F>(
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  font: F,
  letterSpacing: number,
  wrappedLines: TextLineStruct[],
  currentLine: string,
  currentLineWidth: number,
  remainingLines: number,
  remainingWord: string,
  maxWidth: number,
  space: string,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
): [string, number, string] {
  currentLine += space + word;
  currentLineWidth += spaceWidth + wordWidth;
  if (remainingLines === 0) {
    currentLine += overflowSuffix;
    currentLineWidth += overflowWidth;
  }
  wrappedLines.push([currentLine, currentLineWidth, true, 0, 0]);
  return ['', 0, ''];
}

/**
 * 'break-word' (1.10): the line ends before the word, which starts the
 * next; on the last line allowed the line is truncated with the suffix.
 */
export function breakWord<F>(
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  font: F,
  letterSpacing: number,
  wrappedLines: TextLineStruct[],
  currentLine: string,
  currentLineWidth: number,
  remainingLines: number,
  remainingWord: string,
  maxWidth: number,
  space: string,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
): [string, number, string] {
  remainingWord = word;
  if (remainingLines === 0) {
    const truncated = truncateLineEnd(
      measureText,
      font,
      letterSpacing,
      currentLine,
      currentLineWidth,
      remainingWord,
      maxWidth,
      overflowSuffix,
      overflowWidth,
    );
    currentLine = truncated[0];
    currentLineWidth = truncated[1];
    remainingWord = truncated[2];
    wrappedLines.push([currentLine, currentLineWidth, true, 0, 0]);
  } else {
    wrappedLines.push([currentLine, currentLineWidth, false, 0, 0]);
    currentLine = '';
    currentLineWidth = 0;
  }
  return [currentLine, currentLineWidth, remainingWord];
}

/**
 * 'break-all' (1.10): the word fills the rest of the line and continues on
 * the next (truncated with the suffix on the last line allowed).
 */
export function breakAll<F>(
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  font: F,
  letterSpacing: number,
  wrappedLines: TextLineStruct[],
  currentLine: string,
  currentLineWidth: number,
  remainingLines: number,
  remainingWord: string,
  maxWidth: number,
  space: string,
  spaceWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
): [string, number, string] {
  let remainingSpace = maxWidth - currentLineWidth;
  if (currentLineWidth > 0) {
    remainingSpace -= spaceWidth;
  }
  const truncate = remainingLines === 0;
  const cut = truncate
    ? truncateWord(
        measureText,
        word,
        wordWidth,
        remainingSpace,
        font,
        letterSpacing,
        overflowSuffix,
        overflowWidth,
      )
    : splitWord(
        measureText,
        word,
        wordWidth,
        remainingSpace,
        font,
        letterSpacing,
      );
  currentLine += space + cut[0];
  currentLineWidth += spaceWidth + cut[2];
  wrappedLines.push([currentLine, currentLineWidth, truncate, 0, 0]);
  return ['', 0, cut[1]];
}

/**
 * End `currentLine` with the suffix, removing characters from its end
 * until both fit `maxWidth` (1.10 truncateLineEnd); only the suffix when
 * nothing fits beside it.
 */
export function truncateLineEnd<F>(
  measureText: MeasureTextFn<F>,
  font: F,
  letterSpacing: number,
  currentLine: string,
  currentLineWidth: number,
  remainingWord: string,
  maxWidth: number,
  overflowSuffix: string,
  overflowWidth: number,
): [string, number, string] {
  if (currentLineWidth + overflowWidth <= maxWidth) {
    currentLine += overflowSuffix;
    currentLineWidth += overflowWidth;
    remainingWord = '';
    return [currentLine, currentLineWidth, remainingWord];
  }

  let truncated = false;
  for (let i = currentLine.length - 1; i > 0; i--) {
    const char = currentLine.charAt(i);
    const charWidth = measureText(char, font, letterSpacing);
    currentLineWidth -= charWidth;
    if (currentLineWidth + overflowWidth <= maxWidth) {
      currentLine = currentLine.substring(0, i) + overflowSuffix;
      currentLineWidth += overflowWidth;
      // 1.10 read the remainder from the line it had just cut: kept.
      remainingWord = currentLine.substring(i) + ' ' + remainingWord;
      truncated = true;
      break;
    }
  }

  if (truncated === false) {
    currentLine = overflowSuffix;
    currentLineWidth = overflowWidth;
    remainingWord = currentLine;
  }
  return [currentLine, currentLineWidth, remainingWord];
}

/**
 * The start of `word` that fits `maxWidth` with the suffix after it, the
 * rest, and its width (1.10 truncateWord). Whether it removes characters
 * from the end or adds them from the start depends on how much is cut, as
 * in 1.10.
 */
export function truncateWord<F>(
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  maxWidth: number,
  font: F,
  letterSpacing: number,
  overflowSuffix: string,
  overflowWidth: number,
): [string, string, number] {
  const targetWidth = maxWidth - overflowWidth;
  if (targetWidth <= 0) {
    return ['', word, 0];
  }
  const excessWidth = wordWidth - targetWidth;
  const shouldStartFromBack = excessWidth < wordWidth / 2;
  if (shouldStartFromBack === false) {
    let currentWidth = wordWidth;
    for (let i = word.length - 1; i > 0; i--) {
      const char = word.charAt(i);
      const charWidth = measureText(char, font, letterSpacing);
      currentWidth -= charWidth;
      if (currentWidth <= targetWidth) {
        const remainingWord = word.substring(i);
        return [
          word.substring(0, i) + overflowSuffix,
          remainingWord,
          currentWidth + overflowWidth,
        ];
      }
    }
    return [overflowSuffix, word, overflowWidth];
  }
  let currentWidth = 0;
  for (let i = 0; i < word.length; i++) {
    const char = word.charAt(i);
    const charWidth = measureText(char, font, letterSpacing);
    if (currentWidth + charWidth > targetWidth) {
      const remainingWord = word.substring(i);
      return [
        word.substring(0, i) + overflowSuffix,
        remainingWord,
        currentWidth + overflowWidth,
      ];
    }
    currentWidth += charWidth;
  }
  return [word + overflowSuffix, '', wordWidth + overflowWidth];
}

/**
 * The start of `word` that fits `maxWidth`, the rest, and its width (1.10
 * splitWord), searched as truncateWord searches.
 */
export function splitWord<F>(
  measureText: MeasureTextFn<F>,
  word: string,
  wordWidth: number,
  maxWidth: number,
  font: F,
  letterSpacing: number,
): [string, string, number] {
  if (maxWidth <= 0) {
    return ['', word, 0];
  }
  const excessWidth = wordWidth - maxWidth;
  const shouldStartFromBack = excessWidth < wordWidth / 2;
  if (shouldStartFromBack === false) {
    let currentWidth = wordWidth;
    for (let i = word.length - 1; i > 0; i--) {
      const char = word.charAt(i);
      const charWidth = measureText(char, font, letterSpacing);
      currentWidth -= charWidth;
      if (currentWidth <= maxWidth) {
        const remainingWord = word.substring(i);
        return [word.substring(0, i), remainingWord, currentWidth];
      }
    }
    return ['', word, 0];
  }
  let currentWidth = 0;
  for (let i = 0; i < word.length; i++) {
    const char = word.charAt(i);
    const charWidth = measureText(char, font, letterSpacing);
    if (currentWidth + charWidth > maxWidth) {
      const remainingWord = word.substring(i);
      return [word.substring(0, i), remainingWord, currentWidth];
    }
    currentWidth += charWidth;
  }
  return [word, '', wordWidth];
}

/** The text props a layout depends on (spec 10.2). */
export interface TextLayoutProps {
  text: string;
  fontSize: number;
  fontStyle: string;
  letterSpacing: number;
  lineHeight: number;
  maxWidth: number;
  maxHeight: number;
  maxLines: number;
  textAlign: string;
  wordBreak: string;
  overflowSuffix: string;
  /**
   * The resolved layout direction: under rtl, `left` and `right` swap
   * (effectiveAlign). A cache key like the rest, so a `left` text under RTL
   * and a `right` text under LTR are two entries.
   */
  rtl: boolean;
}

/**
 * The horizontal alignment a layout uses: `left` and `right` swap under
 * rtl, anything else (`center`) is as written.
 */
export const effectiveAlign = (textAlign: string, rtl: boolean): string => {
  if (rtl === false) {
    return textAlign;
  }
  if (textAlign === 'left') {
    return 'right';
  }
  if (textAlign === 'right') {
    return 'left';
  }
  return textAlign;
};

/**
 * A text's glyph runs (spec 10.2): 8 words per glyph, `f32` and `u32`
 * over one buffer. Words 0 to 3 are the glyph's x, y, width and height in
 * atlas design units (Float32, as 1.10 stored them, so the emitter's
 * arithmetic matches its); words 4 to 7 its UV rect in the atlas, u1, v1,
 * u2, v2 (Float32, as 1.10 stored them). Width and
 * height are in pixels; `distanceRange` is the atlas range at this size,
 * the glyph vertices' `a_extra`.
 */
export interface TextLayout {
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  readonly glyphCount: number;
  /** Local ink-quad bounds in logical pixels, including glyph overhang and atlas padding. */
  readonly inkLeft: number;
  readonly inkTop: number;
  readonly inkRight: number;
  readonly inkBottom: number;
  readonly width: number;
  readonly height: number;
  readonly fontScale: number;
  readonly lineHeight: number;
  readonly distanceRange: number;
}

/** Words per glyph in a TextLayout. */
export const GLYPH_WORDS = 8;

/**
 * How far a layout's painted ink leaves the box the block was placed in. The
 * ink bounds are the glyph quads' own rectangle (advance overhang and atlas
 * padding included); `boxX`/`boxY` are the block's offset in the box. A
 * tolerance of a pixel keeps ordinary side bearings, which sit a fraction of
 * a pixel past the last advance, from asking for a clip.
 */
export function inkExceedsBox(
  layout: TextLayout,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  tolerance = 1,
): boolean {
  if (layout.glyphCount === 0) {
    return false;
  }
  return (
    boxX + layout.inkLeft < -tolerance ||
    boxY + layout.inkTop < -tolerance ||
    boxX + layout.inkRight > boxW + tolerance ||
    boxY + layout.inkBottom > boxH + tolerance
  );
}

/**
 * Glyph runs for `props` in `font` (1.10 generateTextLayout): the lines of
 * mapTextLayout, each glyph placed at the line's offset and baseline, kerned
 * against the one before it, advanced by its width plus the letter spacing
 * (in design units); a zero width space or an invisible character draws
 * nothing, and a missing glyph the fallback. A glyph without area (the
 * space) advances and kerns as any other but stores no quad, where 1.10
 * drew it as an empty one. Empty text is a layout of no glyphs and no size
 * (1.10 skipped the layout).
 */
export function layoutText(
  props: TextLayoutProps,
  font: SdfFont,
  baselineMode: TextBaselineMode,
): TextLayout {
  const data = font.data;
  const fontScale = props.fontSize / data.info.size;
  if (props.text.length === 0) {
    const empty = new ArrayBuffer(0);
    return {
      f32: new Float32Array(empty),
      u32: new Uint32Array(empty),
      glyphCount: 0,
      inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0,
      width: 0,
      height: 0,
      fontScale,
      lineHeight: 0,
      distanceRange: fontScale * data.distanceField.distanceRange,
    };
  }
  const atlasBase = data.common.base;
  const letterSpacing = props.letterSpacing / fontScale;
  const layout = layoutLines(
    measureText,
    measureRange,
    metricsAt(font, props.fontSize),
    props.text,
    effectiveAlign(props.textAlign, props.rtl),
    font,
    props.lineHeight,
    props.overflowSuffix,
    props.wordBreak,
    letterSpacing,
    props.maxLines,
    props.maxWidth / fontScale,
    props.maxHeight,
    baselineMode,
  );
  const lines = layout[0];
  // At most one glyph per UTF-16 unit; skipped units leave the tail unused.
  let maxGlyphs = 0;
  for (let i = 0; i < lines.length; i++) {
    maxGlyphs += lines[i]![0].length;
  }
  const buffer = new ArrayBuffer(maxGlyphs * GLYPH_WORDS * 4);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  const pages = font.pages;
  const fallback = font.fallback;
  const kernAmounts = font.kernAmounts;
  let o = 0;
  let glyphCount = 0;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const textLine = line[0];
    const n = textLine.length;
    // The kerning column of the glyph before, -1 when there is none.
    let prev = -1;
    let x = line[3];
    // The baseline, in design units.
    const baseline = line[4] / fontScale;
    // Code point, glyph and kerning as measureRange looks them up.
    for (let j = 0; j < n; j++) {
      let code = textLine.charCodeAt(j);
      if (code >= 0xd800 && code <= 0xdbff && j + 1 < n) {
        const lo = textLine.charCodeAt(j + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
        }
      }
      let glyph: GlyphRecord | null;
      if (code > 0xffff) {
        j++;
        glyph = astralOf(font, code);
      } else {
        if (code >= 0xad && (code === 0x200b || isInvisible(code) === true)) {
          continue;
        }
        glyph = pages[code >> 8]![code & 255]!;
      }
      if (glyph === null) {
        glyph = fallback;
        if (glyph === null) {
          continue;
        }
      }
      if (prev !== -1) {
        const row = glyph.kern;
        if (row !== null) {
          const pair = row[prev]!;
          if (pair !== 0) {
            x += kernAmounts[pair]!;
          }
        }
      }
      // A glyph without area (the space, and in production the fallback
      // for every missing glyph) draws nothing: it only advances, so no
      // quad is stored for the emitter to write every drawn frame.
      if (glyph.width === 0 || glyph.height === 0) {
        x += glyph.xadvance + letterSpacing;
        prev = glyph.kernColumn;
        continue;
      }
      f32[o] = x + glyph.xoffset;
      // yoffset counts from the line box's top, `base` to the baseline.
      f32[o + 1] = baseline + glyph.yoffset - atlasBase;
      f32[o + 2] = glyph.width;
      f32[o + 3] = glyph.height;
      left = Math.min(left, f32[o]!);
      top = Math.min(top, f32[o + 1]!);
      right = Math.max(right, f32[o]! + f32[o + 2]!);
      bottom = Math.max(bottom, f32[o + 1]! + f32[o + 3]!);
      f32[o + 4] = glyph.u1;
      f32[o + 5] = glyph.v1;
      f32[o + 6] = glyph.u2;
      f32[o + 7] = glyph.v2;
      o += GLYPH_WORDS;
      glyphCount++;
      x += glyph.xadvance + letterSpacing;
      prev = glyph.kernColumn;
    }
  }
  return {
    f32,
    u32,
    glyphCount,
    inkLeft: glyphCount ? left * fontScale : 0,
    inkTop: glyphCount ? top * fontScale : 0,
    inkRight: glyphCount ? right * fontScale : 0,
    inkBottom: glyphCount ? bottom * fontScale : 0,
    width: layout[5] * fontScale,
    height: layout[6],
    fontScale,
    lineHeight: layout[4],
    distanceRange: fontScale * data.distanceField.distanceRange,
  };
}

/**
 * A cached layout and the props it was made with besides its text (copied:
 * a node's state changes after), chained to the other layouts of the same
 * font and text.
 */
class LayoutEntry {
  readonly font: number;
  readonly text: string;
  readonly fontSize: number;
  readonly fontStyle: string;
  readonly letterSpacing: number;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxLines: number;
  readonly textAlign: string;
  readonly wordBreak: string;
  readonly overflowSuffix: string;
  readonly rtl: boolean;
  readonly layout: TextLayout;
  /** The next layout of the same font and text, or null. */
  next: LayoutEntry | null;
  /** The cache's clock at its last use: the lowest goes first. */
  stamp: number;

  constructor(
    font: number,
    p: TextLayoutProps,
    layout: TextLayout,
    next: LayoutEntry | null,
    stamp: number,
  ) {
    this.font = font;
    this.text = p.text;
    this.fontSize = p.fontSize;
    this.fontStyle = p.fontStyle;
    this.letterSpacing = p.letterSpacing;
    this.lineHeight = p.lineHeight;
    this.maxWidth = p.maxWidth;
    this.maxHeight = p.maxHeight;
    this.maxLines = p.maxLines;
    this.textAlign = p.textAlign;
    this.wordBreak = p.wordBreak;
    this.overflowSuffix = p.overflowSuffix;
    this.rtl = p.rtl;
    this.layout = layout;
    this.next = next;
    this.stamp = stamp;
  }
}

/**
 * Layouts by content (spec 10.2), shared by every node that lays out the
 * same text the same way, least recently used first out: bounded on
 * insert (an animating scene never idles, and a clock's text changes every
 * second) and trimmed again at idle maintenance. Found by font (its
 * record's id), then by the text itself (a string caches its own hash, so
 * a lookup builds nothing), then by the other props, compared one by one
 * along the text's few layouts (a NaN prop never matches, so it lays out
 * anew). A use stamps the layout with the cache's clock; an eviction
 * drops the lowest stamp.
 */
export class LayoutCache {
  max: number;
  /** Per font record id, the latest layout of each text, the rest chained. */
  private readonly fonts = new Map<number, Map<string, LayoutEntry>>();
  /** Every layout cached, in no order. */
  private readonly entries: LayoutEntry[] = [];
  private clock = 0;

  constructor(max: number) {
    this.max = max;
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * The layout cached for `p` in font `font`, now the most recently used,
   * or undefined.
   */
  get(font: number, p: TextLayoutProps): TextLayout | undefined {
    const texts = this.fonts.get(font);
    if (texts === undefined) {
      return undefined;
    }
    let e: LayoutEntry | null | undefined = texts.get(p.text);
    while (e !== undefined && e !== null) {
      if (
        e.fontSize === p.fontSize &&
        e.maxWidth === p.maxWidth &&
        e.maxLines === p.maxLines &&
        e.maxHeight === p.maxHeight &&
        e.lineHeight === p.lineHeight &&
        e.letterSpacing === p.letterSpacing &&
        e.textAlign === p.textAlign &&
        e.wordBreak === p.wordBreak &&
        e.overflowSuffix === p.overflowSuffix &&
        e.rtl === p.rtl &&
        e.fontStyle === p.fontStyle
      ) {
        e.stamp = ++this.clock;
        return e.layout;
      }
      e = e.next;
    }
    return undefined;
  }

  /** Cache `layout` for `p` in font `font` (one get missed it). */
  set(font: number, p: TextLayoutProps, layout: TextLayout): void {
    const fonts = this.fonts;
    let texts = fonts.get(font);
    if (texts === undefined) {
      texts = new Map<string, LayoutEntry>();
      fonts.set(font, texts);
    }
    const text = p.text;
    const head = texts.get(text);
    const e = new LayoutEntry(
      font,
      p,
      layout,
      head === undefined ? null : head,
      ++this.clock,
    );
    texts.set(text, e);
    this.entries.push(e);
    this.trim();
  }

  /**
   * Drop the least recently used layouts beyond `max`; below 0, as at 0,
   * none stays (an empty cache is never smaller than a negative max).
   */
  trim(): void {
    const max = this.max > 0 ? this.max : 0;
    while (this.entries.length > max) {
      this.evictOldest();
    }
  }

  /** Drop the layout used longest ago. */
  private evictOldest(): void {
    const entries = this.entries;
    const last = entries.length - 1;
    let oldest = 0;
    let stamp = entries[0]!.stamp;
    for (let i = 1; i <= last; i++) {
      const s = entries[i]!.stamp;
      if (s < stamp) {
        stamp = s;
        oldest = i;
      }
    }
    const e = entries[oldest]!;
    entries[oldest] = entries[last]!;
    entries.pop();
    const fonts = this.fonts;
    const texts = fonts.get(e.font)!;
    const text = e.text;
    let prev = texts.get(text)!;
    if (prev === e) {
      if (e.next !== null) {
        texts.set(text, e.next);
        return;
      }
      texts.delete(text);
      if (texts.size === 0) {
        fonts.delete(e.font);
      }
      return;
    }
    while (prev.next !== e) {
      prev = prev.next!;
    }
    prev.next = e.next;
  }
}
