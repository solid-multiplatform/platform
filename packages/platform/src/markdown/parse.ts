import type { Block, Inline, ListItem, MarkdownDocument } from './types.js';

const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 13;

const isBlank = (line: string): boolean => line.trim().length === 0;

/** A fence: three or more backticks or tildes, with the info string after. */
interface Fence {
  marker: string;
  length: number;
  language?: string;
}

function fenceAt(line: string): Fence | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})\s*(.*)$/.exec(line);
  if (match === null) return undefined;
  const marker = match[2]!;
  // A backtick fence's info string cannot contain a backtick (CommonMark).
  if (marker[0] === '`' && match[3]!.includes('`')) return undefined;
  const info = match[3]!.trim();
  const language =
    info.length > 0 ? info.split(/\s+/)[0]!.toLowerCase() : undefined;
  return { marker: marker[0]!, length: marker.length, language };
}

/** `# Heading`, with up to three spaces of indent and an optional closing run. */
function headingAt(line: string): { level: number; text: string } | undefined {
  const match = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line);
  if (match === null) return undefined;
  let text = match[2] ?? '';
  // The closing sequence is optional and must be preceded by a space.
  const closing = /(?:^|\s)#+\s*$/.exec(text);
  if (closing !== null) text = text.slice(0, closing.index).trimEnd();
  return { level: match[1]!.length, text };
}

const hrAt = (line: string): boolean =>
  /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);

interface ListMarker {
  ordered: boolean;
  start: number;
  /** Characters before the content starts (marker + spacing). */
  content: number;
  indent: number;
}

function listMarkerAt(line: string): ListMarker | undefined {
  const match = /^( {0,3})([-+*]|\d{1,9}[.)])( +)(.*)$/.exec(line);
  if (match === null) return undefined;
  const marker = match[2]!;
  const ordered = marker !== '-' && marker !== '+' && marker !== '*';
  return {
    ordered,
    start: ordered ? parseInt(marker, 10) : 1,
    indent: match[1]!.length,
    content: match[1]!.length + marker.length + match[3]!.length,
  };
}

const quoteAt = (line: string): string | undefined => {
  const match = /^ {0,3}> ?(.*)$/.exec(line);
  return match === null ? undefined : match[1]!;
};

const startsBlock = (line: string): boolean =>
  fenceAt(line) !== undefined ||
  headingAt(line) !== undefined ||
  hrAt(line) ||
  quoteAt(line) !== undefined ||
  listMarkerAt(line) !== undefined;

