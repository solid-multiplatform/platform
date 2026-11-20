import * as v from 'vitest';
import { createSignal } from 'solid-js';
import * as lng from '@solid-multiplatform/platform';
import { RichText } from '@solid-multiplatform/platform/primitives';
import {
  layoutRichText,
  type RichTextLayout,
  type RichTextSpan,
} from '../src/sdk/richText.js';
import { renderer, waitForUpdate } from './setup.js';

const measure = (text: string) => text.length * 10;

const layout = (
  spans: RichTextSpan[],
  options: Partial<Parameters<typeof layoutRichText>[1]> = {},
) => layoutRichText(spans, { width: 100, fontSize: 20, ...options }, measure);

v.describe('layoutRichText', () => {
  v.it('wraps spans at word boundaries and keeps per-span styles', () => {
    const result = layout([
      { text: 'Hello' },
      { text: ' world', color: 0xff0000ff, fontSize: 24 },
    ]);
    v.expect(result.lines).toHaveLength(2);
    v.expect(result.lines[0]!.runs.map((run) => run.text)).toEqual(['Hello']);
    v.expect(result.lines[1]!.runs.map((run) => run.text)).toEqual(['world']);
    v.expect(result.lines[0]!.width).toBe(50);
    v.expect(result.lines[1]!.width).toBe(50);
    v.expect(result.lines[1]!.runs[0]!.color).toBe(0xff0000ff);
    v.expect(result.lines[1]!.runs[0]!.fontSize).toBe(24);
    v.expect(result.lineHeight).toBeCloseTo(32.4, 6);
    v.expect(result.height).toBeCloseTo(64.8, 6);
  });

  v.it('honours explicit newlines and horizontal alignment', () => {
    const result = layout([{ text: 'one\ntwo' }, { text: '3' }], {
      align: 'center',
    });
    v.expect(
      result.lines.map((line) => line.runs.map((run) => run.text).join('')),
    ).toEqual(['one', 'two3']);
    v.expect(result.lines[0]!.x).toBe(35);
    v.expect(result.lines[1]!.x).toBe(30);
  });

  v.it('hard-breaks a word wider than the line', () => {
    const result = layout([{ text: 'abcdefghij' }], { width: 50 });
    v.expect(result.lines.map((line) => line.runs[0]!.text)).toEqual([
      'abcde',
      'fghij',
    ]);
  });

  v.it('truncates with an ASCII ellipsis at maxLines', () => {
    // Three dots, not '…': the shipped MSDF atlases carry no U+2026, so the
    // scene would draw a blank where the ellipsis should be.
    const result = layout([{ text: 'abcdef' }], {
      width: 50,
      maxLines: 1,
    });
    v.expect(result.lines).toHaveLength(1);
    v.expect(result.lines[0]!.runs.map((run) => run.text).join('')).toBe(
      'ab...',
    );
  });

  v.it('drops whitespace at the start of a wrapped line', () => {
    const result = layout([{ text: 'aaaa bbbb' }], { width: 45 });
    v.expect(result.lines[0]!.runs[0]!.text).toBe('aaaa');
    v.expect(result.lines[1]!.runs[0]!.text).toBe('bbbb');
  });
});

v.describe('RichText', () => {
  v.it('renders runs and reports the wrapped layout', async () => {
    const captured: RichTextLayout[] = [];
    const dispose = renderer.render(() => (
      <view width={200} height={200}>
        <RichText
          x={10}
          y={20}
          width={100}
          measure={measure}
          spans={[
            { text: 'Hello', color: 0xffffffff },
            { text: ' world', color: 0xff0000ff },
          ]}
          onLayout={(layout) => captured.push(layout)}
        />
      </view>
    ));
    await waitForUpdate();
    const last = captured.at(-1)!;
    v.expect(last.lines).toHaveLength(2);
    v.expect(last.lines[1]!.runs[0]!.color).toBe(0xff0000ff);

    const texts = (node: unknown): lng.ElementText[] => {
      const current = node as {
        text?: string;
        children?: readonly unknown[];
      };
      if (typeof current.text === 'string') return [node as lng.ElementText];
      return (current.children ?? []).flatMap((child) => texts(child));
    };
    v.expect(texts(renderer.rootNode).map((node) => node.text)).toContain(
      'Hello',
    );
    v.expect(texts(renderer.rootNode).map((node) => node.text)).toContain(
      'world',
    );
    dispose();
  });

  v.it('reflows when spans change', async () => {
    const [spans, setSpans] = createSignal<RichTextSpan[]>([
      { text: 'Hello world' },
    ]);
    const captured: RichTextLayout[] = [];
    const dispose = renderer.render(() => (
      <view width={200} height={200}>
        <RichText
          width={100}
          measure={measure}
          spans={spans()}
          onLayout={(layout) => captured.push(layout)}
        />
      </view>
    ));
    await waitForUpdate();
    v.expect(captured.at(-1)!.lines).toHaveLength(2);

    setSpans([{ text: 'Hi' }]);
    await waitForUpdate();
    v.expect(captured.at(-1)!.lines).toHaveLength(1);
    dispose();
  });
});
