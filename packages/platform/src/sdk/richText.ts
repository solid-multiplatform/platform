export interface RichTextSpan {
  text: string;
  color?: number;
  fontSize?: number;
  fontWeight?: number | string;
  /** `normal`, `italic` or `oblique`; resolves to a registered face. */
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontFamily?: string;
  letterSpacing?: number;
}

export interface RichTextRun {
  text: string;
  /** Span index in the source array. */
  span: number;
  /** Offset from the start of the line. */
  x: number;
  width: number;
  color: number;
  fontSize: number;
  fontWeight?: number | string;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontFamily?: string;
  letterSpacing?: number;
}

export interface RichTextLine {
  runs: RichTextRun[];
  width: number;
  /** Horizontal offset after alignment. */
  x: number;
  y: number;
}

export interface RichTextLayout {
  lines: RichTextLine[];
  width: number;
  height: number;
  lineHeight: number;
}

export interface RichTextLayoutOptions {
  /** Available width in logical units. */
  width: number;
  /** Default font size for spans that omit one. */
  fontSize?: number;
  /** Default colour (0xRRGGBBAA) for spans that omit one. */
  color?: number;
  /** Line height. Defaults to the largest span font size × 1.35. */
  lineHeight?: number;
  /** Maximum lines before ellipsis/truncation. */
  maxLines?: number;
  /** Append an ellipsis when `maxLines` clips content. Defaults to true. */
  ellipsis?: boolean;
  /** Horizontal alignment of shorter lines. Defaults to `left`. */
  align?: 'left' | 'center' | 'right';
}

export type MeasureRichText = (text: string, span: RichTextSpan) => number;

interface LineState {
  runs: RichTextRun[];
  width: number;
}

const resolveStyle = (span: RichTextSpan, options: RichTextLayoutOptions) => ({
  color: span.color ?? options.color ?? 0xffffffff,
  fontSize: span.fontSize ?? options.fontSize ?? 24,
  fontWeight: span.fontWeight,
  fontStyle: span.fontStyle,
  fontFamily: span.fontFamily,
  letterSpacing: span.letterSpacing,
});

/** Rough fallback used when the host has no text measurer. */
export const estimateTextWidth = (text: string, fontSize = 24): number =>
  text.length * fontSize * 0.55;

/**
 * Lay out styled spans into wrapped lines. Measurement is injected so the
 * engine works with the real renderer, a browser canvas or tests.
 *
 * Words wrap at the available width; whitespace collapses at line starts;
 * words longer than the line hard-break by character (CJK and URLs). Newlines
 * force a break. `maxLines` truncates and appends an ellipsis.
 */
export function layoutRichText(
  spans: readonly RichTextSpan[],
  options: RichTextLayoutOptions,
  measure: MeasureRichText,
): RichTextLayout {
  const width = Math.max(0, options.width);
  const lines: LineState[] = [];
  let current: LineState = { runs: [], width: 0 };
  let largestFont = options.fontSize ?? 24;

  const lineHeight = () =>
    options.lineHeight ?? Math.max(largestFont * 1.35, options.fontSize ?? 24);

  const breakLine = () => {
    lines.push(current);
    current = { runs: [], width: 0 };
  };

  const append = (
    spanIndex: number,
    span: RichTextSpan,
    text: string,
    measured: number,
  ) => {
    const style = resolveStyle(span, options);
    current.runs.push({
      text,
      span: spanIndex,
      x: current.width,
      width: measured,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      letterSpacing: style.letterSpacing,
    });
    current.width += measured;
  };

  const hardBreak = (spanIndex: number, span: RichTextSpan, word: string) => {
    let chunk = '';
    for (const char of word) {
      const candidate = chunk + char;
      const measured = measure(candidate, span);
      if (measured > width && chunk) {
        append(spanIndex, span, chunk, measure(chunk, span));
        breakLine();
        chunk = char;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) append(spanIndex, span, chunk, measure(chunk, span));
  };

  spans.forEach((span, spanIndex) => {
    const size = span.fontSize ?? options.fontSize ?? 24;
    if (size > largestFont) largestFont = size;
    const parts = span.text.split('\n');
    parts.forEach((part, partIndex) => {
      if (partIndex > 0) breakLine();
      const tokens = part.match(/\s+|\S+/g) ?? [];
      for (const token of tokens) {
        const measured = measure(token, span);
        if (/^\s+$/.test(token)) {
          if (current.runs.length) append(spanIndex, span, token, measured);
          continue;
        }
        if (current.width + measured > width && current.runs.length) {
          breakLine();
        }
        if (measured > width && width > 0) {
          hardBreak(spanIndex, span, token);
        } else {
          append(spanIndex, span, token, measured);
        }
      }
    });
  });
  lines.push(current);

  // Wrapping happens before a trailing space knows it is at the end of a line;
  // drop whitespace-only runs so line widths and alignment stay correct.
  for (const line of lines) {
    while (
      line.runs.length &&
      /^\s+$/.test(line.runs[line.runs.length - 1]!.text)
    ) {
      line.runs.pop();
    }
    line.width = line.runs.length
      ? line.runs[line.runs.length - 1]!.x +
        line.runs[line.runs.length - 1]!.width
      : 0;
  }

  const maxLines = options.maxLines;
  let clipped = false;
  if (maxLines !== undefined && lines.length > maxLines) {
    lines.length = Math.max(0, maxLines);
    clipped = true;
  }
  if (lines.length === 0) lines.push({ runs: [], width: 0 });

  if (clipped && options.ellipsis !== false) {
    const last = lines[lines.length - 1]!;
    const suffix = '…';
    const styleSpan = spans[0] ?? { text: '' };
    const suffixWidth = measure(suffix, styleSpan);
    while (last.runs.length) {
      const run = last.runs[last.runs.length - 1]!;
      if (last.width + suffixWidth <= width) break;
      if (run.text.length > 1) {
        run.text = run.text.slice(0, -1);
        run.width = measure(run.text, styleSpan);
        last.width = run.x + run.width;
      } else {
        last.runs.pop();
        last.width = last.runs[last.runs.length - 1]
          ? last.runs[last.runs.length - 1]!.x +
            last.runs[last.runs.length - 1]!.width
          : 0;
      }
    }
    const style = resolveStyle(styleSpan, options);
    last.runs.push({
      text: suffix,
      span: 0,
      x: last.width,
      width: suffixWidth,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      letterSpacing: style.letterSpacing,
    });
    last.width += suffixWidth;
  }

  const align = options.align ?? 'left';
  const h = lineHeight();
  return {
    lines: lines.map((line, index) => ({
      runs: line.runs,
      width: line.width,
      x:
        align === 'center'
          ? (width - line.width) / 2
          : align === 'right'
            ? width - line.width
            : 0,
      y: index * h,
    })),
    width,
    height: lines.length * h,
    lineHeight: h,
  };
}
