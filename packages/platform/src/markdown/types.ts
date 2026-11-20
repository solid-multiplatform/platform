/**
 * The Markdown subset a chat transcript needs. The parser is its own module
 * (`@solid-multiplatform/platform/markdown`) so an app that never shows
 * Markdown does not carry it, and it depends on nothing: no DOM, no Node, no
 * regular-expression engine features beyond ES2017.
 *
 * Supported blocks: paragraphs, ATX headings, fenced code, ordered and
 * unordered lists (nested by indentation), block quotes and thematic breaks.
 * Supported inline: emphasis, strong, strikethrough, code spans, links and
 * hard line breaks. Deliberately absent until a caller needs them: raw HTML,
 * images, tables, footnotes, maths and syntax highlighting. A parser that
 * does not implement what it cannot render is smaller and cannot disagree
 * with the scene.
 */
export interface MarkdownDocument {
  blocks: Block[];
}

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'hr' };

export interface ListItem {
  children: Block[];
}

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'break' };