/** Parses a document. The result is a plain tree; nothing is memoised here. */
export function parseMarkdown(source: string): MarkdownDocument {
  const text = source.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  let at = 0;

  const parseBlocks = (): Block[] => {
    const blocks: Block[] = [];
    while (at < lines.length) {
      const line = lines[at]!;
      if (isBlank(line)) {
        at++;
        continue;
      }

      const fence = fenceAt(line);
      if (fence !== undefined) {
        at++;
        const body: string[] = [];
        while (at < lines.length) {
          const closing = lines[at]!;
          const marker = closing.trim();
          if (
            marker.length >= fence.length &&
            marker[0] === fence.marker &&
            marker.split('').every((c) => c === fence.marker)
          ) {
            at++;
            break;
          }
          body.push(closing);
          at++;
        }
        blocks.push({
          type: 'code',
          language: fence.language,
          text: body.join('\n'),
        });
        continue;
      }

      const heading = headingAt(line);
      if (heading !== undefined) {
        at++;
        blocks.push({
          type: 'heading',
          level: heading.level,
          children: parseInline(heading.text),
        });
        continue;
      }

      if (hrAt(line)) {
        at++;
        blocks.push({ type: 'hr' });
        continue;
      }

      const quote = quoteAt(line);
      if (quote !== undefined) {
        const body: string[] = [];
        while (at < lines.length) {
          const inner = quoteAt(lines[at]!);
          if (inner === undefined) break;
          body.push(inner);
          at++;
        }
        blocks.push({
          type: 'quote',
          children: parseMarkdown(body.join('\n')).blocks,
        });
        continue;
      }

      const marker = listMarkerAt(line);
      if (marker !== undefined) {
        blocks.push(parseList(marker));
        continue;
      }

      // A paragraph: everything up to a blank line or the next block start.
      const body: string[] = [line];
      at++;
      while (at < lines.length) {
        const next = lines[at]!;
        if (isBlank(next) || startsBlock(next)) break;
        body.push(next);
        at++;
      }
      blocks.push({
        type: 'paragraph',
        children: parseInline(body.join('\n')),
      });
    }
    return blocks;
  };

  const parseList = (first: ListMarker): Block => {
    const items: ListItem[] = [];
    const ordered = first.ordered;
    const start = first.start;

    while (at < lines.length) {
      const line = lines[at]!;
      const marker = listMarkerAt(line);
      if (marker === undefined || marker.ordered !== ordered) break;

      // The item's own text begins after the marker; continuation lines are
      // either indented to the content column or blank, and a nested list is
      // indented further and parsed recursively by the same block parser.
      const body: string[] = [line.slice(marker.content)];
      at++;
      while (at < lines.length) {
        const next = lines[at]!;
        if (isBlank(next)) {
          // A blank line ends the item unless the next line is indented.
          let look = at + 1;
          while (look < lines.length && isBlank(lines[look]!)) look++;
          if (look < lines.length && indentOf(lines[look]!) > marker.indent) {
            body.push('');
            at++;
            continue;
          }
          break;
        }
        if (indentOf(next) > marker.indent) {
          body.push(next.slice(Math.min(indentOf(next), marker.content)));
          at++;
          continue;
        }
        break;
      }

      items.push({ children: parseMarkdown(body.join('\n')).blocks });
      // A blank line between items is allowed.
      while (at < lines.length && isBlank(lines[at]!)) at++;
    }
    return { type: 'list', ordered, start, items };
  };

  return { blocks: parseBlocks() };
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// ---- Inline

const SPECIAL = new Set(['\\', '`', '*', '_', '~', '[', '<', '\n']);

/**
 * Parses inline content. Delimiters are found with `indexOf` scans rather
 * than per-character regular expressions, which keeps a chat-sized message
 * well under a millisecond even without a JIT.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  let text = '';

  const flush = () => {
    if (text.length > 0) {
      out.push({ type: 'text', text });
      text = '';
    }
  };

  while (at < source.length) {
    const char = source[at]!;

    if (char === '\\') {
      const next = source[at + 1];
      if (next === '\n') {
        flush();
        out.push({ type: 'break' });
        at += 2;
        continue;
      }
      if (next !== undefined && SPECIAL.has(next)) {
        text += next;
        at += 2;
        continue;
      }
      text += char;
      at++;
      continue;
    }

    if (char === '\n') {
      // Two or more trailing spaces are a hard break; otherwise a soft one.
      if (/ {2,}$/.test(text)) {
        text = text.replace(/ +$/, '');
        flush();
        out.push({ type: 'break' });
      } else {
        text += ' ';
      }
      at++;
      continue;
    }

    if (char === '`') {
      let run = 1;
      while (source[at + run] === '`') run++;
      const fence = '`'.repeat(run);
      const close = source.indexOf(fence, at + run);
      if (close !== -1) {
        let code = source.slice(at + run, close);
        if (
          code.length > 1 &&
          code.startsWith(' ') &&
          code.endsWith(' ') &&
          code.trim().length > 0
        )
          code = code.slice(1, -1);
        flush();
        out.push({ type: 'code', text: code });
        at = close + run;
        continue;
      }
      text += fence;
      at += run;
      continue;
    }

    if (char === '*' || char === '_' || char === '~') {
      const double = source[at + 1] === char;
      const delimiter = double ? char + char : char;
      const opened = emphasisAt(source, at, delimiter, char);
      if (opened !== undefined) {
        flush();
        const type = char === '~' ? 'del' : double ? 'strong' : 'em';
        out.push({
          type,
          children: parseInline(opened.inner),
        } as Inline);
        at = opened.end;
        continue;
      }
      text += delimiter;
      at += delimiter.length;
      continue;
    }

    if (char === '[') {
      const link = linkAt(source, at);
      if (link !== undefined) {
        flush();
        out.push({
          type: 'link',
          href: link.href,
          title: link.title,
          children: parseInline(link.label),
        });
        at = link.end;
        continue;
      }
      text += char;
      at++;
      continue;
    }

    if (char === '<') {
      const close = source.indexOf('>', at + 1);
      if (close !== -1) {
        const body = source.slice(at + 1, close);
        if (/^(?:https?:\/\/|mailto:)\S+$/i.test(body)) {
          flush();
          out.push({
            type: 'link',
            href: body,
            children: [{ type: 'text', text: body }],
          });
          at = close + 1;
          continue;
        }
      }
      text += char;
      at++;
      continue;
    }

    text += char;
    at++;
  }

  flush();
  return out;
}

/**
 * Finds an emphasis run that opens at `start` and its matching close, or
 * undefined when the delimiter is literal. Runs are matched by length: a
 * single-star close skips `**` runs (they belong to strong), and a strong
 * close uses the last two stars of a longer run, which is what lets
 * `**bold *inner***` nest. Underscores inside a word stay literal.
 */
function emphasisAt(
  source: string,
  start: number,
  delimiter: string,
  char: string,
): { inner: string; end: number } | undefined {
  const width = delimiter.length;
  const after = source[start + width];
  if (after === undefined || isSpace(after.charCodeAt(0))) return undefined;
  if (char === '~' && width !== 2) return undefined;
  if (char === '_') {
    const before = source[start - 1];
    if (before !== undefined && isWordChar(before)) return undefined;
  }

  let search = start + width;
  while (search < source.length) {
    const found = source.indexOf(delimiter, search);
    if (found === -1) return undefined;
    let run = width;
    while (source[found + run] === char) run++;
    if (width === 1 && run > 1) {
      // A `**` run is strong's; a single star cannot use it.
      search = found + run;
      continue;
    }
    // A strong close takes the last two stars of the run, leaving the ones
    // before it inside: `***` closes an inner emphasis and this strong.
    const close = width === 2 && run > 2 ? found + run - 2 : found;
    const before = source[close - 1];
    const canClose = before !== undefined && !isSpace(before.charCodeAt(0));
    const escaped = countBackslashes(source, close) % 2 === 1;
    const badUnderscore =
      char === '_' && before !== undefined && isWordChar(before);
    const inner = source.slice(start + width, close);
    if (canClose && !escaped && !badUnderscore && inner.trim().length > 0) {
      return { inner, end: found + run };
    }
    search = found + run;
  }
  return undefined;
}

// ES2017 has no Unicode property escapes: ASCII word characters plus any
// non-ASCII character, which keeps `snake_case` intact without a regex flag
// older engines reject.
const isWordChar = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code > 127
  );
};

