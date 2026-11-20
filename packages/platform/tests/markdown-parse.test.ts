// The Markdown parser: block structure, inline structure, and the cache that
// keeps a scrolling transcript from parsing the same message twice.
import { describe, expect, test } from 'vitest';
import {
  clearMarkdownCache,
  inlineText,
  markdown,
  markdownCacheSize,
  parseMarkdown,
} from '../src/markdown/index.js';
import type { Block, Inline } from '../src/markdown/types.js';

const blocks = (source: string): Block[] => parseMarkdown(source).blocks;
const first = (source: string): Block => blocks(source)[0]!;
const inlines = (source: string): Inline[] =>
  (first(source) as { children: Inline[] }).children;

describe('markdown blocks', () => {
  test('paragraphs, soft breaks and hard breaks', () => {
    const paragraph = first('one\ntwo\nthree  \nfour') as {
      type: string;
      children: Inline[];
    };
    expect(paragraph.type).toBe('paragraph');
    expect(inlineText(paragraph.children)).toBe('one two three\nfour');
    expect(paragraph.children.some((node) => node.type === 'break')).toBe(true);
  });

  test('blank lines separate paragraphs', () => {
    expect(blocks('one\n\ntwo')).toHaveLength(2);
  });

  test('ATX headings, with an optional closing run', () => {
    expect(first('# One')).toEqual({
      type: 'heading',
      level: 1,
      children: [{ type: 'text', text: 'One' }],
    });
    expect(first('### Three ###')).toEqual({
      type: 'heading',
      level: 3,
      children: [{ type: 'text', text: 'Three' }],
    });
    expect(first('####### seven is a paragraph').type).toBe('paragraph');
  });

  test('fenced code keeps its lines, language and indentation', () => {
    const code = first('```ts\nconst a = 1;\n  return a;\n```');
    expect(code).toEqual({
      type: 'code',
      language: 'ts',
      text: 'const a = 1;\n  return a;',
    });
  });

  test('tilde fences and an unclosed fence run to the end', () => {
    expect(first('~~~\nx\n~~~')).toEqual({
      type: 'code',
      language: undefined,
      text: 'x',
    });
    expect(first('```\nnever closed')).toEqual({
      type: 'code',
      language: undefined,
      text: 'never closed',
    });
  });

  test('thematic breaks', () => {
    expect(first('---')).toEqual({ type: 'hr' });
    expect(first('* * *')).toEqual({ type: 'hr' });
    expect(first('_ _ _ _')).toEqual({ type: 'hr' });
  });

  test('unordered and ordered lists, with a start number', () => {
    const list = first('- a\n- b\n- c') as {
      type: string;
      ordered: boolean;
      items: { children: Block[] }[];
    };
    expect(list.type).toBe('list');
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(3);
    expect(
      inlineText(
        (list.items[1]!.children[0] as { children: Inline[] }).children,
      ),
    ).toBe('b');

    const ordered = first('3. three\n4. four') as {
      ordered: boolean;
      start: number;
      items: unknown[];
    };
    expect(ordered.ordered).toBe(true);
    expect(ordered.start).toBe(3);
    expect(ordered.items).toHaveLength(2);
  });

  test('a nested list keeps its indentation and becomes a child list', () => {
    const list = first('- outer\n  - inner\n  - inner two\n- second') as {
      items: { children: Block[] }[];
    };
    expect(list.items).toHaveLength(2);
    const nested = list.items[0]!.children.find(
      (block) => block.type === 'list',
    );
    expect(nested).toBeDefined();
    expect((nested as { items: unknown[] }).items).toHaveLength(2);
  });

  test('block quotes parse their contents as blocks', () => {
    const quote = first('> # Title\n> text');
    expect(quote.type).toBe('quote');
    const children = (quote as { children: Block[] }).children;
    expect(children[0]!.type).toBe('heading');
    expect(children[1]!.type).toBe('paragraph');
  });

  test('a block start interrupts a paragraph', () => {
    expect(blocks('text\n# heading')).toHaveLength(2);
    expect(blocks('text\n- item')).toHaveLength(2);
  });
});

describe('markdown inline', () => {
  test('strong, emphasis and strikethrough', () => {
    expect(inlines('**bold** and *em* and ~~gone~~')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'em' }] },
      { type: 'text', text: ' and ' },
      { type: 'del', children: [{ type: 'text', text: 'gone' }] },
    ]);
  });

  test('underscores inside a word stay literal', () => {
    expect(inlines('snake_case_name')).toEqual([
      { type: 'text', text: 'snake_case_name' },
    ]);
  });

  test('nested emphasis', () => {
    expect(inlines('**bold *inner***')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'bold ' },
          { type: 'em', children: [{ type: 'text', text: 'inner' }] },
        ],
      },
    ]);
  });

  test('code spans, with doubled backticks', () => {
    expect(inlines('use `code` here')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' here' },
    ]);
    expect(inlines('``a ` b``')).toEqual([{ type: 'code', text: 'a ` b' }]);
  });

  test('links with and without a title, and autolinks', () => {
    expect(inlines('[docs](https://example.com "Docs")')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        title: 'Docs',
        children: [{ type: 'text', text: 'docs' }],
      },
    ]);
    expect(inlines('[x](https://example.com)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        title: undefined,
        children: [{ type: 'text', text: 'x' }],
      },
    ]);
    expect(inlines('<https://example.com/a>')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/a',
        children: [{ type: 'text', text: 'https://example.com/a' }],
      },
    ]);
  });

  test('escapes produce literal characters', () => {
    expect(inlines('\\*not em\\*')).toEqual([
      { type: 'text', text: '*not em*' },
    ]);
    expect(inlines('a\\\nb')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'break' },
      { type: 'text', text: 'b' },
    ]);
  });

  test('an unmatched delimiter is literal', () => {
    expect(inlines('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
    expect(inlines('**unclosed')).toEqual([
      { type: 'text', text: '**unclosed' },
    ]);
  });

  test('inlineText flattens every node', () => {
    expect(inlineText(inlines('a **b** `c` [d](https://e) ~~f~~'))).toBe(
      'a b c d f',
    );
  });
});

describe('markdown cache', () => {
  test('the same source returns the same document', () => {
    clearMarkdownCache();
    const a = markdown('# one');
    const b = markdown('# one');
    expect(a).toBe(b);
    expect(markdownCacheSize()).toBe(1);
  });

  test('a changed source is a new entry (streaming)', () => {
    clearMarkdownCache();
    markdown('hello');
    markdown('hello world');
    expect(markdownCacheSize()).toBe(2);
  });
});
