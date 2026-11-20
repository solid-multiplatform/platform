// The Markdown and ChatMessage primitives render scene nodes: a heading,
// strong and inline code, a list, a fenced block, a tool card and a file
// reference all reach the scene as text. The DOM backend does not put scene
// text into jsdom (it sets `innerText`), so the assertions walk the scene.
import * as v from 'vitest';
import type { ElementNode } from '../src/core/elementNode.js';
import { ChatMessage } from '../src/primitives/ChatMessage.jsx';
import { Markdown } from '../src/primitives/Markdown.jsx';
import { renderer } from './setup.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function collect(node: ElementNode, out: string[] = []): string[] {
  const text = (node as unknown as { text?: unknown }).text;
  if (typeof text === 'string') out.push(text);
  for (const child of node.children ?? []) {
    if (typeof child === 'object' && child !== null && 'children' in child)
      collect(child as ElementNode, out);
  }
  return out;
}

async function mount(ui: (ref: (node: ElementNode) => void) => v.JSX.Element) {
  let root: ElementNode | undefined;
  const dispose = renderer.render(() =>
    ui((node) => {
      root = node;
    }),
  ) as unknown as () => void;
  await flush();
  return { dispose, text: () => collect(root!).join('') };
}

v.describe('Markdown', () => {
  v.test('renders blocks and inline styles as scene text', async () => {
    const { dispose, text } = await mount((ref) => (
      <view ref={ref}>
        <Markdown
          width={320}
          source={[
            '# Title',
            '',
            'A **bold** word and `inline code`.',
            '',
            '- first',
            '- second',
            '',
            '```ts',
            'const answer = 42;',
            '```',
          ].join('\n')}
        />
      </view>
    ));
    const scene = text();
    v.expect(scene).toContain('Title');
    v.expect(scene).toContain('bold');
    v.expect(scene).toContain('inline code');
    v.expect(scene).toContain('first');
    v.expect(scene).toContain('const answer = 42;');
    dispose();
  });
});

v.describe('ChatMessage', () => {
  v.test('renders a tool card, a file reference and Markdown', async () => {
    const { dispose, text } = await mount((ref) => (
      <view ref={ref}>
        <ChatMessage
          role="assistant"
          author="Claude"
          time="10:24"
          width={340}
          fontSize={15}
          parts={[
            { type: 'markdown', text: 'Fixed **two** tests.' },
            {
              type: 'tool',
              name: 'Bash',
              status: 'done',
              title: 'npm test',
              output: '1291 passed',
              durationMs: 4120,
              expanded: true,
            },
            { type: 'file', path: 'src/screens/Chat.tsx', line: 120 },
          ]}
        />
      </view>
    ));
    const scene = text();
    v.expect(scene).toContain('Claude');
    v.expect(scene).toContain('Fixed');
    v.expect(scene).toContain('Bash');
    v.expect(scene).toContain('1291 passed');
    v.expect(scene).toContain('src/screens/Chat.tsx:120');
    dispose();
  });
});