function countBackslashes(source: string, at: number): number {
  let n = 0;
  while (at - n - 1 >= 0 && source[at - n - 1] === '\\') n++;
  return n;
}

/** `[label](href "title")`, with balanced brackets in the label. */
function linkAt(
  source: string,
  start: number,
): { label: string; href: string; title?: string; end: number } | undefined {
  let depth = 0;
  let at = start;
  for (; at < source.length; at++) {
    const char = source[at];
    if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (at >= source.length || source[at + 1] !== '(') return undefined;
  const label = source.slice(start + 1, at);
  let cursor = at + 2;
  while (cursor < source.length && source[cursor] === ' ') cursor++;

  let href: string;
  if (source[cursor] === '<') {
    const close = source.indexOf('>', cursor);
    if (close === -1) return undefined;
    href = source.slice(cursor + 1, close);
    cursor = close + 1;
  } else {
    // A destination is one token: it ends at whitespace or the closing `)`.
    const begin = cursor;
    while (
      cursor < source.length &&
      source[cursor] !== ')' &&
      source[cursor] !== ' '
    )
      cursor++;
    href = source.slice(begin, cursor);
  }

  while (cursor < source.length && source[cursor] === ' ') cursor++;
  let title: string | undefined;
  const quote = source[cursor];
  if (quote === '"' || quote === "'" || quote === '(') {
    const closing = quote === '(' ? ')' : quote;
    const close = source.indexOf(closing, cursor + 1);
    if (close === -1) return undefined;
    title = source.slice(cursor + 1, close);
    cursor = close + 1;
    while (cursor < source.length && source[cursor] === ' ') cursor++;
  }
  if (source[cursor] !== ')') return undefined;
  return { label, href, title, end: cursor + 1 };
}

/** The plain text of inline content, for search, previews and fast paths. */
export function inlineText(inlines: readonly Inline[]): string {
  let out = '';
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
      case 'code':
        out += inline.text;
        break;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        out += inlineText(inline.children);
        break;
      case 'break':
        out += '\n';
        break;
    }
  }
  return out;
}
